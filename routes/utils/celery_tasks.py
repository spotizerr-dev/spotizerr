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
    CANCELLED = "cancel"

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
    """Store task status information in Redis"""
    # Add timestamp if not present
    if 'timestamp' not in status_data:
        status_data['timestamp'] = time.time()
    
    # Convert to JSON and store in Redis
    try:
        redis_client.rpush(f"task:{task_id}:status", json.dumps(status_data))
        # Set expiry for the list to avoid filling up Redis with old data
        redis_client.expire(f"task:{task_id}:status", 60 * 60 * 24 * 7)  # 7 days
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
        last_status = redis_client.lindex(f"task:{task_id}:status", -1)
        if last_status:
            return json.loads(last_status.decode('utf-8'))
        return None
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
        
        # Add timestamp if not present
        if 'timestamp' not in progress_data:
            progress_data['timestamp'] = time.time()
        
        # Map deezspot status to our progress state
        status = progress_data.get("status", "unknown")
        
        # Store the progress update in Redis
        store_task_status(task_id, progress_data)
        
        # Log the progress update with appropriate level
        message = progress_data.get("message", "Progress update")
        
        if status == "processing":
            progress = progress_data.get("progress", 0)
            if progress > 0:
                logger.debug(f"Task {task_id} progress: {progress}% - {message}")
            else:
                logger.info(f"Task {task_id} processing: {message}")
        elif status == "error":
            error_message = progress_data.get("error", message)
            logger.error(f"Task {task_id} error: {error_message}")
        elif status == "complete":
            logger.info(f"Task {task_id} completed: {message}")
        else:
            logger.info(f"Task {task_id} {status}: {message}")

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