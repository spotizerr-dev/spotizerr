from flask import Blueprint, abort, jsonify, request
import logging
import time

from routes.utils.celery_tasks import (
    get_task_info,
    get_task_status,
    get_last_task_status,
    get_all_tasks,
    cancel_task,
)

# Configure logging
logger = logging.getLogger(__name__)

prgs_bp = Blueprint("prgs", __name__, url_prefix="/api/prgs")

# (Old .prg file system removed. Using new task system only.)


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
    elif last_status and last_status.get("status") == "error":
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
    Retrieve a list of all tasks in the system.
    Returns a detailed list of task objects including status and metadata.
    """
    try:
        tasks = get_all_tasks()
        detailed_tasks = []
        for task_summary in tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            if not task_info:
                continue

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
                        dynamic_original_url = original_request_obj.get(
                            "original_url", ""
                        )
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
            elif last_status and last_status.get("status") == "error":
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

            detailed_tasks.append(response)

        # Sort tasks by creation time (newest first)
        detailed_tasks.sort(key=lambda x: x.get("created_at", 0), reverse=True)

        return jsonify(detailed_tasks)
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
