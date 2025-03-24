import time
import json
import uuid
import logging
import traceback
from datetime import datetime
from celery import Celery, Task, states
from celery.signals import task_prerun, task_postrun, task_failure, worker_ready, worker_init, setup_logging
from celery.exceptions import Retry

# Configure logging
logger = logging.getLogger(__name__)

# Setup Redis and Celery
from routes.utils.celery_config import REDIS_URL, REDIS_BACKEND, get_config_params

# Initialize Celery app
celery_app = Celery('download_tasks',
                  broker=REDIS_URL,
                  backend=REDIS_BACKEND)

# Load Celery config
celery_app.config_from_object('routes.utils.celery_config')

# Create Redis connection for storing task data that's not part of the Celery result backend
import redis
redis_client = redis.Redis.from_url(REDIS_URL)

class ProgressState:
    """Enum-like class for progress states"""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"
    RETRYING = "retrying"
    CANCELLED = "cancelled"
    PROGRESS = "progress"
    
    # Additional states from deezspot library
    INITIALIZING = "initializing"
    DOWNLOADING = "downloading"
    TRACK_PROGRESS = "track_progress"
    TRACK_COMPLETE = "track_complete"
    REAL_TIME = "real_time"
    SKIPPED = "skipped"
    DONE = "done"

# Reuse the application's logging configuration for Celery workers
@setup_logging.connect
def setup_celery_logging(**kwargs):
    """
    This handler ensures Celery uses our application logging settings
    instead of its own. Prevents duplicate log configurations.
    """
    # Using the root logger's handlers and level preserves our config
    return logging.getLogger()

# The initialization of a worker will log the worker configuration
@worker_init.connect
def worker_init_handler(**kwargs):
    """Log when a worker initializes with its configuration details"""
    config = get_config_params()
    logger.info(f"Celery worker initialized with concurrency {config.get('maxConcurrentDownloads', 3)}")
    logger.info(f"Worker config: spotifyQuality={config.get('spotifyQuality')}, deezerQuality={config.get('deezerQuality')}")
    logger.debug("Worker Redis connection: " + REDIS_URL)

def store_task_status(task_id, status_data):
    """
    Store task status information in Redis with a sequential ID
    
    Args:
        task_id: The task ID
        status_data: Dictionary containing status information
    """
    # Add timestamp if not present
    if 'timestamp' not in status_data:
        status_data['timestamp'] = time.time()
    
    # Generate sequential ID for this status update (atomic operation)
    try:
        # Get next ID for this task's status updates
        status_id = redis_client.incr(f"task:{task_id}:status:next_id")
        status_data['id'] = status_id
        
        # Convert to JSON and store in Redis
        redis_client.rpush(f"task:{task_id}:status", json.dumps(status_data))
        
        # Trim the list to keep only the most recent 100 updates to avoid excessive memory usage
        redis_client.ltrim(f"task:{task_id}:status", -100, -1)
        
        # Set expiry for the list to avoid filling up Redis with old data
        redis_client.expire(f"task:{task_id}:status", 60 * 60 * 24 * 7)  # 7 days
        redis_client.expire(f"task:{task_id}:status:next_id", 60 * 60 * 24 * 7)  # 7 days
        
        # Publish an update event to a Redis channel for subscribers
        # This will be used by the SSE endpoint to push updates in real-time
        update_channel = f"task_updates:{task_id}"
        redis_client.publish(update_channel, json.dumps({
            "task_id": task_id, 
            "status_id": status_id
        }))
    except Exception as e:
        logger.error(f"Error storing task status: {e}")
        traceback.print_exc()

def get_task_status(task_id):
    """Get all task status updates from Redis"""
    try:
        status_list = redis_client.lrange(f"task:{task_id}:status", 0, -1)
        return [json.loads(s.decode('utf-8')) for s in status_list]
    except Exception as e:
        logger.error(f"Error getting task status: {e}")
        return []

def get_last_task_status(task_id):
    """
    Get the most recent task status update from Redis
    
    If the task is an album or playlist, prioritize progress updates
    showing current track information over generic processing status.
    """
    try:
        # Get all status updates for this task
        all_statuses = redis_client.lrange(f"task:{task_id}:status", 0, -1)
        if not all_statuses:
            logger.debug(f"Task {task_id}: No status updates found")
            return None
        
        logger.debug(f"Task {task_id}: Found {len(all_statuses)} status updates")
        
        # First decode and analyze all status updates
        decoded_statuses = []
        has_progress_updates = False
        
        for status_json in all_statuses:
            try:
                status = json.loads(status_json.decode('utf-8'))
                decoded_statuses.append(status)
                
                # Check if we have any progress updates with track information
                if status.get("status") == "progress" and status.get("track"):
                    has_progress_updates = True
                    logger.debug(f"Task {task_id}: Found progress update with track: {status.get('track')}")
            except Exception as e:
                logger.error(f"Error decoding status update: {e}")
        
        if not has_progress_updates:
            logger.debug(f"Task {task_id}: No progress updates with track info found")
        
        # Find the latest terminal status (complete, error, cancelled)
        latest_status = decoded_statuses[-1] if decoded_statuses else None
        if latest_status and latest_status.get("status") in [ProgressState.COMPLETE, ProgressState.ERROR, ProgressState.CANCELLED]:
            logger.debug(f"Task {task_id}: Returning terminal status: {latest_status.get('status')}")
            return latest_status
        
        # Find the most recent progress update with track information
        # Start from the most recent and go backward
        latest_progress = None
        
        for status in reversed(decoded_statuses):
            status_type = status.get("status")
            
            # For album/playlist downloads, find progress updates with track information
            if status_type == "progress" and status.get("track"):
                latest_progress = status
                logger.debug(f"Task {task_id}: Selected progress update for track: {status.get('track')}")
                break
        
        # If we found a progress update, make sure it has all the necessary fields
        if latest_progress:
            # Parse current_track from "X/Y" format if needed
            current_track_raw = latest_progress.get("current_track", "0")
            
            # Always reprocess the values to ensure consistency
            if isinstance(current_track_raw, str) and "/" in current_track_raw:
                try:
                    parts = current_track_raw.split("/")
                    current_track = int(parts[0])
                    total_tracks = int(parts[1])
                    
                    # Calculate and update progress information
                    overall_progress = min(int((current_track / total_tracks) * 100), 100)
                    latest_progress["parsed_current_track"] = current_track
                    latest_progress["parsed_total_tracks"] = total_tracks
                    latest_progress["overall_progress"] = overall_progress
                    
                    logger.debug(f"Task {task_id}: Parsed track progress {current_track}/{total_tracks} ({overall_progress}%)")
                except (ValueError, IndexError) as e:
                    logger.error(f"Error parsing track numbers: {e}")
            
            # Return the enhanced progress update
            return latest_progress
        
        # If no suitable progress updates found, return the most recent status
        logger.debug(f"Task {task_id}: No suitable progress updates found, returning latest status")
        return latest_status
    
    except Exception as e:
        logger.error(f"Error getting last task status for {task_id}: {e}")
        traceback.print_exc()
        return None

def store_task_info(task_id, task_info):
    """Store task information in Redis"""
    try:
        redis_client.set(f"task:{task_id}:info", json.dumps(task_info))
        redis_client.expire(f"task:{task_id}:info", 60 * 60 * 24 * 7)  # 7 days
    except Exception as e:
        logger.error(f"Error storing task info: {e}")

def get_task_info(task_id):
    """Get task information from Redis"""
    try:
        task_info = redis_client.get(f"task:{task_id}:info")
        if task_info:
            return json.loads(task_info.decode('utf-8'))
        return {}
    except Exception as e:
        logger.error(f"Error getting task info: {e}")
        return {}

def cancel_task(task_id):
    """Cancel a task by its ID"""
    try:
        # Mark the task as cancelled in Redis
        store_task_status(task_id, {
            "status": ProgressState.CANCELLED,
            "message": "Task cancelled by user",
            "timestamp": time.time()
        })
        
        # Try to revoke the Celery task if it hasn't started yet
        celery_app.control.revoke(task_id, terminate=True, signal='SIGTERM')
        
        logger.info(f"Task {task_id} cancelled by user")
        return {"status": "cancelled", "task_id": task_id}
    except Exception as e:
        logger.error(f"Error cancelling task {task_id}: {e}")
        return {"status": "error", "message": str(e)}

def retry_task(task_id):
    """Retry a failed task"""
    try:
        # Get task info
        task_info = get_task_info(task_id)
        if not task_info:
            return {"status": "error", "message": f"Task {task_id} not found"}
        
        logger.debug(f"Retry task {task_id} - Initial task_info: {json.dumps({k: v for k, v in task_info.items() if k != 'orig_request'})}")
        
        # Check if task has retry_count information
        last_status = get_last_task_status(task_id)
        if last_status and last_status.get("status") == "error":
            # Get current retry count
            retry_count = last_status.get("retry_count", 0)
            
            # Get retry configuration from config
            config_params = get_config_params()
            max_retries = config_params.get('maxRetries', 3)
            initial_retry_delay = config_params.get('retryDelaySeconds', 5)
            retry_delay_increase = config_params.get('retry_delay_increase', 5)
            
            # Check if we've exceeded max retries
            if retry_count >= max_retries:
                return {
                    "status": "error",
                    "message": f"Maximum retry attempts ({max_retries}) exceeded"
                }
            
            # Calculate retry delay
            retry_delay = initial_retry_delay + (retry_count * retry_delay_increase)
            
            # Create a new task_id for the retry
            new_task_id = f"{task_id}_retry{retry_count + 1}"
            
            # Update task info for the retry
            task_info["retry_count"] = retry_count + 1
            task_info["retry_of"] = task_id
            
            # Log current URL before potentially updating it
            logger.debug(f"Retry task {task_id} - Current URL: {task_info.get('url', 'N/A')}")
            logger.debug(f"Retry task {task_id} - Retry URL available: {'Yes' if 'retry_url' in task_info and task_info['retry_url'] else 'No'}")
            
            # Use retry_url if available, otherwise use the original url
            # This is crucial for album tasks created from artist downloads
            if "retry_url" in task_info and task_info["retry_url"]:
                logger.info(f"Using retry_url for task {task_id}: {task_info['retry_url']}")
                logger.debug(f"Retry task {task_id} - Replacing URL {task_info.get('url', 'N/A')} with retry_url {task_info['retry_url']}")
                task_info["url"] = task_info["retry_url"]
            else:
                logger.debug(f"Retry task {task_id} - No retry_url found, keeping original URL: {task_info.get('url', 'N/A')}")
            
            # Get the service and fallback configuration from config
            service = config_params.get("service")
            fallback_enabled = config_params.get("fallback", False)
            
            # Update main, fallback, and quality parameters based on service and fallback setting
            if service == 'spotify':
                if fallback_enabled:
                    # If fallback is enabled with Spotify service:
                    # - main becomes the Deezer account
                    # - fallback becomes the Spotify account
                    task_info["main"] = config_params.get("deezer", "")
                    task_info["fallback"] = config_params.get("spotify", "")
                    task_info["quality"] = config_params.get("deezerQuality", "MP3_128")
                    task_info["fall_quality"] = config_params.get("spotifyQuality", "NORMAL")
                else:
                    # If fallback is disabled with Spotify service:
                    # - main is the Spotify account
                    # - no fallback
                    task_info["main"] = config_params.get("spotify", "")
                    task_info["fallback"] = None
                    task_info["quality"] = config_params.get("spotifyQuality", "NORMAL")
                    task_info["fall_quality"] = None
            elif service == 'deezer':
                # For Deezer service:
                # - main is the Deezer account
                # - no fallback (even if enabled in config)
                task_info["main"] = config_params.get("deezer", "")
                task_info["fallback"] = None
                task_info["quality"] = config_params.get("deezerQuality", "MP3_128")
                task_info["fall_quality"] = None
            else:
                # Default to Spotify if unknown service
                task_info["main"] = config_params.get("spotify", "")
                task_info["fallback"] = None
                task_info["quality"] = config_params.get("spotifyQuality", "NORMAL")
                task_info["fall_quality"] = None
            
            # Ensure service comes from config for the retry
            task_info["service"] = service
            
            # Update other config-derived parameters
            task_info["real_time"] = task_info.get("real_time", config_params.get("realTime", False))
            task_info["custom_dir_format"] = task_info.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
            task_info["custom_track_format"] = task_info.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
            task_info["pad_tracks"] = task_info.get("pad_tracks", config_params.get("tracknum_padding", True))
            
            # Log the final URL that will be used
            logger.debug(f"Retry task {task_id} - Final URL for retry: {task_info.get('url', 'N/A')}")
            
            # Store the updated task info
            store_task_info(new_task_id, task_info)
            
            # Create a queued status
            store_task_status(new_task_id, {
                "status": ProgressState.QUEUED,
                "type": task_info.get("type", "unknown"),
                "name": task_info.get("name", "Unknown"),
                "artist": task_info.get("artist", ""),
                "retry_count": retry_count + 1,
                "max_retries": max_retries,
                "retry_delay": retry_delay,
                "timestamp": time.time()
            })
            
            # Launch the appropriate task based on download_type
            download_type = task_info.get("download_type", "unknown")
            task = None
            
            logger.info(f"Retrying task {task_id} as {new_task_id} (retry {retry_count + 1}/{max_retries})")
            
            if download_type == "track":
                task = download_track.apply_async(
                    kwargs=task_info,
                    task_id=new_task_id,
                    queue='downloads'
                )
            elif download_type == "album":
                task = download_album.apply_async(
                    kwargs=task_info,
                    task_id=new_task_id,
                    queue='downloads'
                )
            elif download_type == "playlist":
                task = download_playlist.apply_async(
                    kwargs=task_info,
                    task_id=new_task_id,
                    queue='downloads'
                )
            else:
                logger.error(f"Unknown download type for retry: {download_type}")
                return {
                    "status": "error",
                    "message": f"Unknown download type: {download_type}"
                }
            
            return {
                "status": "requeued",
                "task_id": new_task_id,
                "retry_count": retry_count + 1,
                "max_retries": max_retries,
                "retry_delay": retry_delay
            }
        else:
            return {
                "status": "error",
                "message": "Task is not in a failed state"
            }
    except Exception as e:
        logger.error(f"Error retrying task {task_id}: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

def get_all_tasks():
    """Get all active task IDs"""
    try:
        # Get all keys matching the task info pattern
        task_keys = redis_client.keys("task:*:info")
        
        # Extract task IDs from the keys
        task_ids = [key.decode('utf-8').split(':')[1] for key in task_keys]
        
        # Get info for each task
        tasks = []
        for task_id in task_ids:
            task_info = get_task_info(task_id)
            last_status = get_last_task_status(task_id)
            
            if task_info and last_status:
                tasks.append({
                    "task_id": task_id,
                    "type": task_info.get("type", "unknown"),
                    "name": task_info.get("name", "Unknown"),
                    "artist": task_info.get("artist", ""),
                    "download_type": task_info.get("download_type", "unknown"),
                    "status": last_status.get("status", "unknown"),
                    "timestamp": last_status.get("timestamp", 0)
                })
        
        return tasks
    except Exception as e:
        logger.error(f"Error getting all tasks: {e}")
        return []

class ProgressTrackingTask(Task):
    """Base task class that tracks progress through callbacks"""
    
    def progress_callback(self, progress_data):
        """
        Process progress data from deezspot library callbacks
        
        Args:
            progress_data: Dictionary containing progress information
        """
        task_id = self.request.id
        
        # Debug log incoming progress data
        logger.debug(f"Task {task_id}: Got progress data: {json.dumps(progress_data)}")
        
        # Add timestamp if not present
        if 'timestamp' not in progress_data:
            progress_data['timestamp'] = time.time()
        
        # Map deezspot status to our progress state
        status = progress_data.get("status", "unknown")
        
        # First, make a copy of the data to avoid modifying the original
        stored_data = progress_data.copy()
        
        # Process the data based on status type
        if status == "initializing":
            # Get content information when initializing
            content_type = stored_data.get('type', '').upper()
            album_name = stored_data.get('album', '')
            name = stored_data.get('name', '')
            artist = stored_data.get('artist', '')
            total_tracks = stored_data.get('total_tracks', 0)
            
            # Store initialization details
            if not name and album_name:
                stored_data['name'] = album_name
            
            # Log initialization
            if album_name:
                logger.info(f"Task {task_id} initializing: {content_type} '{album_name}' with {total_tracks} tracks")
            elif name:
                logger.info(f"Task {task_id} initializing: {content_type} '{name}' with {total_tracks} tracks")
            else:
                logger.info(f"Task {task_id} initializing: {content_type} with {total_tracks} tracks")
            
        elif status == "downloading":
            # Track starting to download
            track_name = stored_data.get('song', 'Unknown')
            artist = stored_data.get('artist', '')
            album = stored_data.get('album', '')
            
            if artist and album:
                logger.info(f"Task {task_id} downloading: '{track_name}' by {artist} from {album}")
            elif artist:
                logger.info(f"Task {task_id} downloading: '{track_name}' by {artist}")
            else:
                logger.info(f"Task {task_id} downloading: '{track_name}'")
                
        elif status == "progress":
            # For album/playlist downloads, process track progress
            track_name = stored_data.get("track", stored_data.get("song", "Unknown track"))
            current_track_raw = stored_data.get("current_track", "0")
            album = stored_data.get("album", "")
            artist = stored_data.get("artist", "")
            
            # Process and store artist correctly
            if isinstance(artist, list) and len(artist) > 0:
                # Take the first artist if it's a list
                artist_name = artist[0]
                # Store the processed artist back in the data
                stored_data["artist_name"] = artist_name
            elif isinstance(artist, str):
                stored_data["artist_name"] = artist
            
            # Parse current_track and total_tracks from the format "current/total"
            if isinstance(current_track_raw, str) and "/" in current_track_raw:
                try:
                    parts = current_track_raw.split("/")
                    current_track = int(parts[0])
                    total_tracks = int(parts[1])
                    
                    # Store the parsed values
                    stored_data["parsed_current_track"] = current_track
                    stored_data["parsed_total_tracks"] = total_tracks
                    
                    # Calculate overall percentage
                    overall_progress = min(int((current_track / total_tracks) * 100), 100)
                    stored_data["overall_progress"] = overall_progress
                    
                    logger.debug(f"Task {task_id}: Processed track progress {current_track}/{total_tracks} ({overall_progress}%) for '{track_name}'")
                except (ValueError, IndexError) as e:
                    logger.error(f"Error parsing track numbers '{current_track_raw}': {e}")
            elif isinstance(current_track_raw, int):
                # Handle the case where it's already an integer
                current_track = current_track_raw
                total_tracks = stored_data.get("total_tracks", 0)
                
                if total_tracks > 0:
                    # Calculate overall percentage
                    overall_progress = min(int((current_track / total_tracks) * 100), 100)
                    stored_data["parsed_current_track"] = current_track
                    stored_data["parsed_total_tracks"] = total_tracks
                    stored_data["overall_progress"] = overall_progress
            
            # Log appropriate message based on available information
            artist_name = stored_data.get("artist_name", artist)
            if album and artist_name:
                logger.info(f"Task {task_id} progress: [{stored_data.get('parsed_current_track', 0)}/{stored_data.get('parsed_total_tracks', 0)}] {stored_data.get('overall_progress', 0)}% - {track_name} by {artist_name} from {album}")
            elif album:
                logger.info(f"Task {task_id} progress: [{stored_data.get('parsed_current_track', 0)}/{stored_data.get('parsed_total_tracks', 0)}] {stored_data.get('overall_progress', 0)}% - {track_name} from {album}")
            else:
                logger.info(f"Task {task_id} progress: [{stored_data.get('parsed_current_track', 0)}/{stored_data.get('parsed_total_tracks', 0)}] {stored_data.get('overall_progress', 0)}% - {track_name}")
                
        elif status == "track_progress" or status == "real_time":
            # Track real-time progress of a file download
            title = stored_data.get('title', stored_data.get('song', 'Unknown'))
            artist = stored_data.get('artist', 'Unknown')
            
            # Handle different percent formats
            percent = stored_data.get('percent', stored_data.get('percentage', 0))
            if isinstance(percent, float) and percent <= 1.0:
                percent = int(percent * 100)
            
            # Update bytes received information if available
            if 'bytes_received' in stored_data:
                # Calculate and store download rate
                last_update = stored_data.get('last_update_time', stored_data['timestamp'])
                bytes_received = stored_data['bytes_received']
                last_bytes = stored_data.get('last_bytes_received', 0)
                time_diff = stored_data['timestamp'] - last_update
                
                if time_diff > 0 and bytes_received > last_bytes:
                    bytes_diff = bytes_received - last_bytes
                    download_rate = bytes_diff / time_diff
                    stored_data['download_rate'] = download_rate
                    stored_data['last_update_time'] = stored_data['timestamp']
                    stored_data['last_bytes_received'] = bytes_received
                
                # Format download rate for display
                if 'download_rate' in stored_data:
                    rate = stored_data['download_rate']
                    if rate < 1024:
                        stored_data['download_rate_formatted'] = f"{rate:.2f} B/s"
                    elif rate < 1024 * 1024:
                        stored_data['download_rate_formatted'] = f"{rate/1024:.2f} KB/s"
                    else:
                        stored_data['download_rate_formatted'] = f"{rate/(1024*1024):.2f} MB/s"
            
            # Log real-time progress
            logger.debug(f"Task {task_id} track progress: {title} by {artist}: {percent}%")
        
        elif status == "track_complete" or (status == "done" and stored_data.get('type') == 'track'):
            # Track completed successfully
            title = stored_data.get('title', stored_data.get('song', 'Unknown'))
            artist = stored_data.get('artist', 'Unknown')
            album = stored_data.get('album', 'Unknown')
            quality = stored_data.get('quality', 'Unknown')
            path = stored_data.get('path', '')
            
            # Log completion with file size if available
            if 'file_size' in stored_data:
                size = stored_data['file_size']
                if size < 1024:
                    stored_data['file_size_formatted'] = f"{size} B"
                elif size < 1024 * 1024:
                    stored_data['file_size_formatted'] = f"{size/1024:.2f} KB"
                elif size < 1024 * 1024 * 1024:
                    stored_data['file_size_formatted'] = f"{size/(1024*1024):.2f} MB"
                else:
                    stored_data['file_size_formatted'] = f"{size/(1024*1024*1024):.2f} GB"
                
                logger.info(f"Task {task_id} track complete: {artist} - {title} ({quality}) {stored_data.get('file_size_formatted', '')}")
            else:
                logger.info(f"Task {task_id} track complete: {artist} - {title} ({quality})")
            
            if path:
                logger.debug(f"Task {task_id} saved to: {path}")
                
            # Update completion progress
            task_info = get_task_info(task_id)
            total_tracks = task_info.get('total_tracks', stored_data.get('total_tracks', 0))
            completed_tracks = task_info.get('completed_tracks', 0) + 1
            
            # Update task info with new completed track count
            task_info['completed_tracks'] = completed_tracks
            store_task_info(task_id, task_info)
            
            # Calculate completion percentage
            if total_tracks > 0:
                completion_percent = int((completed_tracks / total_tracks) * 100)
                stored_data['completion_percent'] = completion_percent
                logger.info(f"Task {task_id} progress: {completed_tracks}/{total_tracks} tracks ({completion_percent}%)")
        
        elif status == "skipped":
            # Track was skipped (usually because it already exists)
            title = stored_data.get('song', 'Unknown')
            artist = stored_data.get('artist', 'Unknown')
            reason = stored_data.get('reason', 'Unknown reason')
            
            logger.info(f"Task {task_id} skipped: {artist} - {title}")
            logger.debug(f"Task {task_id} skip reason: {reason}")
            
            # Update task info with skipped track
            task_info = get_task_info(task_id)
            skipped_tracks = task_info.get('skipped_tracks', 0) + 1
            task_info['skipped_tracks'] = skipped_tracks
            store_task_info(task_id, task_info)
        
        elif status == "retrying":
            # Download failed and is being retried
            song = stored_data.get('song', 'Unknown')
            artist = stored_data.get('artist', 'Unknown')
            retry_count = stored_data.get('retry_count', 0)
            seconds_left = stored_data.get('seconds_left', 0)
            error = stored_data.get('error', 'Unknown error')
            
            logger.warning(f"Task {task_id} retrying: {artist} - {song} (Attempt {retry_count}, waiting {seconds_left}s)")
            logger.debug(f"Task {task_id} retry reason: {error}")
            
            # Update task info with retry count
            task_info = get_task_info(task_id)
            retry_count_total = task_info.get('retry_count', 0) + 1
            task_info['retry_count'] = retry_count_total
            store_task_info(task_id, task_info)
        
        elif status == "error":
            # Error occurred during download
            message = stored_data.get('message', 'Unknown error')
            
            logger.error(f"Task {task_id} error: {message}")
            
            # Update task info with error count
            task_info = get_task_info(task_id)
            error_count = task_info.get('error_count', 0) + 1
            task_info['error_count'] = error_count
            store_task_info(task_id, task_info)
        
        elif status == "done":
            # Overall download operation completed
            content_type = stored_data.get('type', '').upper()
            name = stored_data.get('name', '')
            album = stored_data.get('album', '')
            artist = stored_data.get('artist', '')
            total_tracks = stored_data.get('total_tracks', 0)
            
            # Get task info for summary
            task_info = get_task_info(task_id)
            completed_tracks = task_info.get('completed_tracks', 0)
            skipped_tracks = task_info.get('skipped_tracks', 0)
            error_count = task_info.get('error_count', 0)
            
            # Create completion message
            if album and artist:
                logger.info(f"Task {task_id} completed: {content_type} '{album}' by {artist}")
            elif album:
                logger.info(f"Task {task_id} completed: {content_type} '{album}'")
            elif name:
                logger.info(f"Task {task_id} completed: {content_type} '{name}'")
            else:
                logger.info(f"Task {task_id} completed")
                
            # Log summary
            logger.info(f"Task {task_id} summary: {completed_tracks} completed, {skipped_tracks} skipped, {error_count} errors")
            
            # Update task status to complete
            stored_data["status"] = ProgressState.COMPLETE
            stored_data["message"] = f"Download complete: {completed_tracks} tracks downloaded"
        
        elif status == "processing":
            # Processing status - log message with progress if available
            progress = stored_data.get("progress", 0)
            message = stored_data.get("message", "Processing")
            
            if progress > 0:
                logger.debug(f"Task {task_id} processing: {progress}% - {message}")
            else:
                logger.info(f"Task {task_id} processing: {message}")
        
        else:
            # Unknown status - just log it
            logger.info(f"Task {task_id} {status}: {stored_data.get('message', 'No details')}")
        
        # Store the enhanced progress update in Redis
        store_task_status(task_id, stored_data)

# Celery signal handlers
@task_prerun.connect
def task_prerun_handler(task_id=None, task=None, *args, **kwargs):
    """Signal handler when a task begins running"""
    try:
        # Get task info from Redis
        task_info = get_task_info(task_id)
        
        # Update task status to processing
        store_task_status(task_id, {
            "status": ProgressState.PROCESSING,
            "timestamp": time.time(),
            "type": task_info.get("type", "unknown"),
            "name": task_info.get("name", "Unknown"),
            "artist": task_info.get("artist", "")
        })
        
        logger.info(f"Task {task_id} started processing: {task_info.get('name', 'Unknown')}")
    except Exception as e:
        logger.error(f"Error in task_prerun_handler: {e}")

@task_postrun.connect
def task_postrun_handler(task_id=None, task=None, retval=None, state=None, *args, **kwargs):
    """Signal handler when a task finishes"""
    try:
        # Skip if task is already marked as complete or error in Redis
        last_status = get_last_task_status(task_id)
        if last_status and last_status.get("status") in [ProgressState.COMPLETE, ProgressState.ERROR]:
            return
        
        # Get task info from Redis
        task_info = get_task_info(task_id)
        
        # Update task status based on Celery task state
        if state == states.SUCCESS:
            store_task_status(task_id, {
                "status": ProgressState.COMPLETE,
                "timestamp": time.time(),
                "type": task_info.get("type", "unknown"),
                "name": task_info.get("name", "Unknown"),
                "artist": task_info.get("artist", ""),
                "message": "Download completed successfully."
            })
            logger.info(f"Task {task_id} completed successfully: {task_info.get('name', 'Unknown')}")
    except Exception as e:
        logger.error(f"Error in task_postrun_handler: {e}")

@task_failure.connect
def task_failure_handler(task_id=None, exception=None, traceback=None, *args, **kwargs):
    """Signal handler when a task fails"""
    try:
        # Skip if Retry exception (will be handled by the retry mechanism)
        if isinstance(exception, Retry):
            return
        
        # Get task info and last status from Redis
        task_info = get_task_info(task_id)
        last_status = get_last_task_status(task_id)
        
        # Get retry count
        retry_count = 0
        if last_status:
            retry_count = last_status.get("retry_count", 0)
        
        # Get retry configuration
        config_params = get_config_params()
        max_retries = config_params.get('maxRetries', 3)
        
        # Check if we can retry
        can_retry = retry_count < max_retries
        
        # Update task status to error
        error_message = str(exception)
        store_task_status(task_id, {
            "status": ProgressState.ERROR,
            "timestamp": time.time(),
            "type": task_info.get("type", "unknown"),
            "name": task_info.get("name", "Unknown"),
            "artist": task_info.get("artist", ""),
            "error": error_message,
            "traceback": str(traceback),
            "can_retry": can_retry,
            "retry_count": retry_count,
            "max_retries": max_retries,
            "message": f"Error: {error_message}"
        })
        
        logger.error(f"Task {task_id} failed: {error_message}")
        if can_retry:
            logger.info(f"Task {task_id} can be retried ({retry_count}/{max_retries})")
    except Exception as e:
        logger.error(f"Error in task_failure_handler: {e}")

@worker_ready.connect
def worker_ready_handler(**kwargs):
    """Signal handler when a worker starts up"""
    logger.info("Celery worker ready and listening for tasks")
    
    # Check Redis connection
    try:
        redis_client.ping()
        logger.info("Redis connection successful")
    except Exception as e:
        logger.error(f"Redis connection failed: {e}")

# Define the download tasks
@celery_app.task(bind=True, base=ProgressTrackingTask, name="download_track", queue="downloads")
def download_track(self, **task_data):
    """
    Task to download a track
    
    Args:
        **task_data: Dictionary containing all task parameters
    """
    try:
        logger.info(f"Processing track download task: {task_data.get('name', 'Unknown')}")
        from routes.utils.track import download_track as download_track_func
        
        # Get config parameters including service
        config_params = get_config_params()
        
        # Get the service from config
        service = config_params.get("service")
        
        # DEBUG: Log the config parameters
        print(f"DEBUG: celery_tasks.py config_params:")
        print(f"DEBUG:   service = {service}")
        print(f"DEBUG:   spotify = {config_params.get('spotify', '')}")
        print(f"DEBUG:   deezer = {config_params.get('deezer', '')}")
        print(f"DEBUG:   fallback_enabled = {config_params.get('fallback', False)}")
        
        # Determine main, fallback, and quality parameters based on service and fallback setting
        fallback_enabled = config_params.get("fallback", False)
        
        if service == 'spotify':
            if fallback_enabled:
                # If fallback is enabled with Spotify service:
                # - main becomes the Deezer account
                # - fallback becomes the Spotify account
                main = config_params.get("deezer", "")
                fallback = config_params.get("spotify", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
                
                # DEBUG: Log the values after fallback logic
                print(f"DEBUG: Spotify with fallback enabled:")
                print(f"DEBUG:   main (Deezer account) = {main}")
                print(f"DEBUG:   fallback (Spotify account) = {fallback}")
            else:
                # If fallback is disabled with Spotify service:
                # - main is the Spotify account
                # - no fallback
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
                
                # DEBUG: Log the values
                print(f"DEBUG: Spotify without fallback:")
                print(f"DEBUG:   main (Spotify account) = {main}")
        elif service == 'deezer':
            # For Deezer service:
            # - main is the Deezer account
            # - no fallback (even if enabled in config)
            main = config_params.get("deezer", "")
            fallback = None
            quality = config_params.get("deezerQuality", "MP3_128")
            fall_quality = None
            
            # DEBUG: Log the values
            print(f"DEBUG: Deezer service:")
            print(f"DEBUG:   main (Deezer account) = {main}")
        else:
            # Default to Spotify if unknown service
            main = config_params.get("spotify", "")
            fallback = None
            quality = config_params.get("spotifyQuality", "NORMAL")
            fall_quality = None
            
            # DEBUG: Log the values
            print(f"DEBUG: Unknown service defaulting to Spotify:")
            print(f"DEBUG:   main (Spotify account) = {main}")
        
        # Get remaining parameters from task_data or config
        url = task_data.get("url", "")
        real_time = task_data.get("real_time", config_params.get("realTime", False))
        custom_dir_format = task_data.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
        custom_track_format = task_data.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
        pad_tracks = task_data.get("pad_tracks", config_params.get("tracknum_padding", True))
        
        # Log task parameters for debugging
        print(f"DEBUG: Final parameters for download_track_func:")
        print(f"DEBUG:   service = {service}")
        print(f"DEBUG:   main = {main}")
        print(f"DEBUG:   fallback = {fallback}")
        print(f"DEBUG:   quality = {quality}")
        print(f"DEBUG:   fall_quality = {fall_quality}")
        
        # Execute the download function with progress callback
        download_track_func(
            service=service,
            url=url,
            main=main,
            fallback=fallback,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks,
            progress_callback=self.progress_callback  # Pass the callback from our ProgressTrackingTask
        )
        
        return {"status": "success", "message": "Track download completed"}
    except Exception as e:
        logger.error(f"Error in download_track task: {e}")
        traceback.print_exc()
        raise

@celery_app.task(bind=True, base=ProgressTrackingTask, name="download_album", queue="downloads")
def download_album(self, **task_data):
    """
    Task to download an album
    
    Args:
        **task_data: Dictionary containing all task parameters
    """
    try:
        logger.info(f"Processing album download task: {task_data.get('name', 'Unknown')}")
        from routes.utils.album import download_album as download_album_func
        
        # Get config parameters including service
        config_params = get_config_params()
        
        # Get the service from config
        service = config_params.get("service")
        
        # Determine main, fallback, and quality parameters based on service and fallback setting
        fallback_enabled = config_params.get("fallback", False)
        
        if service == 'spotify':
            if fallback_enabled:
                # If fallback is enabled with Spotify service:
                # - main becomes the Deezer account
                # - fallback becomes the Spotify account
                main = config_params.get("deezer", "")
                fallback = config_params.get("spotify", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                # If fallback is disabled with Spotify service:
                # - main is the Spotify account
                # - no fallback
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == 'deezer':
            # For Deezer service:
            # - main is the Deezer account
            # - no fallback (even if enabled in config)
            main = config_params.get("deezer", "")
            fallback = None
            quality = config_params.get("deezerQuality", "MP3_128")
            fall_quality = None
        else:
            # Default to Spotify if unknown service
            main = config_params.get("spotify", "")
            fallback = None
            quality = config_params.get("spotifyQuality", "NORMAL")
            fall_quality = None
        
        # Get remaining parameters from task_data or config
        url = task_data.get("url", "")
        real_time = task_data.get("real_time", config_params.get("realTime", False))
        custom_dir_format = task_data.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
        custom_track_format = task_data.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
        pad_tracks = task_data.get("pad_tracks", config_params.get("tracknum_padding", True))
        
        # Log task parameters for debugging
        logger.debug(f"Album download parameters: service={service}, quality={quality}, real_time={real_time}")
        
        # Execute the download function with progress callback
        download_album_func(
            service=service,
            url=url,
            main=main,
            fallback=fallback,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks,
            progress_callback=self.progress_callback  # Pass the callback from our ProgressTrackingTask
        )
        
        return {"status": "success", "message": "Album download completed"}
    except Exception as e:
        logger.error(f"Error in download_album task: {e}")
        traceback.print_exc()
        raise

@celery_app.task(bind=True, base=ProgressTrackingTask, name="download_playlist", queue="downloads")
def download_playlist(self, **task_data):
    """
    Task to download a playlist
    
    Args:
        **task_data: Dictionary containing all task parameters
    """
    try:
        logger.info(f"Processing playlist download task: {task_data.get('name', 'Unknown')}")
        from routes.utils.playlist import download_playlist as download_playlist_func
        
        # Get config parameters including service
        config_params = get_config_params()
        
        # Get the service from config
        service = config_params.get("service")
        
        # Determine main, fallback, and quality parameters based on service and fallback setting
        fallback_enabled = config_params.get("fallback", False)
        
        if service == 'spotify':
            if fallback_enabled:
                # If fallback is enabled with Spotify service:
                # - main becomes the Deezer account
                # - fallback becomes the Spotify account
                main = config_params.get("deezer", "")
                fallback = config_params.get("spotify", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                # If fallback is disabled with Spotify service:
                # - main is the Spotify account
                # - no fallback
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == 'deezer':
            # For Deezer service:
            # - main is the Deezer account
            # - no fallback (even if enabled in config)
            main = config_params.get("deezer", "")
            fallback = None
            quality = config_params.get("deezerQuality", "MP3_128")
            fall_quality = None
        else:
            # Default to Spotify if unknown service
            main = config_params.get("spotify", "")
            fallback = None
            quality = config_params.get("spotifyQuality", "NORMAL")
            fall_quality = None
        
        # Get remaining parameters from task_data or config
        url = task_data.get("url", "")
        real_time = task_data.get("real_time", config_params.get("realTime", False))
        custom_dir_format = task_data.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
        custom_track_format = task_data.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
        pad_tracks = task_data.get("pad_tracks", config_params.get("tracknum_padding", True))
        
        # Log task parameters for debugging
        logger.debug(f"Playlist download parameters: service={service}, quality={quality}, real_time={real_time}")
        
        # Execute the download function with progress callback
        download_playlist_func(
            service=service,
            url=url,
            main=main,
            fallback=fallback,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks,
            progress_callback=self.progress_callback  # Pass the callback from our ProgressTrackingTask
        )
        
        return {"status": "success", "message": "Playlist download completed"}
    except Exception as e:
        logger.error(f"Error in download_playlist task: {e}")
        traceback.print_exc()
        raise 