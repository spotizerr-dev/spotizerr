import os
import json
import time
import uuid
import logging
from datetime import datetime

from routes.utils.celery_tasks import (
    celery_app, 
    download_track, 
    download_album, 
    download_playlist,
    store_task_status, 
    store_task_info,
    get_task_info,
    get_task_status,
    get_last_task_status,
    cancel_task as cancel_celery_task,
    retry_task as retry_celery_task,
    get_all_tasks,
    ProgressState
)

# Configure logging
logger = logging.getLogger(__name__)

# Load configuration
CONFIG_PATH = './config/main.json'
try:
    with open(CONFIG_PATH, 'r') as f:
        config_data = json.load(f)
    MAX_CONCURRENT_DL = config_data.get("maxConcurrentDownloads", 10)
except Exception as e:
    print(f"Error loading configuration: {e}")
    # Fallback default
    MAX_CONCURRENT_DL = 10

def get_config_params():
    """
    Get common download parameters from the config file.
    This centralizes parameter retrieval and reduces redundancy in API calls.
    
    Returns:
        dict: A dictionary containing common parameters from config
    """
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            
        return {
            'spotify': config.get('spotify', ''),
            'deezer': config.get('deezer', ''),
            'fallback': config.get('fallback', False),
            'spotifyQuality': config.get('spotifyQuality', 'NORMAL'),
            'deezerQuality': config.get('deezerQuality', 'MP3_128'),
            'realTime': config.get('realTime', False),
            'customDirFormat': config.get('customDirFormat', '%ar_album%/%album%'),
            'customTrackFormat': config.get('customTrackFormat', '%tracknum%. %music%'),
            'tracknum_padding': config.get('tracknum_padding', True),
            'maxRetries': config.get('maxRetries', 3),
            'retryDelaySeconds': config.get('retryDelaySeconds', 5),
            'retry_delay_increase': config.get('retry_delay_increase', 5)
        }
    except Exception as e:
        logger.error(f"Error reading config for parameters: {e}")
        # Return defaults if config read fails
        return {
            'spotify': '',
            'deezer': '',
            'fallback': False,
            'spotifyQuality': 'NORMAL',
            'deezerQuality': 'MP3_128',
            'realTime': False,
            'customDirFormat': '%ar_album%/%album%',
            'customTrackFormat': '%tracknum%. %music%',
            'tracknum_padding': True,
            'maxRetries': 3,
            'retryDelaySeconds': 5,
            'retry_delay_increase': 5
        }

class CeleryDownloadQueueManager:
    """
    Manages a queue of download tasks using Celery.
    This is a drop-in replacement for the previous DownloadQueueManager.
    
    Instead of using file-based progress tracking, it uses Redis via Celery
    for task management and progress tracking.
    """
    
    def __init__(self):
        """Initialize the Celery-based download queue manager"""
        self.max_concurrent = MAX_CONCURRENT_DL
        self.paused = False
        print(f"Celery Download Queue Manager initialized with max_concurrent={self.max_concurrent}")
    
    def add_task(self, task):
        """
        Add a new download task to the Celery queue
        
        Args:
            task (dict): Task parameters including download_type, url, etc.
            
        Returns:
            str: Task ID
        """
        try:
            # Extract essential parameters
            download_type = task.get("download_type", "unknown")
            
            # Debug existing task data
            logger.debug(f"Adding {download_type} task with data: {json.dumps({k: v for k, v in task.items() if k != 'orig_request'})}")
            
            # Create a unique task ID
            task_id = str(uuid.uuid4())
            
            # Get config parameters and process original request
            config_params = get_config_params()
            
            # Extract original request or use empty dict
            original_request = task.get("orig_request", task.get("original_request", {}))
            
            # Determine service (spotify or deezer) from config or request
            service = original_request.get("service", config_params.get("service", "spotify"))
            
            # Debug retry_url if present
            if "retry_url" in task:
                logger.debug(f"Task has retry_url: {task['retry_url']}")
            
            # Build the complete task with config parameters
            complete_task = {
                "download_type": download_type,
                "type": task.get("type", download_type),
                "name": task.get("name", ""),
                "artist": task.get("artist", ""),
                "service": service,
                "url": task.get("url", ""),
                
                # Preserve retry_url if present
                "retry_url": task.get("retry_url", ""),
                
                # Use config values but allow override from request
                "main": original_request.get("main", 
                    config_params['spotify'] if service == 'spotify' else config_params['deezer']),
                
                "fallback": original_request.get("fallback", 
                    config_params['spotify'] if config_params['fallback'] and service == 'spotify' else None),
                
                "quality": original_request.get("quality", 
                    config_params['spotifyQuality'] if service == 'spotify' else config_params['deezerQuality']),
                
                "fall_quality": original_request.get("fall_quality", config_params['spotifyQuality']),
                
                # Parse boolean parameters from string values
                "real_time": self._parse_bool_param(original_request.get("real_time"), config_params['realTime']),
                
                "custom_dir_format": original_request.get("custom_dir_format", config_params['customDirFormat']),
                "custom_track_format": original_request.get("custom_track_format", config_params['customTrackFormat']),
                
                # Parse boolean parameters from string values
                "pad_tracks": self._parse_bool_param(original_request.get("tracknum_padding"), config_params['tracknum_padding']),
                
                "retry_count": 0,
                "original_request": original_request,
                "created_at": time.time()
            }
            
            # Store the task info in Redis for later retrieval
            store_task_info(task_id, complete_task)
            
            # Store initial queued status
            store_task_status(task_id, {
                "status": ProgressState.QUEUED,
                "timestamp": time.time(),
                "type": complete_task["type"],
                "name": complete_task["name"],
                "artist": complete_task["artist"],
                "retry_count": 0,
                "queue_position": len(get_all_tasks()) + 1  # Approximate queue position
            })
            
            # Launch the appropriate Celery task based on download_type
            celery_task = None
            
            if download_type == "track":
                celery_task = download_track.apply_async(
                    kwargs=complete_task,
                    task_id=task_id,
                    countdown=0 if not self.paused else 3600  # Delay task if paused
                )
            elif download_type == "album":
                celery_task = download_album.apply_async(
                    kwargs=complete_task,
                    task_id=task_id,
                    countdown=0 if not self.paused else 3600
                )
            elif download_type == "playlist":
                celery_task = download_playlist.apply_async(
                    kwargs=complete_task,
                    task_id=task_id,
                    countdown=0 if not self.paused else 3600
                )
            else:
                # Store error status for unknown download type
                store_task_status(task_id, {
                    "status": ProgressState.ERROR,
                    "message": f"Unsupported download type: {download_type}",
                    "timestamp": time.time()
                })
                logger.error(f"Unsupported download type: {download_type}")
                return task_id  # Still return the task_id so the error can be tracked
            
            logger.info(f"Added {download_type} download task {task_id} to Celery queue")
            return task_id
            
        except Exception as e:
            logger.error(f"Error adding task to Celery queue: {e}", exc_info=True)
            # Generate a task ID even for failed tasks so we can track the error
            error_task_id = str(uuid.uuid4())
            store_task_status(error_task_id, {
                "status": ProgressState.ERROR,
                "message": f"Error adding task to queue: {str(e)}",
                "timestamp": time.time(),
                "type": task.get("type", "unknown"),
                "name": task.get("name", "Unknown"),
                "artist": task.get("artist", "")
            })
            return error_task_id
    
    def _parse_bool_param(self, param_value, default_value=False):
        """Helper function to parse boolean parameters from string values"""
        if param_value is None:
            return default_value
        if isinstance(param_value, bool):
            return param_value
        if isinstance(param_value, str):
            return param_value.lower() in ['true', '1', 'yes', 'y', 'on']
        return bool(param_value)
    
    def cancel_task(self, task_id):
        """
        Cancels a task by its ID.
        
        Args:
            task_id (str): The ID of the task to cancel
            
        Returns:
            dict: Status information about the cancellation
        """
        return cancel_celery_task(task_id)
    
    def retry_task(self, task_id):
        """
        Retry a failed task.
        
        Args:
            task_id (str): The ID of the failed task to retry
            
        Returns:
            dict: Status information about the retry
        """
        return retry_celery_task(task_id)
    
    def cancel_all_tasks(self):
        """
        Cancel all currently queued and running tasks.
        
        Returns:
            dict: Status information about the cancellation
        """
        tasks = get_all_tasks()
        cancelled_count = 0
        
        for task in tasks:
            task_id = task.get("task_id")
            status = task.get("status")
            
            # Only cancel tasks that are not already completed or cancelled
            if status not in [ProgressState.COMPLETE, ProgressState.CANCELLED]:
                result = cancel_celery_task(task_id)
                if result.get("status") == "cancelled":
                    cancelled_count += 1
        
        return {
            "status": "all_cancelled",
            "cancelled_count": cancelled_count,
            "total_tasks": len(tasks)
        }
    
    def get_queue_status(self):
        """
        Get the current status of the queue.
        
        Returns:
            dict: Status information about the queue
        """
        tasks = get_all_tasks()
        
        # Count tasks by status
        running_count = 0
        pending_count = 0
        failed_count = 0
        
        running_tasks = []
        failed_tasks = []
        
        for task in tasks:
            status = task.get("status")
            
            if status == ProgressState.PROCESSING:
                running_count += 1
                running_tasks.append({
                    "task_id": task.get("task_id"),
                    "name": task.get("name", "Unknown"),
                    "type": task.get("type", "unknown"),
                    "download_type": task.get("download_type", "unknown")
                })
            elif status == ProgressState.QUEUED:
                pending_count += 1
            elif status == ProgressState.ERROR:
                failed_count += 1
                
                # Get task info for retry information
                task_info = get_task_info(task.get("task_id"))
                last_status = get_last_task_status(task.get("task_id"))
                
                retry_count = 0
                if last_status:
                    retry_count = last_status.get("retry_count", 0)
                
                failed_tasks.append({
                    "task_id": task.get("task_id"),
                    "name": task.get("name", "Unknown"),
                    "type": task.get("type", "unknown"),
                    "download_type": task.get("download_type", "unknown"),
                    "retry_count": retry_count
                })
        
        return {
            "running": running_count,
            "pending": pending_count,
            "failed": failed_count,
            "max_concurrent": self.max_concurrent,
            "paused": self.paused,
            "running_tasks": running_tasks,
            "failed_tasks": failed_tasks
        }
    
    def pause(self):
        """Pause processing of new tasks."""
        self.paused = True
        
        # Get all queued tasks
        tasks = get_all_tasks()
        for task in tasks:
            if task.get("status") == ProgressState.QUEUED:
                # Update status to indicate the task is paused
                store_task_status(task.get("task_id"), {
                    "status": ProgressState.QUEUED,
                    "paused": True,
                    "message": "Queue is paused, task will run when queue is resumed",
                    "timestamp": time.time()
                })
        
        logger.info("Download queue processing paused")
        return {"status": "paused"}
    
    def resume(self):
        """Resume processing of tasks."""
        self.paused = False
        
        # Get all queued tasks
        tasks = get_all_tasks()
        for task in tasks:
            if task.get("status") == ProgressState.QUEUED:
                task_id = task.get("task_id")
                
                # Get the task info
                task_info = get_task_info(task_id)
                if not task_info:
                    continue
                
                # Update status to indicate the task is no longer paused
                store_task_status(task_id, {
                    "status": ProgressState.QUEUED,
                    "paused": False,
                    "message": "Queue resumed, task will run soon",
                    "timestamp": time.time()
                })
                
                # Reschedule the task to run immediately
                download_type = task_info.get("download_type", "unknown")
                
                if download_type == "track":
                    download_track.apply_async(
                        kwargs=task_info,
                        task_id=task_id
                    )
                elif download_type == "album":
                    download_album.apply_async(
                        kwargs=task_info,
                        task_id=task_id
                    )
                elif download_type == "playlist":
                    download_playlist.apply_async(
                        kwargs=task_info,
                        task_id=task_id
                    )
        
        logger.info("Download queue processing resumed")
        return {"status": "resumed"}
    
    def start(self):
        """Start the queue manager (no-op for Celery implementation)."""
        logger.info("Celery Download Queue Manager started")
        return {"status": "started"}
    
    def stop(self):
        """Stop the queue manager (graceful shutdown)."""
        logger.info("Celery Download Queue Manager stopping...")
        
        # Cancel all tasks or just let them finish?
        # For now, we'll let them finish and just log the shutdown
        
        logger.info("Celery Download Queue Manager stopped")
        return {"status": "stopped"}

# Create the global instance
download_queue_manager = CeleryDownloadQueueManager() 