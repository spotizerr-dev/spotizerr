from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
import logging
import time
import json
import asyncio
from typing import Dict, Set

from routes.utils.celery_tasks import (
    get_task_info,
    get_task_status,
    get_last_task_status,
    get_all_tasks,
    cancel_task,
    ProgressState,
)

# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter()

# Global SSE Event Broadcaster
class SSEBroadcaster:
    def __init__(self):
        self.clients: Set[asyncio.Queue] = set()
        
    async def add_client(self, queue: asyncio.Queue):
        """Add a new SSE client"""
        self.clients.add(queue)
        logger.info(f"SSE: Client connected (total: {len(self.clients)})")
        
    async def remove_client(self, queue: asyncio.Queue):
        """Remove an SSE client"""
        self.clients.discard(queue)
        logger.info(f"SSE: Client disconnected (total: {len(self.clients)})")
        
    async def broadcast_event(self, event_data: dict):
        """Broadcast an event to all connected clients"""
        logger.debug(f"SSE Broadcaster: Attempting to broadcast to {len(self.clients)} clients")
        
        if not self.clients:
            logger.debug("SSE Broadcaster: No clients connected, skipping broadcast")
            return
        
        # Add global task counts right before broadcasting - this is the single source of truth
        enhanced_event_data = add_global_task_counts_to_event(event_data.copy())
        event_json = json.dumps(enhanced_event_data)
        sse_data = f"data: {event_json}\n\n"
        
        logger.debug(f"SSE Broadcaster: Broadcasting event: {enhanced_event_data.get('change_type', 'unknown')} with {enhanced_event_data.get('active_tasks', 0)} active tasks")
        
        # Send to all clients, remove disconnected ones
        disconnected = set()
        sent_count = 0
        for client_queue in self.clients.copy():
            try:
                await client_queue.put(sse_data)
                sent_count += 1
                logger.debug(f"SSE: Successfully sent to client queue")
            except Exception as e:
                logger.error(f"SSE: Failed to send to client: {e}")
                disconnected.add(client_queue)
                
        # Clean up disconnected clients
        for client in disconnected:
            self.clients.discard(client)
            
        logger.info(f"SSE Broadcaster: Successfully sent to {sent_count} clients, removed {len(disconnected)} disconnected clients")

# Global broadcaster instance
sse_broadcaster = SSEBroadcaster()

# Redis subscriber for cross-process SSE events
import redis
import threading
from routes.utils.celery_config import REDIS_URL

# Redis client for SSE pub/sub
sse_redis_client = redis.Redis.from_url(REDIS_URL)

def start_sse_redis_subscriber():
    """Start Redis subscriber to listen for SSE events from Celery workers"""
    def redis_subscriber_thread():
        try:
            pubsub = sse_redis_client.pubsub()
            pubsub.subscribe("sse_events")
            logger.info("SSE Redis Subscriber: Started listening for events")
            
            for message in pubsub.listen():
                if message['type'] == 'message':
                    try:
                        event_data = json.loads(message['data'].decode('utf-8'))
                        event_type = event_data.get('event_type', 'unknown')
                        task_id = event_data.get('task_id', 'unknown')
                        
                        logger.debug(f"SSE Redis Subscriber: Received {event_type} for task {task_id}")
                        
                        # Handle different event types
                        if event_type == 'progress_update':
                            # Transform callback data into task format expected by frontend
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                broadcast_data = loop.run_until_complete(transform_callback_to_task_format(task_id, event_data))
                                if broadcast_data:
                                    loop.run_until_complete(sse_broadcaster.broadcast_event(broadcast_data))
                                    logger.debug(f"SSE Redis Subscriber: Broadcasted callback to {len(sse_broadcaster.clients)} clients")
                            finally:
                                loop.close()
                        elif event_type == 'summary_update':
                            # Task summary update - use existing trigger_sse_update logic
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                loop.run_until_complete(trigger_sse_update(task_id, event_data.get('reason', 'update')))
                                logger.debug(f"SSE Redis Subscriber: Processed summary update for {task_id}")
                            finally:
                                loop.close()
                        else:
                            # Unknown event type - broadcast as-is
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                loop.run_until_complete(sse_broadcaster.broadcast_event(event_data))
                                logger.debug(f"SSE Redis Subscriber: Broadcasted {event_type} to {len(sse_broadcaster.clients)} clients")
                            finally:
                                loop.close()
                            
                    except Exception as e:
                        logger.error(f"SSE Redis Subscriber: Error processing message: {e}", exc_info=True)
                        
        except Exception as e:
            logger.error(f"SSE Redis Subscriber: Fatal error: {e}", exc_info=True)
    
    # Start Redis subscriber in background thread
    thread = threading.Thread(target=redis_subscriber_thread, daemon=True)
    thread.start()
    logger.info("SSE Redis Subscriber: Background thread started")

async def transform_callback_to_task_format(task_id: str, event_data: dict) -> dict:
    """Transform callback event data into the task format expected by frontend"""
    try:
        # Import here to avoid circular imports
        from routes.utils.celery_tasks import get_task_info, get_all_tasks
        
        # Get task info to build complete task object
        task_info = get_task_info(task_id)
        if not task_info:
            logger.warning(f"SSE Transform: No task info found for {task_id}")
            return None
        
        # Extract callback data
        callback_data = event_data.get('callback_data', {})
        
        # Build task object in the format expected by frontend
        task_object = {
            "task_id": task_id,
            "original_url": f"http://localhost:7171/api/{task_info.get('download_type', 'track')}/download/{task_info.get('url', '').split('/')[-1] if task_info.get('url') else ''}",
            "last_line": callback_data,  # This is what frontend expects for callback data
            "timestamp": event_data.get('timestamp', time.time()),
            "download_type": task_info.get('download_type', 'track'),
            "type": task_info.get('type', task_info.get('download_type', 'track')),
            "name": task_info.get('name', 'Unknown'),
            "artist": task_info.get('artist', ''),
            "created_at": task_info.get('created_at'),
        }
        
        # Build minimal event data - global counts will be added at broadcast time
        return {
            "change_type": "update",  # Use "update" so it gets processed by existing frontend logic
            "tasks": [task_object],  # Frontend expects tasks array
            "current_timestamp": time.time(),
            "updated_count": 1,
            "since_timestamp": time.time(),
            "trigger_reason": "callback_update"
        }
        
    except Exception as e:
        logger.error(f"SSE Transform: Error transforming callback for task {task_id}: {e}", exc_info=True)
        return None

# Start the Redis subscriber when module loads
start_sse_redis_subscriber()

async def trigger_sse_update(task_id: str, reason: str = "task_update"):
    """Trigger an immediate SSE update for a specific task"""
    try:
        current_time = time.time()
        
        # Find the specific task that changed
        task_info = get_task_info(task_id)
        if not task_info:
            logger.warning(f"SSE: Task {task_id} not found for update")
            return
            
        last_status = get_last_task_status(task_id)
        
        # Create a dummy request for the _build_task_response function
        from fastapi import Request
        class DummyRequest:
            def __init__(self):
                self.base_url = "http://localhost:7171"
        
        dummy_request = DummyRequest()
        task_response = _build_task_response(task_info, last_status, task_id, current_time, dummy_request)
        
        # Create minimal event data - global counts will be added at broadcast time
        event_data = {
            "tasks": [task_response],
            "current_timestamp": current_time,
            "since_timestamp": current_time,
            "change_type": "realtime",
            "trigger_reason": reason
        }
        
        await sse_broadcaster.broadcast_event(event_data)
        logger.debug(f"SSE: Broadcast update for task {task_id} (reason: {reason})")
        
    except Exception as e:
        logger.error(f"SSE: Failed to trigger update for task {task_id}: {e}")

# Define active task states using ProgressState constants
ACTIVE_TASK_STATES = {
    ProgressState.INITIALIZING,     # "initializing" - task is starting up
    ProgressState.PROCESSING,       # "processing" - task is being processed
    ProgressState.DOWNLOADING,      # "downloading" - actively downloading
    ProgressState.PROGRESS,         # "progress" - album/playlist progress updates
    ProgressState.TRACK_PROGRESS,   # "track_progress" - real-time track progress
    ProgressState.REAL_TIME,        # "real_time" - real-time download progress
    ProgressState.RETRYING,         # "retrying" - task is retrying after error
    "real-time",                    # "real-time" - real-time download progress (hyphenated version)
    ProgressState.QUEUED,           # "queued" - task is queued and waiting
    "pending",                      # "pending" - legacy queued status
}

# Define terminal task states that should be included when recently completed
TERMINAL_TASK_STATES = {
    ProgressState.COMPLETE,         # "complete" - task completed successfully
    ProgressState.DONE,             # "done" - task finished processing
    ProgressState.ERROR,            # "error" - task failed
    ProgressState.CANCELLED,        # "cancelled" - task was cancelled
    ProgressState.SKIPPED,          # "skipped" - task was skipped
}

def get_task_status_from_last_status(last_status):
    """
    Extract the task status from last_status, checking both possible locations.
    Uses improved priority logic to handle real-time downloads correctly.
    
    Args:
        last_status: The last status dict from get_last_task_status()
        
    Returns:
        str: The task status string
    """
    if not last_status:
        return "unknown"
    
    # For real-time downloads, prioritize status_info.status as it contains the actual progress state
    status_info = last_status.get("status_info", {})
    if isinstance(status_info, dict) and "status" in status_info:
        status_info_status = status_info["status"]
        # If status_info contains an active status, use it regardless of top-level status
        if status_info_status in ACTIVE_TASK_STATES:
            return status_info_status
    
    # Fall back to top-level status
    top_level_status = last_status.get("status", "unknown")
    
    # If both exist but neither is active, prefer the more recent one (usually top-level)
    # For active states, we already handled status_info above
    return top_level_status


def is_task_active(task_status):
    """
    Determine if a task is currently active (working/processing).
    
    Args:
        task_status: The status string from the task
        
    Returns:
        bool: True if the task is active, False otherwise
    """
    if not task_status or task_status == "unknown":
        return False
    return task_status in ACTIVE_TASK_STATES


def get_global_task_counts():
    """
    Get comprehensive task counts for ALL tasks in Redis.
    This is called right before sending SSE events to ensure accurate counts.
    
    Returns:
        dict: Task counts by status
    """
    task_counts = {
        "active": 0,
        "queued": 0, 
        "completed": 0,
        "error": 0,
        "cancelled": 0,
        "retrying": 0,
        "skipped": 0
    }
    
    try:
        # Get ALL tasks from Redis - this is the source of truth
        all_tasks = get_all_tasks()
        
        for task_summary in all_tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

            last_status = get_last_task_status(task_id)
            task_status = get_task_status_from_last_status(last_status)
            is_active_task = is_task_active(task_status)
            
            # Categorize tasks by status using ProgressState constants
            if task_status == ProgressState.RETRYING:
                task_counts["retrying"] += 1
            elif task_status in {ProgressState.QUEUED, "pending"}:
                task_counts["queued"] += 1
            elif task_status in {ProgressState.COMPLETE, ProgressState.DONE}:
                task_counts["completed"] += 1
            elif task_status == ProgressState.ERROR:
                task_counts["error"] += 1
            elif task_status == ProgressState.CANCELLED:
                task_counts["cancelled"] += 1
            elif task_status == ProgressState.SKIPPED:
                task_counts["skipped"] += 1
            elif is_active_task:
                task_counts["active"] += 1
        
        logger.debug(f"Global task counts: {task_counts} (total: {len(all_tasks)} tasks)")
        
    except Exception as e:
        logger.error(f"Error getting global task counts: {e}", exc_info=True)
    
    return task_counts


def add_global_task_counts_to_event(event_data):
    """
    Add global task counts to any SSE event data right before broadcasting.
    This ensures all SSE events have accurate, up-to-date counts of ALL tasks.
    
    Args:
        event_data: The event data dictionary to be sent via SSE
        
    Returns:
        dict: Enhanced event data with global task counts
    """
    try:
        # Get fresh counts of ALL tasks right before sending
        global_task_counts = get_global_task_counts()
        
        # Add/update the counts in the event data
        event_data["task_counts"] = global_task_counts
        event_data["active_tasks"] = global_task_counts["active"]
        event_data["all_tasks_count"] = sum(global_task_counts.values())
        
        return event_data
        
    except Exception as e:
        logger.error(f"Error adding global task counts to SSE event: {e}", exc_info=True)
        return event_data


def _build_error_callback_object(last_status):
    """
    Constructs a structured error callback object based on the last status of a task.
    This conforms to the CallbackObject types in the frontend.
    """
    # The 'type' from the status update corresponds to the download_type (album, playlist, track)
    download_type = last_status.get("type")
    name = last_status.get("name")
    # The 'artist' field from the status may contain artist names or a playlist owner's name
    artist_or_owner = last_status.get("artist")
    error_message = last_status.get("error", "An unknown error occurred.")

    status_info = {"status": "error", "error": error_message}

    callback_object = {"status_info": status_info}

    if download_type == "album":
        callback_object["album"] = {
            "type": "album",
            "title": name,
            "artists": [{
                "type": "artistAlbum",
                "name": artist_or_owner
            }] if artist_or_owner else [],
        }
    elif download_type == "playlist":
        playlist_payload = {"type": "playlist", "title": name}
        if artist_or_owner:
            playlist_payload["owner"] = {"type": "user", "name": artist_or_owner}
        callback_object["playlist"] = playlist_payload
    elif download_type == "track":
        callback_object["track"] = {
            "type": "track",
            "title": name,
            "artists": [{
                "type": "artistTrack",
                "name": artist_or_owner
            }] if artist_or_owner else [],
        }
    else:
        # Fallback for unknown types to avoid breaking the client, returning a basic error structure.
        return {
            "status_info": status_info,
            "unstructured_error": True,
            "details": {
                "type": download_type,
                "name": name,
                "artist_or_owner": artist_or_owner,
            },
        }

    return callback_object


def _build_task_response(task_info, last_status, task_id, current_time, request: Request):
    """
    Helper function to build a standardized task response object.
    """
    # Dynamically construct original_url
    dynamic_original_url = ""
    download_type = task_info.get("download_type")
    item_url = task_info.get("url")

    if download_type and item_url:
        try:
            item_id = item_url.split("/")[-1]
            if item_id:
                base_url = str(request.base_url).rstrip("/")
                dynamic_original_url = (
                    f"{base_url}/api/{download_type}/download/{item_id}"
                )
            else:
                logger.warning(
                    f"Could not extract item ID from URL: {item_url} for task {task_id}. Falling back for original_url."
                )
                original_request_obj = task_info.get("original_request", {})
                dynamic_original_url = original_request_obj.get("original_url", "")
        except Exception as e:
            logger.error(
                f"Error constructing dynamic original_url for task {task_id}: {e}",
                exc_info=True,
            )
            original_request_obj = task_info.get("original_request", {})
            dynamic_original_url = original_request_obj.get("original_url", "")
    else:
        logger.warning(
            f"Missing download_type ('{download_type}') or item_url ('{item_url}') in task_info for task {task_id}. Falling back for original_url."
        )
        original_request_obj = task_info.get("original_request", {})
        dynamic_original_url = original_request_obj.get("original_url", "")

    status_count = len(get_task_status(task_id))

    # Determine last_line content
    if last_status and "raw_callback" in last_status:
        last_line_content = last_status["raw_callback"]
    elif last_status and get_task_status_from_last_status(last_status) == "error":
        last_line_content = _build_error_callback_object(last_status)
    else:
        last_line_content = last_status

    task_response = {
        "original_url": dynamic_original_url,
        "last_line": last_line_content,
        "timestamp": last_status.get("timestamp") if last_status else current_time,
        "task_id": task_id,
        "status_count": status_count,
        "created_at": task_info.get("created_at"),
        "name": task_info.get("name"),
        "artist": task_info.get("artist"),
        "type": task_info.get("type"),
        "download_type": task_info.get("download_type"),
    }
    if last_status and last_status.get("summary"):
        task_response["summary"] = last_status["summary"]

    return task_response


async def get_paginated_tasks(page=1, limit=20, active_only=False, request: Request = None):
    """
    Get paginated list of tasks.
    """
    try:
        all_tasks = get_all_tasks()
        
        # Get global task counts  
        task_counts = get_global_task_counts()
        
        active_tasks = []
        other_tasks = []
        
        # Process tasks for pagination and response building
        for task_summary in all_tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

            last_status = get_last_task_status(task_id)
            task_status = get_task_status_from_last_status(last_status)
            is_active_task = is_task_active(task_status)
            
            task_response = _build_task_response(task_info, last_status, task_id, time.time(), request)
            
            if is_active_task:
                active_tasks.append(task_response)
            else:
                other_tasks.append(task_response)

        # Sort other tasks by creation time (newest first)
        other_tasks.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        
        if active_only:
            paginated_tasks = active_tasks
            pagination_info = {
                "page": page,
                "limit": limit,
                "total_non_active": 0,
                "has_more": False,
                "returned_non_active": 0
            }
        else:
            # Apply pagination to non-active tasks
            offset = (page - 1) * limit
            paginated_other_tasks = other_tasks[offset:offset + limit]
            paginated_tasks = active_tasks + paginated_other_tasks
            
            pagination_info = {
                "page": page,
                "limit": limit,
                "total_non_active": len(other_tasks),
                "has_more": len(other_tasks) > offset + limit,
                "returned_non_active": len(paginated_other_tasks)
            }

        response = {
            "tasks": paginated_tasks,
            "current_timestamp": time.time(),
            "total_tasks": task_counts["active"] + task_counts["retrying"],  # Only active/retrying tasks for counter
            "all_tasks_count": len(all_tasks),  # Total count of all tasks
            "task_counts": task_counts,  # Categorized counts
            "active_tasks": len(active_tasks),
            "updated_count": len(paginated_tasks),
            "pagination": pagination_info
        }
        
        return response
        
    except Exception as e:
        logger.error(f"Error in get_paginated_tasks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Failed to retrieve paginated tasks"})


# IMPORTANT: Specific routes MUST come before parameterized routes in FastAPI
# Otherwise "updates" gets matched as a {task_id} parameter!

@router.get("/list")
async def list_tasks(request: Request):
    """
    Retrieve a paginated list of all tasks in the system.
    Returns a detailed list of task objects including status and metadata.
    
    Query parameters:
        page (int): Page number for pagination (default: 1)
        limit (int): Number of tasks per page (default: 50, max: 100)
        active_only (bool): If true, only return active tasks (downloading, processing, etc.)
    """
    try:
        # Get query parameters
        page = int(request.query_params.get('page', 1))
        limit = min(int(request.query_params.get('limit', 50)), 100)  # Cap at 100
        active_only = request.query_params.get('active_only', '').lower() == 'true'
        
        tasks = get_all_tasks()
        active_tasks = []
        other_tasks = []
        
        # Task categorization counters
        task_counts = {
            "active": 0,
            "queued": 0, 
            "completed": 0,
            "error": 0,
            "cancelled": 0,
            "retrying": 0,
            "skipped": 0
        }
        
        for task_summary in tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

            last_status = get_last_task_status(task_id)
            task_status = get_task_status_from_last_status(last_status)
            is_active_task = is_task_active(task_status)
            
            # Categorize tasks by status using ProgressState constants
            if task_status == ProgressState.RETRYING:
                task_counts["retrying"] += 1
            elif task_status in {ProgressState.QUEUED, "pending"}:  # Keep "pending" for backward compatibility
                task_counts["queued"] += 1
            elif task_status in {ProgressState.COMPLETE, ProgressState.DONE}:
                task_counts["completed"] += 1
            elif task_status == ProgressState.ERROR:
                task_counts["error"] += 1
            elif task_status == ProgressState.CANCELLED:
                task_counts["cancelled"] += 1
            elif task_status == ProgressState.SKIPPED:
                task_counts["skipped"] += 1
            elif is_active_task:
                task_counts["active"] += 1
            
            task_response = _build_task_response(task_info, last_status, task_id, time.time(), request)
            
            if is_active_task:
                active_tasks.append(task_response)
            else:
                other_tasks.append(task_response)

        # Sort other tasks by creation time (newest first)
        other_tasks.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        
        if active_only:
            # Return only active tasks without pagination
            response_tasks = active_tasks
            pagination_info = {
                "page": page,
                "limit": limit,
                "total_items": len(active_tasks),
                "total_pages": 1,
                "has_more": False
            }
        else:
            # Apply pagination to non-active tasks and combine with active tasks
            offset = (page - 1) * limit
            
            # Always include active tasks at the top
            if page == 1:
                # For first page, include active tasks + first batch of other tasks
                available_space = limit - len(active_tasks)
                paginated_other_tasks = other_tasks[:max(0, available_space)]
                response_tasks = active_tasks + paginated_other_tasks
            else:
                # For subsequent pages, only include other tasks
                # Adjust offset to account for active tasks shown on first page
                adjusted_offset = offset - len(active_tasks)
                if adjusted_offset < 0:
                    adjusted_offset = 0
                paginated_other_tasks = other_tasks[adjusted_offset:adjusted_offset + limit]
                response_tasks = paginated_other_tasks
            
            total_items = len(active_tasks) + len(other_tasks)
            total_pages = ((total_items - 1) // limit) + 1 if total_items > 0 else 1
            
            pagination_info = {
                "page": page,
                "limit": limit,
                "total_items": total_items,
                "total_pages": total_pages,
                "has_more": page < total_pages,
                "active_tasks": len(active_tasks),
                "total_other_tasks": len(other_tasks)
            }

        response = {
            "tasks": response_tasks,
            "pagination": pagination_info,
            "total_tasks": task_counts["active"] + task_counts["retrying"],  # Only active/retrying tasks for counter
            "all_tasks_count": len(tasks),  # Total count of all tasks
            "task_counts": task_counts,  # Categorized counts
            "active_tasks": len(active_tasks),
            "timestamp": time.time()
        }

        return response
    except Exception as e:
        logger.error(f"Error in /api/prgs/list: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Failed to retrieve task list"})


@router.get("/updates")
async def get_task_updates(request: Request):
    """
    Retrieve only tasks that have been updated since the specified timestamp.
    This endpoint is optimized for polling to reduce unnecessary data transfer.
    
    Query parameters:
        since (float): Unix timestamp - only return tasks updated after this time
        page (int): Page number for pagination (default: 1)
        limit (int): Number of queued/completed tasks per page (default: 20, max: 100)
        active_only (bool): If true, only return active tasks (downloading, processing, etc.)
        
    Returns:
        JSON object containing:
        - tasks: Array of updated task objects
        - current_timestamp: Current server timestamp for next poll
        - total_tasks: Total number of tasks in system
        - active_tasks: Number of active tasks
        - pagination: Pagination info for queued/completed tasks
    """
    try:
        # Get query parameters
        since_param = request.query_params.get('since')
        page = int(request.query_params.get('page', 1))
        limit = min(int(request.query_params.get('limit', 20)), 100)  # Cap at 100
        active_only = request.query_params.get('active_only', '').lower() == 'true'
        
        if not since_param:
            # If no 'since' parameter, return paginated tasks (fallback behavior)
            response = await get_paginated_tasks(page, limit, active_only, request)
            return response
        
        try:
            since_timestamp = float(since_param)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail={"error": "Invalid 'since' timestamp format"})
        
        # Get all tasks
        all_tasks = get_all_tasks()
        current_time = time.time()
        
        # Get global task counts
        task_counts = get_global_task_counts()
        
        updated_tasks = []
        active_tasks = []
        
        # Process tasks for filtering and response building
        for task_summary in all_tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

            last_status = get_last_task_status(task_id)
            task_status = get_task_status_from_last_status(last_status)
            is_active_task = is_task_active(task_status)
            
            # Check if task has been updated since the given timestamp
            task_timestamp = last_status.get("timestamp") if last_status else task_info.get("created_at", 0)
            
            # Always include active tasks in updates, apply filtering to others
            # Also include recently completed/terminal tasks to ensure "done" status gets sent
            is_recently_terminal = task_status in TERMINAL_TASK_STATES and task_timestamp > since_timestamp
            should_include = is_active_task or (task_timestamp > since_timestamp and not active_only) or is_recently_terminal
            
            if should_include:
                # Construct the same detailed task object as in list_tasks()
                task_response = _build_task_response(task_info, last_status, task_id, current_time, request)
                
                if is_active_task:
                    active_tasks.append(task_response)
                else:
                    updated_tasks.append(task_response)

        # Apply pagination to non-active tasks
        offset = (page - 1) * limit
        paginated_updated_tasks = updated_tasks[offset:offset + limit] if not active_only else []
        
        # Combine active tasks (always shown) with paginated updated tasks
        all_returned_tasks = active_tasks + paginated_updated_tasks
        
        # Sort by priority (active first, then by creation time)
        all_returned_tasks.sort(key=lambda x: (
            0 if x.get("task_id") in [t["task_id"] for t in active_tasks] else 1,
            -x.get("created_at", 0)
        ))

        response = {
            "tasks": all_returned_tasks,
            "current_timestamp": current_time,
            "total_tasks": task_counts["active"] + task_counts["retrying"],  # Only active/retrying tasks for counter
            "all_tasks_count": len(all_tasks),  # Total count of all tasks
            "task_counts": task_counts,  # Categorized counts
            "active_tasks": len(active_tasks),
            "updated_count": len(updated_tasks),
            "since_timestamp": since_timestamp,
            "pagination": {
                "page": page,
                "limit": limit,
                "total_non_active": len(updated_tasks),
                "has_more": len(updated_tasks) > offset + limit,
                "returned_non_active": len(paginated_updated_tasks)
            }
        }
        
        logger.debug(f"Returning {len(active_tasks)} active + {len(paginated_updated_tasks)} paginated tasks out of {len(all_tasks)} total")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in /api/prgs/updates: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Failed to retrieve task updates"})


@router.post("/cancel/all")
async def cancel_all_tasks():
    """
    Cancel all active (running or queued) tasks.
    """
    try:
        tasks_to_cancel = get_all_tasks()
        cancelled_count = 0
        errors = []

        for task_summary in tasks_to_cancel:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue
            try:
                cancel_task(task_id)
                cancelled_count += 1
            except Exception as e:
                error_message = f"Failed to cancel task {task_id}: {e}"
                logger.error(error_message)
                errors.append(error_message)

        response = {
            "message": f"Attempted to cancel all active tasks. {cancelled_count} tasks cancelled.",
            "cancelled_count": cancelled_count,
            "errors": errors,
        }
        return response
    except Exception as e:
        logger.error(f"Error in /api/prgs/cancel/all: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Failed to cancel all tasks"})


@router.post("/cancel/{task_id}")
async def cancel_task_endpoint(task_id: str):
    """
    Cancel a running or queued task.

    Args:
        task_id: The ID of the task to cancel
    """
    try:
        # First check if this is a task ID in the new system
        task_info = get_task_info(task_id)

        if task_info:
            # This is a task ID in the new system
            result = cancel_task(task_id)
            return result

        # If not found in new system, we need to handle the old system cancellation
        # For now, return an error as we're transitioning to the new system
        raise HTTPException(
            status_code=400,
            detail={
                "status": "error",
                "message": "Cancellation for old system is not supported in the new API. Please use the new task ID format.",
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred: {e}")


@router.delete("/delete/{task_id}")
async def delete_task(task_id: str):
    """
    Delete a task's information and history.

    Args:
        task_id: A task UUID from Celery
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")

    # First, cancel the task if it's running
    cancel_task(task_id)

    return {"message": f"Task {task_id} deleted successfully"}


@router.get("/stream")
async def stream_task_updates(request: Request):
    """
    Stream real-time task updates via Server-Sent Events (SSE).
    Now uses event-driven architecture for true real-time updates.
    
    Query parameters:
        active_only (bool): If true, only stream active tasks (downloading, processing, etc.)
    
    Returns:
        Server-Sent Events stream with task update data in JSON format
    """
    
    # Get query parameters
    active_only = request.query_params.get('active_only', '').lower() == 'true'
    
    async def event_generator():
        # Create a queue for this client
        client_queue = asyncio.Queue()
        
        try:
            # Register this client with the broadcaster
            logger.info(f"SSE Stream: New client connecting...")
            await sse_broadcaster.add_client(client_queue)
            logger.info(f"SSE Stream: Client registered successfully, total clients: {len(sse_broadcaster.clients)}")
            
            # Send initial data immediately upon connection
            initial_data = await generate_task_update_event(time.time(), active_only, request)
            yield initial_data
            
            # Also send any active tasks as callback-style events to newly connected clients
            all_tasks = get_all_tasks()
            for task_summary in all_tasks:
                task_id = task_summary.get("task_id")
                if not task_id:
                    continue
                    
                task_info = get_task_info(task_id)
                if not task_info:
                    continue
                    
                last_status = get_last_task_status(task_id)
                task_status = get_task_status_from_last_status(last_status)
                
                # Send recent callback data for active or recently completed tasks
                if is_task_active(task_status) or (last_status and last_status.get("timestamp", 0) > time.time() - 30):
                    if last_status and "raw_callback" in last_status:
                        callback_event = {
                            "task_id": task_id,
                            "callback_data": last_status["raw_callback"],
                            "timestamp": last_status.get("timestamp", time.time()),
                            "change_type": "callback",
                            "event_type": "progress_update",
                            "replay": True  # Mark as replay for client
                        }
                        event_json = json.dumps(callback_event)
                        yield f"data: {event_json}\n\n"
                        logger.info(f"SSE Stream: Sent replay callback for task {task_id}")
            
            # Send periodic heartbeats and listen for real-time events
            last_heartbeat = time.time()
            heartbeat_interval = 30.0
            
            while True:
                try:
                    # Wait for either an event or timeout for heartbeat
                    try:
                        event_data = await asyncio.wait_for(client_queue.get(), timeout=heartbeat_interval)
                        # Send the real-time event
                        yield event_data
                        last_heartbeat = time.time()
                    except asyncio.TimeoutError:
                        # Send heartbeat if no events for a while
                        current_time = time.time()
                        if current_time - last_heartbeat >= heartbeat_interval:
                            # Generate current task counts for heartbeat
                            all_tasks = get_all_tasks()
                            task_counts = {"active": 0, "queued": 0, "completed": 0, "error": 0, "cancelled": 0, "retrying": 0, "skipped": 0}
                            
                            for task_summary in all_tasks:
                                task_id = task_summary.get("task_id")
                                if not task_id:
                                    continue
                                task_info = get_task_info(task_id)
                                if not task_info:
                                    continue
                                last_status = get_last_task_status(task_id)
                                task_status = get_task_status_from_last_status(last_status)
                                
                                if task_status == ProgressState.RETRYING:
                                    task_counts["retrying"] += 1
                                elif task_status in {ProgressState.QUEUED, "pending"}:
                                    task_counts["queued"] += 1
                                elif task_status in {ProgressState.COMPLETE, ProgressState.DONE}:
                                    task_counts["completed"] += 1
                                elif task_status == ProgressState.ERROR:
                                    task_counts["error"] += 1
                                elif task_status == ProgressState.CANCELLED:
                                    task_counts["cancelled"] += 1
                                elif task_status == ProgressState.SKIPPED:
                                    task_counts["skipped"] += 1
                                elif is_task_active(task_status):
                                    task_counts["active"] += 1
                            
                            heartbeat_data = {
                                "current_timestamp": current_time,
                                "total_tasks": task_counts["active"] + task_counts["retrying"],
                                "task_counts": task_counts,
                                "change_type": "heartbeat"
                            }
                            
                            event_json = json.dumps(heartbeat_data)
                            yield f"data: {event_json}\n\n"
                            last_heartbeat = current_time
                            
                except Exception as e:
                    logger.error(f"Error in SSE event streaming: {e}", exc_info=True)
                    # Send error event and continue
                    error_data = json.dumps({"error": "Internal server error", "timestamp": time.time(), "change_type": "error"})
                    yield f"data: {error_data}\n\n"
                    await asyncio.sleep(1)
                    
        except asyncio.CancelledError:
            logger.info("SSE client disconnected")
            return
        except Exception as e:
            logger.error(f"SSE connection error: {e}", exc_info=True)
            return
        finally:
            # Clean up - remove client from broadcaster
            await sse_broadcaster.remove_client(client_queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control"
        }
    )


async def generate_task_update_event(since_timestamp: float, active_only: bool, request: Request) -> str:
    """
    Generate initial task update event for SSE connection.
    This replicates the logic from get_task_updates but for SSE format.
    """
    try:
        # Get all tasks for filtering
        all_tasks = get_all_tasks()
        current_time = time.time()
        
        updated_tasks = []
        active_tasks = []
        
        # Process tasks for filtering only - no counting here
        for task_summary in all_tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

            last_status = get_last_task_status(task_id)
            task_status = get_task_status_from_last_status(last_status)
            is_active_task = is_task_active(task_status)
            
            # Check if task has been updated since the given timestamp
            task_timestamp = last_status.get("timestamp") if last_status else task_info.get("created_at", 0)
            
            # Always include active tasks in updates, apply filtering to others
            # Also include recently completed/terminal tasks to ensure "done" status gets sent
            is_recently_terminal = task_status in TERMINAL_TASK_STATES and task_timestamp > since_timestamp
            should_include = is_active_task or (task_timestamp > since_timestamp and not active_only) or is_recently_terminal
            
            if should_include:
                # Construct the same detailed task object as in updates endpoint
                task_response = _build_task_response(task_info, last_status, task_id, current_time, request)
                
                if is_active_task:
                    active_tasks.append(task_response)
                else:
                    updated_tasks.append(task_response)

        # Combine active tasks (always shown) with updated tasks
        all_returned_tasks = active_tasks + updated_tasks
        
        # Sort by priority (active first, then by creation time)
        all_returned_tasks.sort(key=lambda x: (
            0 if x.get("task_id") in [t["task_id"] for t in active_tasks] else 1,
            -x.get("created_at", 0)
        ))

        initial_data = {
            "tasks": all_returned_tasks,
            "current_timestamp": current_time,
            "updated_count": len(updated_tasks),
            "since_timestamp": since_timestamp,
            "initial": True  # Mark as initial load
        }
        
        # Add global task counts since this bypasses the broadcaster
        enhanced_data = add_global_task_counts_to_event(initial_data)
        
        event_data = json.dumps(enhanced_data)
        return f"data: {event_data}\n\n"
        
    except Exception as e:
        logger.error(f"Error generating initial SSE event: {e}", exc_info=True)
        error_data = json.dumps({"error": "Failed to load initial data", "timestamp": time.time()})
        return f"data: {error_data}\n\n"


# IMPORTANT: This parameterized route MUST come AFTER all specific routes
# Otherwise FastAPI will match specific routes like "/updates" as task_id parameters
@router.get("/{task_id}")
async def get_task_details(task_id: str, request: Request):
    """
    Return a JSON object with the resource type, its name (title),
    the last progress update, and, if available, the original request parameters.

    This function works with the new task ID based system.

    Args:
        task_id: A task UUID from Celery
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")

    # Dynamically construct original_url
    dynamic_original_url = ""
    download_type = task_info.get("download_type")
    # The 'url' field in task_info stores the Spotify/Deezer URL of the item
    # e.g., https://open.spotify.com/album/albumId or https://www.deezer.com/track/trackId
    item_url = task_info.get("url")

    if download_type and item_url:
        try:
            # Extract the ID from the item_url (last part of the path)
            item_id = item_url.split("/")[-1]
            if item_id:  # Ensure item_id is not empty
                base_url = str(request.base_url).rstrip("/")
                dynamic_original_url = (
                    f"{base_url}/api/{download_type}/download/{item_id}"
                )
            else:
                logger.warning(
                    f"Could not extract item ID from URL: {item_url} for task {task_id}. Falling back for original_url."
                )
                original_request_obj = task_info.get("original_request", {})
                dynamic_original_url = original_request_obj.get("original_url", "")
        except Exception as e:
            logger.error(
                f"Error constructing dynamic original_url for task {task_id}: {e}",
                exc_info=True,
            )
            original_request_obj = task_info.get("original_request", {})
            dynamic_original_url = original_request_obj.get(
                "original_url", ""
            )  # Fallback on any error
    else:
        logger.warning(
            f"Missing download_type ('{download_type}') or item_url ('{item_url}') in task_info for task {task_id}. Falling back for original_url."
        )
        original_request_obj = task_info.get("original_request", {})
        dynamic_original_url = original_request_obj.get("original_url", "")

    last_status = get_last_task_status(task_id)
    status_count = len(get_task_status(task_id))

    # Determine last_line content
    if last_status and "raw_callback" in last_status:
        last_line_content = last_status["raw_callback"]
    elif last_status and get_task_status_from_last_status(last_status) == "error":
        last_line_content = _build_error_callback_object(last_status)
    else:
        # Fallback for non-error, no raw_callback, or if last_status is None
        last_line_content = last_status

    response = {
        "original_url": dynamic_original_url,
        "last_line": last_line_content,
        "timestamp": last_status.get("timestamp") if last_status else time.time(),
        "task_id": task_id,
        "status_count": status_count,
        "created_at": task_info.get("created_at"),
        "name": task_info.get("name"),
        "artist": task_info.get("artist"),
        "type": task_info.get("type"),
        "download_type": task_info.get("download_type"),
    }
    if last_status and last_status.get("summary"):
        response["summary"] = last_status["summary"]
    return response
