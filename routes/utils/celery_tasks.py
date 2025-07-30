import time
import json
import logging
import traceback
from celery import Celery, Task, states
from celery.signals import (
    task_prerun,
    task_postrun,
    task_failure,
    worker_ready,
    worker_init,
    setup_logging,
)
from celery.exceptions import Retry
from pathlib import Path  # Added for path operations


# Setup Redis and Celery
from routes.utils.celery_config import (
    REDIS_URL,
    REDIS_BACKEND,
    get_config_params,
)

# Import for playlist watch DB update
from routes.utils.watch.db import (
    add_single_track_to_playlist_db,
    add_or_update_album_for_artist,
)

# Import for download history management
from routes.utils.history_manager import history_manager

# Create Redis connection for storing task data that's not part of the Celery result backend
import redis

# Configure logging
logger = logging.getLogger(__name__)

# Initialize Celery app
celery_app = Celery(
    "routes.utils.celery_tasks", broker=REDIS_URL, backend=REDIS_BACKEND
)

# Load Celery config
celery_app.config_from_object("routes.utils.celery_config")


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
    ERROR_RETRIED = "ERROR_RETRIED"  # Status for an error task that has been retried
    ERROR_AUTO_CLEANED = (
        "ERROR_AUTO_CLEANED"  # Status for an error task that was auto-cleaned
    )


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
    logger.info(
        f"Celery worker initialized with concurrency {config.get('maxConcurrentDownloads', 3)}"
    )
    logger.info(
        f"Worker config: spotifyQuality={config.get('spotifyQuality')}, deezerQuality={config.get('deezerQuality')}"
    )
    logger.debug("Worker Redis connection: " + REDIS_URL)


def store_task_status(task_id, status_data):
    """
    Store task status information in Redis with a sequential ID

    Args:
        task_id: The task ID
        status_data: Dictionary containing status information
    """
    # Add timestamp if not present
    if "timestamp" not in status_data:
        status_data["timestamp"] = time.time()

    try:
        # Get next ID for this task's status updates
        status_id = redis_client.incr(f"task:{task_id}:status:next_id")
        status_data["id"] = status_id

        # Convert to JSON and store in Redis
        redis_client.rpush(f"task:{task_id}:status", json.dumps(status_data))

        # Set expiry for the list to avoid filling up Redis with old data
        redis_client.expire(f"task:{task_id}:status", 60 * 60 * 24 * 7)  # 7 days
        redis_client.expire(
            f"task:{task_id}:status:next_id", 60 * 60 * 24 * 7
        )  # 7 days

        # Publish an update event to a Redis channel for subscribers
        # This will be used by the SSE endpoint to push updates in real-time
        update_channel = f"task_updates:{task_id}"
        redis_client.publish(
            update_channel, json.dumps({"task_id": task_id, "status_id": status_id})
        )
    except Exception as e:
        logger.error(f"Error storing task status: {e}")
        traceback.print_exc()


def get_task_status(task_id):
    """Get all task status updates from Redis"""
    try:
        status_list = redis_client.lrange(f"task:{task_id}:status", 0, -1)
        return [json.loads(s.decode("utf-8")) for s in status_list]
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

        return json.loads(status_list[0].decode("utf-8"))
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
            return json.loads(task_info.decode("utf-8"))
        return {}
    except Exception as e:
        logger.error(f"Error getting task info: {e}")
        return {}


def get_all_tasks():
    """Get all active task IDs and their full info"""
    try:
        # Use SCAN for better performance than KEYS in production
        task_ids = [
            key.decode("utf-8").split(":")[1]
            for key in redis_client.scan_iter("task:*:info")
        ]

        tasks = []
        for task_id in task_ids:
            task_info = get_task_info(task_id)
            last_status = get_last_task_status(task_id)

            if task_info and last_status:
                tasks.append(
                    {
                        "task_id": task_id,
                        "task_info": task_info,  # Pass full info
                        "last_status": last_status,  # Pass last status
                        # Keep original fields for backward compatibility
                        "type": task_info.get("type", "unknown"),
                        "name": task_info.get("name", "Unknown"),
                        "artist": task_info.get("artist", ""),
                        "download_type": task_info.get("download_type", "unknown"),
                        "status": last_status.get("status", "unknown"),
                        "timestamp": last_status.get("timestamp", 0),
                    }
                )

        return tasks
    except Exception as e:
        logger.error(f"Error getting all tasks: {e}")
        return []


def cancel_task(task_id):
    """Cancel a task by its ID"""
    try:
        # Mark the task as cancelled in Redis
        store_task_status(
            task_id,
            {
                "status": ProgressState.CANCELLED,
                "error": "Task cancelled by user",
                "timestamp": time.time(),
            },
        )

        # Try to revoke the Celery task if it hasn't started yet
        celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")

        # Schedule deletion of task data after 30 seconds
        delayed_delete_task_data.apply_async(
            args=[task_id, "Task cancelled by user and auto-cleaned."], countdown=30
        )
        logger.info(
            f"Task {task_id} cancelled by user. Data scheduled for deletion in 30s."
        )

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
            return {"status": "error", "error": f"Task {task_id} not found"}

        # Check if task has error status
        last_status = get_last_task_status(task_id)
        if not last_status or last_status.get("status") != ProgressState.ERROR:
            return {"status": "error", "error": "Task is not in a failed state"}

        # Get current retry count
        retry_count = last_status.get("retry_count", 0)

        # Get retry configuration from config
        config_params = get_config_params()
        max_retries = config_params.get("maxRetries", 3)
        initial_retry_delay = config_params.get("retryDelaySeconds", 5)
        retry_delay_increase = config_params.get("retry_delay_increase", 5)

        # Check if we've exceeded max retries
        if retry_count >= max_retries:
            return {
                "status": "error",
                "error": f"Maximum retry attempts ({max_retries}) exceeded",
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
        if service == "spotify":
            if fallback_enabled:
                task_info["main"] = config_params.get("spotify", "")
                task_info["fallback"] = config_params.get("deezer", "")
                task_info["quality"] = config_params.get("deezerQuality", "MP3_128")
                task_info["fall_quality"] = config_params.get(
                    "spotifyQuality", "NORMAL"
                )
            else:
                task_info["main"] = config_params.get("spotify", "")
                task_info["fallback"] = None
                task_info["quality"] = config_params.get("spotifyQuality", "NORMAL")
                task_info["fall_quality"] = None
        elif service == "deezer":
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
        task_info["real_time"] = task_info.get(
            "real_time", config_params.get("realTime", False)
        )
        task_info["custom_dir_format"] = task_info.get(
            "custom_dir_format",
            config_params.get("customDirFormat", "%ar_album%/%album%"),
        )
        task_info["custom_track_format"] = task_info.get(
            "custom_track_format",
            config_params.get("customTrackFormat", "%tracknum%. %music%"),
        )
        task_info["pad_tracks"] = task_info.get(
            "pad_tracks", config_params.get("tracknum_padding", True)
        )

        # Store the updated task info
        store_task_info(new_task_id, task_info)

        # Create a queued status
        store_task_status(
            new_task_id,
            {
                "status": ProgressState.QUEUED,
                "type": task_info.get("type", "unknown"),
                "name": task_info.get("name", "Unknown"),
                "artist": task_info.get("artist", ""),
                "retry_count": retry_count + 1,
                "max_retries": max_retries,
                "retry_delay": retry_delay,
                "timestamp": time.time(),
            },
        )

        # Launch the appropriate task based on download_type
        download_type = task_info.get("download_type", "unknown")
        new_celery_task_obj = None

        logger.info(
            f"Retrying task {task_id} as {new_task_id} (retry {retry_count + 1}/{max_retries})"
        )

        if download_type == "track":
            new_celery_task_obj = download_track.apply_async(
                kwargs=task_info, task_id=new_task_id, queue="downloads"
            )
        elif download_type == "album":
            new_celery_task_obj = download_album.apply_async(
                kwargs=task_info, task_id=new_task_id, queue="downloads"
            )
        elif download_type == "playlist":
            new_celery_task_obj = download_playlist.apply_async(
                kwargs=task_info, task_id=new_task_id, queue="downloads"
            )
        else:
            logger.error(f"Unknown download type for retry: {download_type}")
            store_task_status(
                new_task_id,
                {
                    "status": ProgressState.ERROR,
                    "error": f"Cannot retry: Unknown download type '{download_type}' for original task {task_id}",
                    "timestamp": time.time(),
                },
            )
            return {
                "status": "error",
                "error": f"Unknown download type: {download_type}",
            }

        # If retry was successfully submitted, update the original task's status
        if new_celery_task_obj:
            store_task_status(
                task_id,
                {
                    "status": "ERROR_RETRIED",
                    "error": f"Task superseded by retry: {new_task_id}",
                    "retried_as_task_id": new_task_id,
                    "timestamp": time.time(),
                },
            )
            logger.info(
                f"Original task {task_id} status updated to ERROR_RETRIED, superseded by {new_task_id}"
            )
        else:
            logger.error(
                f"Retry submission for task {task_id} (as {new_task_id}) did not return a Celery AsyncResult. Original task not marked as ERROR_RETRIED."
            )

        return {
            "status": "requeued",
            "task_id": new_task_id,
            "retry_count": retry_count + 1,
            "max_retries": max_retries,
            "retry_delay": retry_delay,
        }
    except Exception as e:
        logger.error(f"Error retrying task {task_id}: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}

class ProgressTrackingTask(Task):
    """Base task class that tracks progress through callbacks"""

    def progress_callback(self, progress_data):
        """
        Process progress data from deezspot library callbacks using the optimized approach
        based on known status types and flow patterns.

        Args:
            progress_data: Dictionary containing progress information from deezspot
        """
        # Store a copy of the original, unprocessed callback data
        raw_callback_data = progress_data.copy()

        task_id = self.request.id

        # Ensure ./logs/tasks directory exists
        logs_tasks_dir = Path("./logs/tasks")  
        try:
            logs_tasks_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.error(
                f"Task {task_id}: Could not create log directory {logs_tasks_dir}: {e}"
            )

        # Define log file path
        log_file_path = logs_tasks_dir / f"{task_id}.log"

        # Log progress_data to the task-specific file
        try:
            with open(log_file_path, "a") as log_file:
                log_entry = progress_data.copy()
                if "timestamp" not in log_entry:
                    log_entry["timestamp"] = time.time()
                print(json.dumps(log_entry), file=log_file)  
        except Exception as e:
            logger.error(
                f"Task {task_id}: Could not write to task log file {log_file_path}: {e}"
            )

        if "timestamp" not in progress_data:
            progress_data["timestamp"] = time.time()

        # Extract status from status_info (deezspot callback format)
        status_info = progress_data.get("status_info", {})
        status = status_info.get("status", progress_data.get("status", "unknown"))
        task_info = get_task_info(task_id)
        
        logger.debug(f"Task {task_id}: Extracted status: '{status}' from callback")

        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(
                f"Task {task_id}: Raw progress data: {json.dumps(progress_data)}"
            )

        if status == "initializing":
            self._handle_initializing(task_id, progress_data, task_info)
        elif status == "downloading":
            self._handle_downloading(task_id, progress_data, task_info)
        elif status == "progress":
            self._handle_progress(task_id, progress_data, task_info)
        elif status in ["real_time", "track_progress"]:
            self._handle_real_time(task_id, progress_data)
        elif status == "skipped":
            # Re-fetch task_info to ensure we have the latest children_table info
            task_info = get_task_info(task_id)
            self._handle_skipped(task_id, progress_data, task_info)
        elif status == "retrying":
            self._handle_retrying(task_id, progress_data, task_info)
        elif status == "error":
            # Re-fetch task_info to ensure we have the latest children_table info
            task_info = get_task_info(task_id)
            self._handle_error(task_id, progress_data, task_info)
        elif status == "done":
            # Re-fetch task_info to ensure we have the latest children_table info
            task_info = get_task_info(task_id)
            self._handle_done(task_id, progress_data, task_info)
        else:
            logger.info(
                f"Task {task_id} {status}: {progress_data.get('message', 'No details')}"
            )

        progress_data["raw_callback"] = raw_callback_data
        store_task_status(task_id, progress_data)

    def _handle_initializing(self, task_id, data, task_info):
        """Handle initializing status from deezspot"""
        logger.info(f"Task {task_id} initializing...")
        
        # Initializing object is now very basic, mainly for acknowledging the start.
        # More detailed info comes with 'progress' or 'downloading' states.
        data["status"] = ProgressState.INITIALIZING
        
        # Store initial history entry for download start
        try:
            # Check for album/playlist FIRST since their callbacks contain both parent and track info
            if "album" in data:
                # Album download - create children table and store name in task info
                logger.info(f"Task {task_id}: Creating album children table")
                children_table = history_manager.store_album_history(data, task_id, "in_progress")
                if children_table:
                    task_info["children_table"] = children_table
                    store_task_info(task_id, task_info)
                    logger.info(f"Task {task_id}: Created and stored children table '{children_table}' in task info")
                else:
                    logger.error(f"Task {task_id}: Failed to create album children table")
            elif "playlist" in data:
                # Playlist download - create children table and store name in task info
                logger.info(f"Task {task_id}: Creating playlist children table")
                children_table = history_manager.store_playlist_history(data, task_id, "in_progress")
                if children_table:
                    task_info["children_table"] = children_table
                    store_task_info(task_id, task_info)
                    logger.info(f"Task {task_id}: Created and stored children table '{children_table}' in task info")
                else:
                    logger.error(f"Task {task_id}: Failed to create playlist children table")
            elif "track" in data:
                # Individual track download - check if it's part of an album/playlist
                children_table = task_info.get("children_table")
                if children_table:
                    # Track is part of album/playlist - don't store in main table during initialization
                    logger.info(f"Task {task_id}: Skipping track initialization storage (part of album/playlist, children table: {children_table})")
                else:
                    # Individual track download - store in main table
                    logger.info(f"Task {task_id}: Storing individual track history (initializing)")
                    history_manager.store_track_history(data, task_id, "in_progress")
        except Exception as e:
            logger.error(f"Failed to store initial history for task {task_id}: {e}", exc_info=True)

    def _handle_downloading(self, task_id, data, task_info):
        """Handle downloading status from deezspot"""
        track_obj = data.get("track", {})
        track_name = track_obj.get("title", "Unknown")
        
        artists = track_obj.get("artists", [])
        artist_name = artists[0].get("name", "") if artists else ""
        
        album_obj = track_obj.get("album", {})
        album_name = album_obj.get("title", "")

        logger.info(f"Task {task_id}: Starting download for track '{track_name}' by {artist_name}")

        data["status"] = ProgressState.DOWNLOADING
        data["song"] = track_name
        data["artist"] = artist_name
        data["album"] = album_name

    def _handle_progress(self, task_id, data, task_info):
        """Handle progress status for albums/playlists from deezspot"""
        item = data.get("playlist") or data.get("album", {})
        track = data.get("track", {})
        
        item_name = item.get("title", "Unknown Item")
        total_tracks = item.get("total_tracks", 0)
        
        track_name = track.get("title", "Unknown Track")
        artists = track.get("artists", [])
        artist_name = artists[0].get("name", "") if artists else ""
        
        # The 'progress' field in the callback is the track number being processed
        current_track_num = data.get("progress", 0)

        if total_tracks > 0:
            task_info["total_tracks"] = total_tracks
            task_info["completed_tracks"] = current_track_num - 1
            task_info["current_track_num"] = current_track_num
            store_task_info(task_id, task_info)
            
            overall_progress = min(int(((current_track_num -1) / total_tracks) * 100), 100)
            data["overall_progress"] = overall_progress
            data["parsed_current_track"] = current_track_num
            data["parsed_total_tracks"] = total_tracks

        logger.info(f"Task {task_id}: Progress on '{item_name}': Processing track {current_track_num}/{total_tracks} - '{track_name}'")

        data["status"] = ProgressState.PROGRESS
        data["song"] = track_name
        data["artist"] = artist_name
        data["current_track"] = f"{current_track_num}/{total_tracks}"

    def _handle_real_time(self, task_id, data):
        """Handle real-time progress status from deezspot"""
        track_obj = data.get("track", {})
        track_name = track_obj.get("title", "Unknown Track")
        percentage = data.get("percentage", 0)
        
        logger.debug(f"Task {task_id}: Real-time progress for '{track_name}': {percentage}%")
        
        data["status"] = ProgressState.TRACK_PROGRESS
        data["song"] = track_name
        artist = data.get("artist", "Unknown")

        # Handle percent formatting
        percent = data.get("percent", data.get("percentage", 0))
        if isinstance(percent, float) and percent <= 1.0:
            percent = int(percent * 100)
            data["percent"] = percent

        # Calculate download rate if bytes_received is available
        if "bytes_received" in data:
            last_update = data.get("last_update_time", data["timestamp"])
            bytes_received = data["bytes_received"]
            last_bytes = data.get("last_bytes_received", 0)
            time_diff = data["timestamp"] - last_update

            if time_diff > 0 and bytes_received > last_bytes:
                bytes_diff = bytes_received - last_bytes
                download_rate = bytes_diff / time_diff
                data["download_rate"] = download_rate
                data["last_update_time"] = data["timestamp"]
                data["last_bytes_received"] = bytes_received

                # Format download rate for display
                if download_rate < 1024:
                    data["download_rate_formatted"] = f"{download_rate:.2f} B/s"
                elif download_rate < 1024 * 1024:
                    data["download_rate_formatted"] = f"{download_rate / 1024:.2f} KB/s"
                else:
                    data["download_rate_formatted"] = (
                        f"{download_rate / (1024 * 1024):.2f} MB/s"
                    )

        # Log at debug level
        logger.debug(f"Task {task_id} track progress: {track_name} by {artist}: {percent}%")

        # Set appropriate status
        # data["status"] = (
        #     ProgressState.REAL_TIME
        #     if data.get("status") == "real_time"
        #     else ProgressState.TRACK_PROGRESS
        # )

    def _handle_skipped(self, task_id, data, task_info):
        """Handle skipped status from deezspot"""
        
        # Store skipped history for deezspot callback format
        try:
            if "track" in data:
                # Individual track skipped - check if we should use children table
                children_table = task_info.get("children_table")
                logger.debug(f"Task {task_id}: Skipped track, children_table = '{children_table}'")
                if children_table:
                    # Part of album/playlist - store progressively in children table
                    logger.info(f"Task {task_id}: Storing skipped track in children table '{children_table}' (progressive)")
                    history_manager.store_track_history(data, task_id, "skipped", children_table)
                else:
                    # Individual track download - store in main table
                    logger.info(f"Task {task_id}: Storing skipped track in main table (individual download)")
                    history_manager.store_track_history(data, task_id, "skipped")
        except Exception as e:
            logger.error(f"Failed to store skipped history for task {task_id}: {e}")
        
        # Extract track info (legacy format support)
        title = data.get("song", "Unknown")
        artist = data.get("artist", "Unknown")
        reason = data.get("reason", "Unknown reason")

        # Log skip
        logger.info(f"Task {task_id} skipped: {artist} - {title}")
        logger.debug(f"Task {task_id} skip reason: {reason}")

        # Update task info
        skipped_tracks = task_info.get("skipped_tracks", 0) + 1
        task_info["skipped_tracks"] = skipped_tracks
        store_task_info(task_id, task_info)

        # Check if part of album/playlist
        parent_type = task_info.get("type", "").lower()
        if parent_type in ["album", "playlist"]:
            total_tracks = task_info.get("total_tracks", 0)
            processed_tracks = task_info.get("completed_tracks", 0) + skipped_tracks

            if total_tracks > 0:
                overall_progress = min(
                    int((processed_tracks / total_tracks) * 100), 100
                )

                # Create parent progress update
                progress_update = {
                    "status": ProgressState.PROGRESS,
                    "type": parent_type,
                    "track": title,
                    "current_track": f"{processed_tracks}/{total_tracks}",
                    "album": data.get("album", ""),
                    "artist": artist,
                    "timestamp": data["timestamp"],
                    "parsed_current_track": processed_tracks,
                    "parsed_total_tracks": total_tracks,
                    "overall_progress": overall_progress,
                    "track_skipped": True,
                    "skip_reason": reason,
                    "parent_task": True,
                }

                # Store progress update
                store_task_status(task_id, progress_update)

        # Set status
        # data["status"] = ProgressState.SKIPPED

    def _handle_retrying(self, task_id, data, task_info):
        """Handle retrying status from deezspot"""
        # Extract retry info
        song = data.get("song", "Unknown")
        artist = data.get("artist", "Unknown")
        retry_count = data.get("retry_count", 0)
        seconds_left = data.get("seconds_left", 0)
        error = data.get("error", "Unknown error")

        # Log retry
        logger.warning(
            f"Task {task_id} retrying: {artist} - {song} (Attempt {retry_count}, waiting {seconds_left}s)"
        )
        logger.debug(f"Task {task_id} retry reason: {error}")

        # Update task info
        retry_count_total = task_info.get("retry_count", 0) + 1
        task_info["retry_count"] = retry_count_total
        store_task_info(task_id, task_info)

        # Set status
        # data["status"] = ProgressState.RETRYING

    def _handle_error(self, task_id, data, task_info):
        """Handle error status from deezspot"""
        
        # Store error history for deezspot callback format
        try:
            # Check for album/playlist FIRST since their callbacks contain both parent and track info
            if "album" in data:
                # Album failed - store in main table
                logger.info(f"Task {task_id}: Storing album history (failed)")
                history_manager.store_album_history(data, task_id, "failed")
            elif "playlist" in data:
                # Playlist failed - store in main table
                logger.info(f"Task {task_id}: Storing playlist history (failed)")
                history_manager.store_playlist_history(data, task_id, "failed")
            elif "track" in data:
                # Individual track failed - check if we should use children table
                children_table = task_info.get("children_table")
                logger.debug(f"Task {task_id}: Failed track, children_table = '{children_table}'")
                if children_table:
                    # Part of album/playlist - store progressively in children table
                    logger.info(f"Task {task_id}: Storing failed track in children table '{children_table}' (progressive)")
                    history_manager.store_track_history(data, task_id, "failed", children_table)
                else:
                    # Individual track download - store in main table
                    logger.info(f"Task {task_id}: Storing failed track in main table (individual download)")
                    history_manager.store_track_history(data, task_id, "failed")
        except Exception as e:
            logger.error(f"Failed to store error history for task {task_id}: {e}")
        
        # Extract error info (legacy format support)
        message = data.get("message", "Unknown error")

        # Log error
        logger.error(f"Task {task_id} error: {message}")

        # Update task info
        error_count = task_info.get("error_count", 0) + 1
        task_info["error_count"] = error_count
        store_task_info(task_id, task_info)

        # Set status and error message
        # data["status"] = ProgressState.ERROR
        data["error"] = message

    def _handle_done(self, task_id, data, task_info):
        """Handle done status from deezspot"""
        
        # Store completion history for deezspot callback format
        try:
            # Check for album/playlist FIRST since their callbacks contain both parent and track info
            if "album" in data:
                # Album completion with summary - store in main table
                logger.info(f"Task {task_id}: Storing album history (completed)")
                history_manager.store_album_history(data, task_id, "completed")
            elif "playlist" in data:
                # Playlist completion with summary - store in main table
                logger.info(f"Task {task_id}: Storing playlist history (completed)")
                history_manager.store_playlist_history(data, task_id, "completed")
            elif "track" in data:
                # Individual track completion - check if we should use children table
                children_table = task_info.get("children_table")
                logger.debug(f"Task {task_id}: Completed track, children_table = '{children_table}'")
                if children_table:
                    # Part of album/playlist - store progressively in children table
                    logger.info(f"Task {task_id}: Storing completed track in children table '{children_table}' (progressive)")
                    history_manager.store_track_history(data, task_id, "completed", children_table)
                else:
                    # Individual track download - store in main table
                    logger.info(f"Task {task_id}: Storing completed track in main table (individual download)")
                    history_manager.store_track_history(data, task_id, "completed")
        except Exception as e:
            logger.error(f"Failed to store completion history for task {task_id}: {e}", exc_info=True)
        
        # Extract data (legacy format support)
        content_type = data.get("type", "").lower()
        album = data.get("album", "")
        artist = data.get("artist", "")
        song = data.get("song", "")

        # Handle based on content type
        if content_type == "track":
            # For track completions
            if artist and song:
                logger.info(f"Task {task_id} completed: Track '{song}' by {artist}")
            else:
                logger.info(f"Task {task_id} completed: Track '{song}'")

            # Update status to track_complete
            # data["status"] = ProgressState.TRACK_COMPLETE

            # Update task info
            completed_tracks = task_info.get("completed_tracks", 0) + 1
            task_info["completed_tracks"] = completed_tracks
            store_task_info(task_id, task_info)

            # If part of album/playlist, update progress
            parent_type = task_info.get("type", "").lower()
            if parent_type in ["album", "playlist"]:
                total_tracks = task_info.get("total_tracks", 0)
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
                        "timestamp": data["timestamp"],
                        "parsed_current_track": completed_tracks,
                        "parsed_total_tracks": total_tracks,
                        "overall_progress": completion_percent,
                        "track_complete": True,
                        "parent_task": True,
                    }

                    # Store progress update
                    store_task_status(task_id, progress_update)

        elif content_type in ["album", "playlist"]:
            # Get completion counts
            completed_tracks = task_info.get("completed_tracks", 0)
            skipped_tracks = task_info.get("skipped_tracks", 0)
            error_count = task_info.get("error_count", 0)

            # Log completion
            if album and artist:
                logger.info(
                    f"Task {task_id} completed: {content_type.upper()} '{album}' by {artist}"
                )
            elif album:
                logger.info(
                    f"Task {task_id} completed: {content_type.upper()} '{album}'"
                )
            else:
                name = data.get("name", "")
                if name:
                    logger.info(
                        f"Task {task_id} completed: {content_type.upper()} '{name}'"
                    )
                else:
                    logger.info(f"Task {task_id} completed: {content_type.upper()}")

            # Add summary
            # data["status"] = ProgressState.COMPLETE
            summary_obj = data.get("summary")

            if summary_obj:
                total_successful = summary_obj.get("total_successful", 0)
                total_skipped = summary_obj.get("total_skipped", 0)
                total_failed = summary_obj.get("total_failed", 0)
                # data[
                #     "message"
                # ] = f"Download complete: {total_successful} tracks downloaded, {total_skipped} skipped, {total_failed} failed."
                # Log summary from the summary object
                logger.info(
                    f"Task {task_id} summary: {total_successful} successful, {total_skipped} skipped, {total_failed} failed."
                )
            else:
                # data["message"] = (
                #     f"Download complete: {completed_tracks} tracks downloaded, {skipped_tracks} skipped"
                # )
                # Log summary
                logger.info(
                    f"Task {task_id} summary: {completed_tracks} completed, {skipped_tracks} skipped, {error_count} errors"
                )
            # Schedule deletion for completed multi-track downloads
            delayed_delete_task_data.apply_async(
                args=[task_id, "Task completed successfully and auto-cleaned."],
                countdown=30,  # Delay in seconds
            )

            # If from playlist_watch and successful, add track to DB
            original_request = task_info.get("original_request", {})
            if (
                original_request.get("source") == "playlist_watch"
                and task_info.get("download_type") == "track"
            ):  # ensure it's a track for playlist
                playlist_id = original_request.get("playlist_id")
                track_item_for_db = original_request.get("track_item_for_db")

                if playlist_id and track_item_for_db and track_item_for_db.get("track"):
                    logger.info(
                        f"Task {task_id} was from playlist watch for playlist {playlist_id}. Adding track to DB."
                    )
                    try:
                        add_single_track_to_playlist_db(playlist_id, track_item_for_db)
                    except Exception as db_add_err:
                        logger.error(
                            f"Failed to add track to DB for playlist {playlist_id} after successful download task {task_id}: {db_add_err}",
                            exc_info=True,
                        )
                else:
                    logger.warning(
                        f"Task {task_id} was from playlist_watch but missing playlist_id or track_item_for_db for DB update. Original Request: {original_request}"
                    )

            # If from artist_watch and successful, update album in DB
            if (
                original_request.get("source") == "artist_watch"
                and task_info.get("download_type") == "album"
            ):
                artist_spotify_id = original_request.get("artist_spotify_id")
                album_data_for_db = original_request.get("album_data_for_db")

                if (
                    artist_spotify_id
                    and album_data_for_db
                    and album_data_for_db.get("id")
                ):
                    album_spotify_id = album_data_for_db.get("id")
                    logger.info(
                        f"Task {task_id} was from artist watch for artist {artist_spotify_id}, album {album_spotify_id}. Updating album in DB as complete."
                    )
                    try:
                        add_or_update_album_for_artist(
                            artist_spotify_id=artist_spotify_id,
                            album_data=album_data_for_db,
                            task_id=task_id,
                            is_download_complete=True,
                        )
                    except Exception as db_update_err:
                        logger.error(
                            f"Failed to update album {album_spotify_id} in DB for artist {artist_spotify_id} after successful download task {task_id}: {db_update_err}",
                            exc_info=True,
                        )
                else:
                    logger.warning(
                        f"Task {task_id} was from artist_watch (album) but missing key data (artist_spotify_id or album_data_for_db) for DB update. Original Request: {original_request}"
                    )

        else:
            # Generic done for other types
            logger.info(f"Task {task_id} completed: {content_type.upper()}")
            # data["status"] = ProgressState.COMPLETE
            # data["message"] = "Download complete"


# Celery signal handlers
@task_prerun.connect
def task_prerun_handler(task_id=None, task=None, *args, **kwargs):
    """Signal handler when a task begins running"""
    try:
        task_info = get_task_info(task_id)

        # Update task status to processing
        store_task_status(
            task_id,
            {
                "status": ProgressState.PROCESSING,
                "timestamp": time.time(),
                "type": task_info.get("type", "unknown"),
                "name": task_info.get("name", "Unknown"),
                "artist": task_info.get("artist", ""),
            },
        )

        logger.info(
            f"Task {task_id} started processing: {task_info.get('name', 'Unknown')}"
        )
    except Exception as e:
        logger.error(f"Error in task_prerun_handler: {e}")


@task_postrun.connect
def task_postrun_handler(
    task_id=None, task=None, retval=None, state=None, *args, **kwargs
):
    """Signal handler when a task finishes"""
    try:
        last_status_for_history = get_last_task_status(task_id)
        if last_status_for_history and last_status_for_history.get("status") in [
            ProgressState.COMPLETE,
            ProgressState.ERROR,
            ProgressState.CANCELLED,
            "ERROR_RETRIED",
            "ERROR_AUTO_CLEANED",
        ]:
            if (
                state == states.REVOKED
                and last_status_for_history.get("status") != ProgressState.CANCELLED
            ):
                logger.info(
                    f"Task {task_id} was REVOKED (likely cancelled)."
                )
            # return # Let status update proceed if necessary

        task_info = get_task_info(task_id)
        current_redis_status = (
            last_status_for_history.get("status") if last_status_for_history else None
        )

        if state == states.SUCCESS:
            if current_redis_status not in [ProgressState.COMPLETE, "done"]:
                # The final status is now set by the 'done' callback from deezspot.
                # We no longer need to store a generic 'COMPLETE' status here.
                # This ensures the raw callback data is the last thing in the log.
                pass
            logger.info(
                f"Task {task_id} completed successfully: {task_info.get('name', 'Unknown')}"
            )

            if (
                task_info.get("download_type") == "track"
            ):  # Applies to single track downloads and tracks from playlists/albums
                delayed_delete_task_data.apply_async(
                    args=[task_id, "Task completed successfully and auto-cleaned."],
                    countdown=30,
                )

            original_request = task_info.get("original_request", {})
            # Handle successful track from playlist watch
            if (
                original_request.get("source") == "playlist_watch"
                and task_info.get("download_type") == "track"
            ):
                playlist_id = original_request.get("playlist_id")
                track_item_for_db = original_request.get("track_item_for_db")

                if playlist_id and track_item_for_db and track_item_for_db.get("track"):
                    logger.info(
                        f"Task {task_id} was from playlist watch for playlist {playlist_id}. Adding track to DB."
                    )
                    try:
                        add_single_track_to_playlist_db(playlist_id, track_item_for_db)
                    except Exception as db_add_err:
                        logger.error(
                            f"Failed to add track to DB for playlist {playlist_id} after successful download task {task_id}: {db_add_err}",
                            exc_info=True,
                        )
                else:
                    logger.warning(
                        f"Task {task_id} was from playlist_watch but missing playlist_id or track_item_for_db for DB update. Original Request: {original_request}"
                    )

            # Handle successful album from artist watch
            if (
                original_request.get("source") == "artist_watch"
                and task_info.get("download_type") == "album"
            ):
                artist_spotify_id = original_request.get("artist_spotify_id")
                album_data_for_db = original_request.get("album_data_for_db")

                if (
                    artist_spotify_id
                    and album_data_for_db
                    and album_data_for_db.get("id")
                ):
                    album_spotify_id = album_data_for_db.get("id")
                    logger.info(
                        f"Task {task_id} was from artist watch for artist {artist_spotify_id}, album {album_spotify_id}. Updating album in DB as complete."
                    )
                    try:
                        add_or_update_album_for_artist(
                            artist_spotify_id=artist_spotify_id,
                            album_data=album_data_for_db,
                            task_id=task_id,
                            is_download_complete=True,
                        )
                    except Exception as db_update_err:
                        logger.error(
                            f"Failed to update album {album_spotify_id} in DB for artist {artist_spotify_id} after successful download task {task_id}: {db_update_err}",
                            exc_info=True,
                        )
                else:
                    logger.warning(
                        f"Task {task_id} was from artist_watch (album) but missing key data (artist_spotify_id or album_data_for_db) for DB update. Original Request: {original_request}"
                    )

    except Exception as e:
        logger.error(f"Error in task_postrun_handler: {e}", exc_info=True)


@task_failure.connect
def task_failure_handler(
    task_id=None, exception=None, traceback=None, sender=None, *args, **kwargs
):
    """Signal handler when a task fails"""
    try:
        # Skip if Retry exception
        if isinstance(exception, Retry):
            return

        # Define download task names
        download_task_names = ["download_track", "download_album", "download_playlist"]

        # Get task info and status
        task_info = get_task_info(task_id)
        last_status = get_last_task_status(task_id)

        # Get retry count
        retry_count = 0
        if last_status:
            retry_count = last_status.get("retry_count", 0)

        # Get retry configuration
        config_params = get_config_params()
        max_retries = config_params.get("maxRetries", 3)

        # Check if we can retry
        can_retry = retry_count < max_retries

        # Update task status to error in Redis if not already an error
        if last_status and last_status.get("status") != ProgressState.ERROR:
            store_task_status(
                task_id,
                {
                    "status": ProgressState.ERROR,
                    "timestamp": time.time(),
                    "type": task_info.get("type", "unknown"),
                    "name": task_info.get("name", "Unknown"),
                    "artist": task_info.get("artist", ""),
                    "error": str(exception),
                    "traceback": str(traceback),
                    "can_retry": can_retry,
                    "retry_count": retry_count,
                    "max_retries": max_retries,
                },
            )

        logger.error(f"Task {task_id} failed: {str(exception)}")

        if can_retry:
            logger.info(f"Task {task_id} can be retried ({retry_count}/{max_retries})")
        else:
            # If task cannot be retried, schedule its data for deletion
            logger.info(
                f"Task {task_id} failed and cannot be retried. Data scheduled for deletion in 30s."
            )
            delayed_delete_task_data.apply_async(
                args=[
                    task_id,
                    f"Task failed ({str(exception)}) and max retries reached. Auto-cleaned.",
                ],
                countdown=30,
            )

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
@celery_app.task(
    bind=True, base=ProgressTrackingTask, name="download_track", queue="downloads"
)
def download_track(self, **task_data):
    """
    Task to download a track

    Args:
        **task_data: Dictionary containing all task parameters
    """
    try:
        logger.info(
            f"Processing track download task: {task_data.get('name', 'Unknown')}"
        )
        from routes.utils.track import download_track as download_track_func

        # Get config parameters
        config_params = get_config_params()
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)

        # Determine service parameters
        if service == "spotify":
            if fallback_enabled:
                main = config_params.get("spotify", "")
                fallback = config_params.get("deezer", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == "deezer":
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
        custom_dir_format = task_data.get(
            "custom_dir_format",
            config_params.get("customDirFormat", "%ar_album%/%album%"),
        )
        custom_track_format = task_data.get(
            "custom_track_format",
            config_params.get("customTrackFormat", "%tracknum%. %music%"),
        )
        pad_tracks = task_data.get(
            "pad_tracks", config_params.get("tracknum_padding", True)
        )
        save_cover = task_data.get("save_cover", config_params.get("save_cover", True))
        convert_to = task_data.get("convertTo", config_params.get("convertTo"))
        bitrate = task_data.get("bitrate", config_params.get("bitrate"))

        # Execute the download - service is now determined from URL
        download_track_func(
            url=url,
            main=main,
            fallback=fallback if fallback_enabled else None,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks,
            save_cover=save_cover,
            progress_callback=self.progress_callback,
            convert_to=convert_to,
            bitrate=bitrate,
            _is_celery_task_execution=True,  # Skip duplicate check inside Celery task (consistency)
        )

        return {"status": "success", "message": "Track download completed"}
    except Exception as e:
        logger.error(f"Error in download_track task: {e}")
        traceback.print_exc()
        raise


@celery_app.task(
    bind=True, base=ProgressTrackingTask, name="download_album", queue="downloads"
)
def download_album(self, **task_data):
    """
    Task to download an album

    Args:
        **task_data: Dictionary containing all task parameters
    """
    try:
        logger.info(
            f"Processing album download task: {task_data.get('name', 'Unknown')}"
        )
        from routes.utils.album import download_album as download_album_func

        # Get config parameters
        config_params = get_config_params()
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)

        # Determine service parameters
        if service == "spotify":
            if fallback_enabled:
                main = config_params.get("spotify", "")
                fallback = config_params.get("deezer", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == "deezer":
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
        custom_dir_format = task_data.get(
            "custom_dir_format",
            config_params.get("customDirFormat", "%ar_album%/%album%"),
        )
        custom_track_format = task_data.get(
            "custom_track_format",
            config_params.get("customTrackFormat", "%tracknum%. %music%"),
        )
        pad_tracks = task_data.get(
            "pad_tracks", config_params.get("tracknum_padding", True)
        )
        save_cover = task_data.get("save_cover", config_params.get("save_cover", True))
        convert_to = task_data.get("convertTo", config_params.get("convertTo"))
        bitrate = task_data.get("bitrate", config_params.get("bitrate"))

        # Execute the download - service is now determined from URL
        download_album_func(
            url=url,
            main=main,
            fallback=fallback if fallback_enabled else None,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks,
            save_cover=save_cover,
            progress_callback=self.progress_callback,
            convert_to=convert_to,
            bitrate=bitrate,
            _is_celery_task_execution=True,  # Skip duplicate check inside Celery task
        )

        return {"status": "success", "message": "Album download completed"}
    except Exception as e:
        logger.error(f"Error in download_album task: {e}")
        traceback.print_exc()
        raise


@celery_app.task(
    bind=True, base=ProgressTrackingTask, name="download_playlist", queue="downloads"
)
def download_playlist(self, **task_data):
    """
    Task to download a playlist

    Args:
        **task_data: Dictionary containing all task parameters
    """
    try:
        logger.info(
            f"Processing playlist download task: {task_data.get('name', 'Unknown')}"
        )
        from routes.utils.playlist import download_playlist as download_playlist_func

        # Get config parameters
        config_params = get_config_params()
        service = config_params.get("service")
        fallback_enabled = config_params.get("fallback", False)

        # Determine service parameters
        if service == "spotify":
            if fallback_enabled:
                main = config_params.get("spotify", "")
                fallback = config_params.get("deezer", "")
                quality = config_params.get("deezerQuality", "MP3_128")
                fall_quality = config_params.get("spotifyQuality", "NORMAL")
            else:
                main = config_params.get("spotify", "")
                fallback = None
                quality = config_params.get("spotifyQuality", "NORMAL")
                fall_quality = None
        elif service == "deezer":
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
        custom_dir_format = task_data.get(
            "custom_dir_format",
            config_params.get("customDirFormat", "%ar_album%/%album%"),
        )
        custom_track_format = task_data.get(
            "custom_track_format",
            config_params.get("customTrackFormat", "%tracknum%. %music%"),
        )
        pad_tracks = task_data.get(
            "pad_tracks", config_params.get("tracknum_padding", True)
        )
        save_cover = task_data.get("save_cover", config_params.get("save_cover", True))
        convert_to = task_data.get("convertTo", config_params.get("convertTo"))
        bitrate = task_data.get("bitrate", config_params.get("bitrate"))

        # Get retry parameters
        initial_retry_delay = task_data.get(
            "initial_retry_delay", config_params.get("retryDelaySeconds", 5)
        )
        retry_delay_increase = task_data.get(
            "retry_delay_increase", config_params.get("retry_delay_increase", 5)
        )
        max_retries = task_data.get("max_retries", config_params.get("maxRetries", 3))

        # Execute the download - service is now determined from URL
        download_playlist_func(
            url=url,
            main=main,
            fallback=fallback if fallback_enabled else None,
            quality=quality,
            fall_quality=fall_quality,
            real_time=real_time,
            custom_dir_format=custom_dir_format,
            custom_track_format=custom_track_format,
            pad_tracks=pad_tracks,
            save_cover=save_cover,
            initial_retry_delay=initial_retry_delay,
            retry_delay_increase=retry_delay_increase,
            max_retries=max_retries,
            progress_callback=self.progress_callback,
            convert_to=convert_to,
            bitrate=bitrate,
            _is_celery_task_execution=True,  # Skip duplicate check inside Celery task
        )

        return {"status": "success", "message": "Playlist download completed"}
    except Exception as e:
        logger.error(f"Error in download_playlist task: {e}")
        traceback.print_exc()
        raise


# Helper function to fully delete task data from Redis
def delete_task_data_and_log(task_id, reason="Task data deleted"):
    """
    Marks a task as cancelled (if not already) and deletes all its data from Redis.
    """
    try:
        task_info = get_task_info(task_id)  # Get info before deleting
        last_status = get_last_task_status(task_id)
        current_status_val = last_status.get("status") if last_status else None

        # Determine the final status for Redis before deletion
        # The reason passed to this function indicates why it's being deleted.
        final_redis_status = (
            ProgressState.ERROR_AUTO_CLEANED
        )  # Default for most cleanup scenarios
        error_message_for_status = reason

        if reason == "Task completed successfully and auto-cleaned.":
            final_redis_status = ProgressState.COMPLETE  # It was already complete
            error_message_for_status = "Task completed and auto-cleaned."
        elif reason == "Task cancelled by user and auto-cleaned.":
            final_redis_status = ProgressState.CANCELLED  # It was already cancelled
            error_message_for_status = "Task cancelled and auto-cleaned."
        elif "Task failed" in reason and "max retries reached" in reason:
            final_redis_status = (
                ProgressState.ERROR
            )  # It was already an error (non-retryable)
            error_message_for_status = reason
        elif reason == "Task interrupted by application restart and auto-cleaned.":
            final_redis_status = (
                ProgressState.ERROR
            )  # It was marked as ERROR (interrupted)
            error_message_for_status = reason
        # Add more specific conditions if needed based on other reasons `delayed_delete_task_data` might be called with.

        # Update Redis status one last time if it's not already reflecting the final intended state for this cleanup.
        # This is mainly for cases where cleanup is initiated for tasks not yet in a fully terminal state by other handlers.
        if current_status_val not in [
            ProgressState.COMPLETE,
            ProgressState.CANCELLED,
            ProgressState.ERROR_RETRIED,
            ProgressState.ERROR_AUTO_CLEANED,
            final_redis_status,
        ]:
            store_task_status(
                task_id,
                {
                    "status": final_redis_status,
                    "error": error_message_for_status,  # Use the reason as the error/message for this status
                    "timestamp": time.time(),
                },
            )

        # Delete Redis keys associated with the task
        redis_client.delete(f"task:{task_id}:info")
        redis_client.delete(f"task:{task_id}:status")
        redis_client.delete(f"task:{task_id}:status:next_id")

        logger.info(
            f"Data for task {task_id} ('{task_info.get('name', 'Unknown')}') deleted from Redis. Reason: {reason}"
        )
        return True
    except Exception as e:
        logger.error(f"Error deleting task data for {task_id}: {e}", exc_info=True)
        return False


@celery_app.task(
    name="cleanup_stale_errors", queue="utility_tasks"
)  # Put on utility_tasks queue
def cleanup_stale_errors():
    """
    Periodically checks for tasks in ERROR state for more than 1 minute and cleans them up.
    """
    logger.info("Running cleanup_stale_errors task...")
    cleaned_count = 0
    try:
        task_keys = redis_client.keys("task:*:info")
        if not task_keys:
            logger.info("No task keys found for cleanup.")
            return {"status": "complete", "message": "No tasks to check."}

        current_time = time.time()
        stale_threshold = 60  # 1 minute

        for key_bytes in task_keys:
            task_id = key_bytes.decode("utf-8").split(":")[1]
            last_status = get_last_task_status(task_id)

            if last_status and last_status.get("status") == ProgressState.ERROR:
                error_timestamp = last_status.get("timestamp", 0)
                if (current_time - error_timestamp) > stale_threshold:
                    # Check again to ensure it wasn't retried just before cleanup
                    current_last_status_before_delete = get_last_task_status(task_id)
                    if (
                        current_last_status_before_delete
                        and current_last_status_before_delete.get("status")
                        == ProgressState.ERROR_RETRIED
                    ):
                        logger.info(
                            f"Task {task_id} was retried just before cleanup. Skipping delete."
                        )
                        continue

                    logger.info(
                        f"Task {task_id} is in ERROR state for more than {stale_threshold}s. Cleaning up."
                    )
                    if delete_task_data_and_log(
                        task_id,
                        reason=f"Auto-cleaned: Task was in ERROR state for over {stale_threshold} seconds without manual retry.",
                    ):
                        cleaned_count += 1

        logger.info(
            f"cleanup_stale_errors task finished. Cleaned up {cleaned_count} stale errored tasks."
        )
        return {"status": "complete", "cleaned_count": cleaned_count}
    except Exception as e:
        logger.error(f"Error during cleanup_stale_errors: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@celery_app.task(
    name="delayed_delete_task_data", queue="utility_tasks"
)  # Use utility_tasks queue
def delayed_delete_task_data(task_id, reason):
    """
    Celery task to delete task data after a delay.
    """
    logger.info(f"Executing delayed deletion for task {task_id}. Reason: {reason}")
    delete_task_data_and_log(task_id, reason)
