from flask import Blueprint, abort, jsonify, Response, stream_with_context
import os
import json
import logging
import time

from routes.utils.celery_tasks import (
    get_task_info,
    get_task_status,
    get_last_task_status,
    get_all_tasks,
    cancel_task,
    retry_task,
    ProgressState,
    redis_client
)

# Configure logging
logger = logging.getLogger(__name__)

prgs_bp = Blueprint('prgs', __name__, url_prefix='/api/prgs')

# (Old .prg file system removed. Using new task system only.)

@prgs_bp.route('/<task_id>', methods=['GET'])
def get_prg_file(task_id):
    """
    Return a JSON object with the resource type, its name (title),
    the last progress update, and, if available, the original request parameters.
    
    This function works with both the old PRG file system (for backward compatibility)
    and the new task ID based system.
    
    Args:
        task_id: Either a task UUID from Celery or a PRG filename from the old system
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        abort(404, "Task not found")
    original_request = task_info.get("original_request", {})
    last_status = get_last_task_status(task_id)
    status_count = len(get_task_status(task_id))
    response = {
        "original_url": original_request.get("original_url", ""),
        "last_line": last_status,
        "timestamp": time.time(),
        "task_id": task_id,
        "status_count": status_count
    }
    return jsonify(response)


@prgs_bp.route('/delete/<task_id>', methods=['DELETE'])
def delete_prg_file(task_id):
    """
    Delete a task's information and history.
    Works with both the old PRG file system and the new task ID based system.
    
    Args:
        task_id: Either a task UUID from Celery or a PRG filename from the old system
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        abort(404, "Task not found")
    cancel_task(task_id)
    from routes.utils.celery_tasks import redis_client
    redis_client.delete(f"task:{task_id}:info")
    redis_client.delete(f"task:{task_id}:status")
    return {'message': f'Task {task_id} deleted successfully'}, 200


@prgs_bp.route('/list', methods=['GET'])
def list_prg_files():
    """
    Retrieve a list of all tasks in the system.
    Combines results from both the old PRG file system and the new task ID based system.
    """
    # List only new system tasks
    tasks = get_all_tasks()
    task_ids = [task["task_id"] for task in tasks]
    return jsonify(task_ids)


@prgs_bp.route('/retry/<task_id>', methods=['POST'])
def retry_task_endpoint(task_id):
    """
    Retry a failed task.
    
    Args:
        task_id: The ID of the task to retry
    """
    try:
        # First check if this is a task ID in the new system
        task_info = get_task_info(task_id)
        
        if task_info:
            # This is a task ID in the new system
            result = retry_task(task_id)
            return jsonify(result)
        
        # If not found in new system, we need to handle the old system retry
        # For now, return an error as we're transitioning to the new system
        return jsonify({
            "status": "error",
            "message": "Retry for old system is not supported in the new API. Please use the new task ID format."
        }), 400
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route('/cancel/<task_id>', methods=['POST'])
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
        return jsonify({
            "status": "error",
            "message": "Cancellation for old system is not supported in the new API. Please use the new task ID format."
        }), 400
    except Exception as e:
        abort(500, f"An error occurred: {e}")
