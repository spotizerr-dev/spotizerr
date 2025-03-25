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
    
    try:
        # Get next ID for this task's status updates
        status_id = redis_client.incr(f"task:{task_id}:status:next_id")
        status_data['id'] = status_id
        
        # Convert to JSON and store in Redis
        redis_client.rpush(f"task:{task_id}:status", json.dumps(status_data))
        
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
    """Get the most recent task status update from Redis"""
    try:
        # Get the last status update
        status_list = redis_client.lrange(f"task:{task_id}:status", -1, -1)
        if not status_list:
            return None
            
        return json.loads(status_list[0].decode('utf-8'))
    except Exception as e:
        logger.error(f"Error getting last task status: {e}")
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
        
        # Check if task has error status
        last_status = get_last_task_status(task_id)
        if not last_status or last_status.get("status") != ProgressState.ERROR:
            return {"status": "error", "message": "Task is not in a failed state"}
        
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
        
        # Use retry_url if available, otherwise use the original url
        if "retry_url" in task_info and task_info["retry_url"]:
            task_info["url"] = task_info["retry_url"]
        
        # Get service configuration
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)
        
        # Update service settings
        if service == 'spotify':
            if fallback_enabled:
                task_info["main"] = config_params.get("deezer", "")
                task_info["fallback"] = config_params.get("spotify", "")
                task_info["quality"] = config_params.get("deezerQuality", "MP3_128")
                task_info["fall_quality"] = config_params.get("spotifyQuality", "NORMAL")
            else:
                task_info["main"] = config_params.get("spotify", "")
                task_info["fallback"] = None
                task_info["quality"] = config_params.get("spotifyQuality", "NORMAL")
                task_info["fall_quality"] = None
        elif service == 'deezer':
            task_info["main"] = config_params.get("deezer", "")
            task_info["fallback"] = None
            task_info["quality"] = config_params.get("deezerQuality", "MP3_128")
            task_info["fall_quality"] = None
        else:
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
        Process progress data from deezspot library callbacks using the optimized approach
        based on known status types and flow patterns.
        
        Args:
            progress_data: Dictionary containing progress information from deezspot
        """
        task_id = self.request.id
        
        # Add timestamp if not present
        if 'timestamp' not in progress_data:
            progress_data['timestamp'] = time.time()
        
        # Get status type
        status = progress_data.get("status", "unknown")
        
        # Create a work copy of the data to avoid modifying the original
        stored_data = progress_data.copy()
        
        # Get task info for context
        task_info = get_task_info(task_id)
        
        # Log raw progress data at debug level
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Task {task_id}: Raw progress data: {json.dumps(progress_data)}")
        
        # Process based on status type using a more streamlined approach
        if status == "initializing":
            # --- INITIALIZING: Start of a download operation ---
            self._handle_initializing(task_id, stored_data, task_info)
            
        elif status == "downloading":
            # --- DOWNLOADING: Track download started ---
            self._handle_downloading(task_id, stored_data, task_info)
            
        elif status == "progress":
            # --- PROGRESS: Album/playlist track progress ---
            self._handle_progress(task_id, stored_data, task_info)
            
        elif status == "real_time" or status == "track_progress":
            # --- REAL_TIME/TRACK_PROGRESS: Track download real-time progress ---
            self._handle_real_time(task_id, stored_data)
            
        elif status == "skipped":
            # --- SKIPPED: Track was skipped ---
            self._handle_skipped(task_id, stored_data, task_info)
            
        elif status == "retrying":
            # --- RETRYING: Download failed and being retried ---
            self._handle_retrying(task_id, stored_data, task_info)
            
        elif status == "error":
            # --- ERROR: Error occurred during download ---
            self._handle_error(task_id, stored_data, task_info)
            
        elif status == "done":
            # --- DONE: Download operation completed ---
            self._handle_done(task_id, stored_data, task_info)
            
        else:
            # --- UNKNOWN: Unrecognized status ---
            logger.info(f"Task {task_id} {status}: {stored_data.get('message', 'No details')}")
            
        # Store the processed status update
        store_task_status(task_id, stored_data)
        
    def _handle_initializing(self, task_id, data, task_info):
        """Handle initializing status from deezspot"""
        # Extract relevant fields
        content_type = data.get('type', '').upper()
        name = data.get('name', '')
        album_name = data.get('album', '')
        artist = data.get('artist', '')
        total_tracks = data.get('total_tracks', 0)
        
        # Use album name as name if name is empty
        if not name and album_name:
            data['name'] = album_name
            
        # Log initialization with appropriate detail level
        if album_name and artist:
            logger.info(f"Task {task_id} initializing: {content_type} '{album_name}' by {artist} with {total_tracks} tracks")
        elif album_name:
            logger.info(f"Task {task_id} initializing: {content_type} '{album_name}' with {total_tracks} tracks")
        elif name:
            logger.info(f"Task {task_id} initializing: {content_type} '{name}' with {total_tracks} tracks")
        else:
            logger.info(f"Task {task_id} initializing: {content_type} with {total_tracks} tracks")
            
        # Update task info with total tracks count
        if total_tracks > 0:
            task_info['total_tracks'] = total_tracks
            task_info['completed_tracks'] = task_info.get('completed_tracks', 0)
            task_info['skipped_tracks'] = task_info.get('skipped_tracks', 0)
            store_task_info(task_id, task_info)
            
        # Update status in data
        data['status'] = ProgressState.INITIALIZING
        
    def _handle_downloading(self, task_id, data, task_info):
        """Handle downloading status from deezspot"""
        # Extract relevant fields
        track_name = data.get('song', 'Unknown')
        artist = data.get('artist', '')
        album = data.get('album', '')
        download_type = data.get('type', '')
        
        # Get parent task context
        parent_type = task_info.get('type', '').lower()
        
        # If this is a track within an album/playlist, update progress
        if parent_type in ['album', 'playlist'] and download_type == 'track':
            total_tracks = task_info.get('total_tracks', 0)
            current_track = task_info.get('current_track_num', 0) + 1
            
            # Update task info
            task_info['current_track_num'] = current_track
            task_info['current_track'] = track_name
            task_info['current_artist'] = artist
            store_task_info(task_id, task_info)
            
            # Only calculate progress if we have total tracks
            if total_tracks > 0:
                overall_progress = min(int((current_track / total_tracks) * 100), 100)
                data['overall_progress'] = overall_progress
                data['parsed_current_track'] = current_track
                data['parsed_total_tracks'] = total_tracks
                
            # Create a progress update for the album/playlist
            progress_update = {
                "status": ProgressState.DOWNLOADING,
                "type": parent_type,
                "track": track_name,
                "current_track": f"{current_track}/{total_tracks}",
                "album": album,
                "artist": artist,
                "timestamp": data['timestamp'],
                "parent_task": True
            }
            
            # Store separate progress update
            store_task_status(task_id, progress_update)
        
        # Log with appropriate detail level
        if artist and album:
            logger.info(f"Task {task_id} downloading: '{track_name}' by {artist} from {album}")
        elif artist:
            logger.info(f"Task {task_id} downloading: '{track_name}' by {artist}")
        else:
            logger.info(f"Task {task_id} downloading: '{track_name}'")
            
        # Update status
        data['status'] = ProgressState.DOWNLOADING
        
    def _handle_progress(self, task_id, data, task_info):
        """Handle progress status from deezspot"""
        # Extract track info
        track_name = data.get("track", data.get("song", "Unknown track"))
        current_track_raw = data.get("current_track", "0")
        album = data.get("album", "")
        artist = data.get("artist", "")
        
        # Process artist if it's a list
        if isinstance(artist, list) and len(artist) > 0:
            data["artist_name"] = artist[0]
        elif isinstance(artist, str):
            data["artist_name"] = artist
        
        # Parse track numbers from "current/total" format
        if isinstance(current_track_raw, str) and "/" in current_track_raw:
            try:
                parts = current_track_raw.split("/")
                current_track = int(parts[0])
                total_tracks = int(parts[1])
                
                # Update with parsed values
                data["parsed_current_track"] = current_track
                data["parsed_total_tracks"] = total_tracks
                
                # Calculate percentage
                overall_progress = min(int((current_track / total_tracks) * 100), 100)
                data["overall_progress"] = overall_progress
                
                # Update task info
                task_info['current_track_num'] = current_track
                task_info['total_tracks'] = total_tracks
                task_info['current_track'] = track_name
                store_task_info(task_id, task_info)
                
                # Log progress with appropriate detail
                artist_name = data.get("artist_name", artist)
                if album and artist_name:
                    logger.info(f"Task {task_id} progress: [{current_track}/{total_tracks}] {overall_progress}% - {track_name} by {artist_name} from {album}")
                elif album:
                    logger.info(f"Task {task_id} progress: [{current_track}/{total_tracks}] {overall_progress}% - {track_name} from {album}")
                else:
                    logger.info(f"Task {task_id} progress: [{current_track}/{total_tracks}] {overall_progress}% - {track_name}")
                    
            except (ValueError, IndexError) as e:
                logger.error(f"Error parsing track numbers '{current_track_raw}': {e}")
        
        # Ensure correct status
        data['status'] = ProgressState.PROGRESS
        
    def _handle_real_time(self, task_id, data):
        """Handle real-time progress status from deezspot"""
        # Extract track info
        title = data.get('title', data.get('song', 'Unknown'))
        artist = data.get('artist', 'Unknown')
        
        # Handle percent formatting
        percent = data.get('percent', data.get('percentage', 0))
        if isinstance(percent, float) and percent <= 1.0:
            percent = int(percent * 100)
            data['percent'] = percent
        
        # Calculate download rate if bytes_received is available
        if 'bytes_received' in data:
            last_update = data.get('last_update_time', data['timestamp'])
            bytes_received = data['bytes_received']
            last_bytes = data.get('last_bytes_received', 0)
            time_diff = data['timestamp'] - last_update
            
            if time_diff > 0 and bytes_received > last_bytes:
                bytes_diff = bytes_received - last_bytes
                download_rate = bytes_diff / time_diff
                data['download_rate'] = download_rate
                data['last_update_time'] = data['timestamp']
                data['last_bytes_received'] = bytes_received
                
                # Format download rate for display
                if download_rate < 1024:
                    data['download_rate_formatted'] = f"{download_rate:.2f} B/s"
                elif download_rate < 1024 * 1024:
                    data['download_rate_formatted'] = f"{download_rate/1024:.2f} KB/s"
                else:
                    data['download_rate_formatted'] = f"{download_rate/(1024*1024):.2f} MB/s"
        
        # Log at debug level
        logger.debug(f"Task {task_id} track progress: {title} by {artist}: {percent}%")
        
        # Set appropriate status
        data['status'] = ProgressState.REAL_TIME if data.get('status') == "real_time" else ProgressState.TRACK_PROGRESS
        
    def _handle_skipped(self, task_id, data, task_info):
        """Handle skipped status from deezspot"""
        # Extract track info
        title = data.get('song', 'Unknown')
        artist = data.get('artist', 'Unknown')
        reason = data.get('reason', 'Unknown reason')
        
        # Log skip
        logger.info(f"Task {task_id} skipped: {artist} - {title}")
        logger.debug(f"Task {task_id} skip reason: {reason}")
        
        # Update task info
        skipped_tracks = task_info.get('skipped_tracks', 0) + 1
        task_info['skipped_tracks'] = skipped_tracks
        store_task_info(task_id, task_info)
        
        # Check if part of album/playlist
        parent_type = task_info.get('type', '').lower()
        if parent_type in ['album', 'playlist']:
            total_tracks = task_info.get('total_tracks', 0)
            processed_tracks = task_info.get('completed_tracks', 0) + skipped_tracks
            
            if total_tracks > 0:
                overall_progress = min(int((processed_tracks / total_tracks) * 100), 100)
                
                # Create parent progress update
                progress_update = {
                    "status": ProgressState.PROGRESS,
                    "type": parent_type,
                    "track": title,
                    "current_track": f"{processed_tracks}/{total_tracks}",
                    "album": data.get('album', ''),
                    "artist": artist,
                    "timestamp": data['timestamp'],
                    "parsed_current_track": processed_tracks,
                    "parsed_total_tracks": total_tracks,
                    "overall_progress": overall_progress,
                    "track_skipped": True,
                    "skip_reason": reason,
                    "parent_task": True
                }
                
                # Store progress update
                store_task_status(task_id, progress_update)
        
        # Set status
        data['status'] = ProgressState.SKIPPED
        
    def _handle_retrying(self, task_id, data, task_info):
        """Handle retrying status from deezspot"""
        # Extract retry info
        song = data.get('song', 'Unknown')
        artist = data.get('artist', 'Unknown')
        retry_count = data.get('retry_count', 0)
        seconds_left = data.get('seconds_left', 0)
        error = data.get('error', 'Unknown error')
        
        # Log retry
        logger.warning(f"Task {task_id} retrying: {artist} - {song} (Attempt {retry_count}, waiting {seconds_left}s)")
        logger.debug(f"Task {task_id} retry reason: {error}")
        
        # Update task info
        retry_count_total = task_info.get('retry_count', 0) + 1
        task_info['retry_count'] = retry_count_total
        store_task_info(task_id, task_info)
        
        # Set status
        data['status'] = ProgressState.RETRYING
        
    def _handle_error(self, task_id, data, task_info):
        """Handle error status from deezspot"""
        # Extract error info
        message = data.get('message', 'Unknown error')
        
        # Log error
        logger.error(f"Task {task_id} error: {message}")
        
        # Update task info
        error_count = task_info.get('error_count', 0) + 1
        task_info['error_count'] = error_count
        store_task_info(task_id, task_info)
        
        # Set status
        data['status'] = ProgressState.ERROR
        
    def _handle_done(self, task_id, data, task_info):
        """Handle done status from deezspot"""
        # Extract data
        content_type = data.get('type', '').lower()
        album = data.get('album', '')
        artist = data.get('artist', '')
        song = data.get('song', '')
        
        # Handle based on content type
        if content_type == 'track':
            # For track completions
            if artist and song:
                logger.info(f"Task {task_id} completed: Track '{song}' by {artist}")
            else:
                logger.info(f"Task {task_id} completed: Track '{song}'")
                
            # Update status to track_complete
            data['status'] = ProgressState.TRACK_COMPLETE
            
            # Update task info
            completed_tracks = task_info.get('completed_tracks', 0) + 1
            task_info['completed_tracks'] = completed_tracks
            store_task_info(task_id, task_info)
            
            # If part of album/playlist, update progress
            parent_type = task_info.get('type', '').lower()
            if parent_type in ['album', 'playlist']:
                total_tracks = task_info.get('total_tracks', 0)
                if total_tracks > 0:
                    completion_percent = int((completed_tracks / total_tracks) * 100)
                    
                    # Create progress update
                    progress_update = {
                        "status": ProgressState.PROGRESS,
                        "type": parent_type,
                        "track": song,
                        "current_track": f"{completed_tracks}/{total_tracks}",
                        "album": album,
                        "artist": artist,
                        "timestamp": data['timestamp'],
                        "parsed_current_track": completed_tracks,
                        "parsed_total_tracks": total_tracks,
                        "overall_progress": completion_percent,
                        "track_complete": True,
                        "parent_task": True
                    }
                    
                    # Store progress update
                    store_task_status(task_id, progress_update)
            
        elif content_type in ['album', 'playlist']:
            # Get completion counts
            completed_tracks = task_info.get('completed_tracks', 0)
            skipped_tracks = task_info.get('skipped_tracks', 0)
            error_count = task_info.get('error_count', 0)
            
            # Log completion
            if album and artist:
                logger.info(f"Task {task_id} completed: {content_type.upper()} '{album}' by {artist}")
            elif album:
                logger.info(f"Task {task_id} completed: {content_type.upper()} '{album}'")
            else:
                name = data.get('name', '')
                if name:
                    logger.info(f"Task {task_id} completed: {content_type.upper()} '{name}'")
                else:
                    logger.info(f"Task {task_id} completed: {content_type.upper()}")
            
            # Add summary
            data["status"] = ProgressState.COMPLETE
            data["message"] = f"Download complete: {completed_tracks} tracks downloaded, {skipped_tracks} skipped"
            
            # Log summary
            logger.info(f"Task {task_id} summary: {completed_tracks} completed, {skipped_tracks} skipped, {error_count} errors")
            
        else:
            # Generic done for other types
            logger.info(f"Task {task_id} completed: {content_type.upper()}")
            data["status"] = ProgressState.COMPLETE
            data["message"] = "Download complete"

# Celery signal handlers
@task_prerun.connect
def task_prerun_handler(task_id=None, task=None, *args, **kwargs):
    """Signal handler when a task begins running"""
    try:
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
        
        # Get task info
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
        # Skip if Retry exception
        if isinstance(exception, Retry):
            return
        
        # Get task info and status
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
        
        # Get config parameters
        config_params = get_config_params()
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)
        
        # Determine service parameters
        if service == 'spotify':
            if fallback_enabled:
                main = config_params.get("deezer", "")
                fallback = config_params.get("spotify", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == 'deezer':
            main = config_params.get("deezer", "")
            fallback = None
            quality = config_params.get("deezerQuality", "MP3_128")
            fall_quality = None
        else:
            main = config_params.get("spotify", "")
            fallback = None
            quality = config_params.get("spotifyQuality", "NORMAL")
            fall_quality = None
        
        # Get remaining parameters
        url = task_data.get("url", "")
        real_time = task_data.get("real_time", config_params.get("realTime", False))
        custom_dir_format = task_data.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
        custom_track_format = task_data.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
        pad_tracks = task_data.get("pad_tracks", config_params.get("tracknum_padding", True))
        
        # Execute the download
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
            progress_callback=self.progress_callback
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
        
        # Get config parameters
        config_params = get_config_params()
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)
        
        # Determine service parameters
        if service == 'spotify':
            if fallback_enabled:
                main = config_params.get("deezer", "")
                fallback = config_params.get("spotify", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == 'deezer':
            main = config_params.get("deezer", "")
            fallback = None
            quality = config_params.get("deezerQuality", "MP3_128")
            fall_quality = None
        else:
            main = config_params.get("spotify", "")
            fallback = None
            quality = config_params.get("spotifyQuality", "NORMAL")
            fall_quality = None
        
        # Get remaining parameters
        url = task_data.get("url", "")
        real_time = task_data.get("real_time", config_params.get("realTime", False))
        custom_dir_format = task_data.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
        custom_track_format = task_data.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
        pad_tracks = task_data.get("pad_tracks", config_params.get("tracknum_padding", True))
        
        # Execute the download
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
            progress_callback=self.progress_callback
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
        
        # Get config parameters
        config_params = get_config_params()
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)
        
        # Determine service parameters
        if service == 'spotify':
            if fallback_enabled:
                main = config_params.get("deezer", "")
                fallback = config_params.get("spotify", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == 'deezer':
            main = config_params.get("deezer", "")
            fallback = None
            quality = config_params.get("deezerQuality", "MP3_128")
            fall_quality = None
        else:
            main = config_params.get("spotify", "")
            fallback = None
            quality = config_params.get("spotifyQuality", "NORMAL")
            fall_quality = None
        
        # Get remaining parameters
        url = task_data.get("url", "")
        real_time = task_data.get("real_time", config_params.get("realTime", False))
        custom_dir_format = task_data.get("custom_dir_format", config_params.get("customDirFormat", "%ar_album%/%album%"))
        custom_track_format = task_data.get("custom_track_format", config_params.get("customTrackFormat", "%tracknum%. %music%"))
        pad_tracks = task_data.get("pad_tracks", config_params.get("tracknum_padding", True))
        
        # Get retry parameters
        initial_retry_delay = task_data.get("initial_retry_delay", config_params.get("retryDelaySeconds", 5))
        retry_delay_increase = task_data.get("retry_delay_increase", config_params.get("retry_delay_increase", 5))
        max_retries = task_data.get("max_retries", config_params.get("maxRetries", 3))
        
        # Execute the download
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
            initial_retry_delay=initial_retry_delay,
            retry_delay_increase=retry_delay_increase,
            max_retries=max_retries,
            progress_callback=self.progress_callback,
        )
        
        return {"status": "success", "message": "Playlist download completed"}
    except Exception as e:
        logger.error(f"Error in download_playlist task: {e}")
        traceback.print_exc()
        raise 