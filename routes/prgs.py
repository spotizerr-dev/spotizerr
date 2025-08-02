from flask import Blueprint, abort, jsonify, request
import logging
import time

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

prgs_bp = Blueprint("prgs", __name__, url_prefix="/api/prgs")

# (Old .prg file system removed. Using new task system only.)

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
}

def get_task_status_from_last_status(last_status):
    """
    Extract the task status from last_status, checking both possible locations.
    
    Args:
        last_status: The last status dict from get_last_task_status()
        
    Returns:
        str: The task status string
    """
    if not last_status:
        return "unknown"
    
    # Check for status in nested status_info (for real-time downloads)
    status_info = last_status.get("status_info", {})
    if isinstance(status_info, dict) and "status" in status_info:
        return status_info["status"]
    
    # Fall back to top-level status (for other task types)
    return last_status.get("status", "unknown")


def is_task_active(task_status):
    """
    Determine if a task is currently active (working/processing).
    
    Args:
        task_status: The status string from the task
        
    Returns:
        bool: True if the task is active, False otherwise
    """
    return task_status in ACTIVE_TASK_STATES


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


def _build_task_response(task_info, last_status, task_id, current_time):
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
                base_url = request.host_url.rstrip("/")
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


def get_paginated_tasks(page=1, limit=20, active_only=False):
    """
    Get paginated list of tasks.
    """
    try:
        all_tasks = get_all_tasks()
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
            
            task_response = _build_task_response(task_info, last_status, task_id, time.time())
            
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
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Error in get_paginated_tasks: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve paginated tasks"}), 500


@prgs_bp.route("/<task_id>", methods=["GET"])
def get_task_details(task_id):
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
        abort(404, "Task not found")

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
                base_url = request.host_url.rstrip("/")
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
    return jsonify(response)


@prgs_bp.route("/delete/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    """
    Delete a task's information and history.

    Args:
        task_id: A task UUID from Celery
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        abort(404, "Task not found")

    # First, cancel the task if it's running
    cancel_task(task_id)

    return {"message": f"Task {task_id} deleted successfully"}, 200


@prgs_bp.route("/list", methods=["GET"])
def list_tasks():
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
        page = int(request.args.get('page', 1))
        limit = min(int(request.args.get('limit', 50)), 100)  # Cap at 100
        active_only = request.args.get('active_only', '').lower() == 'true'
        
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
            
            task_response = _build_task_response(task_info, last_status, task_id, time.time())
            
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

        return jsonify(response)
    except Exception as e:
        logger.error(f"Error in /api/prgs/list: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve task list"}), 500

@prgs_bp.route("/cancel/<task_id>", methods=["POST"])
def cancel_task_endpoint(task_id):
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
            return jsonify(result)

        # If not found in new system, we need to handle the old system cancellation
        # For now, return an error as we're transitioning to the new system
        return jsonify(
            {
                "status": "error",
                "message": "Cancellation for old system is not supported in the new API. Please use the new task ID format.",
            }
        ), 400
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route("/cancel/all", methods=["POST"])
def cancel_all_tasks():
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
        return jsonify(response), 200
    except Exception as e:
        logger.error(f"Error in /api/prgs/cancel/all: {e}", exc_info=True)
        return jsonify({"error": "Failed to cancel all tasks"}), 500


@prgs_bp.route("/updates", methods=["GET"])
def get_task_updates():
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
        since_param = request.args.get('since')
        page = int(request.args.get('page', 1))
        limit = min(int(request.args.get('limit', 20)), 100)  # Cap at 100
        active_only = request.args.get('active_only', '').lower() == 'true'
        
        if not since_param:
            # If no 'since' parameter, return paginated tasks (fallback behavior)
            return get_paginated_tasks(page, limit, active_only)
        
        try:
            since_timestamp = float(since_param)
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid 'since' timestamp format"}), 400
        
        # Get all tasks
        all_tasks = get_all_tasks()
        updated_tasks = []
        active_tasks = []
        current_time = time.time()
        
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
        
        for task_summary in all_tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

            last_status = get_last_task_status(task_id)
            
            # Check if task has been updated since the given timestamp
            task_timestamp = last_status.get("timestamp") if last_status else task_info.get("created_at", 0)
            
            # Determine task status and categorize
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
            
            # Always include active tasks in updates, apply filtering to others
            should_include = is_active_task or (task_timestamp > since_timestamp and not active_only)
            
            if should_include:
                # Construct the same detailed task object as in list_tasks()
                task_response = _build_task_response(task_info, last_status, task_id, current_time)
                
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
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Error in /api/prgs/updates: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve task updates"}), 500
