from flask import Blueprint, abort, jsonify
import os
import json

from routes.utils.celery_tasks import (
    get_task_info,
    get_task_status,
    get_last_task_status,
    get_all_tasks,
    cancel_task,
    retry_task
)

prgs_bp = Blueprint('prgs', __name__, url_prefix='/api/prgs')

# The old path for PRG files (keeping for backward compatibility during transition)
PRGS_DIR = os.path.join(os.getcwd(), 'prgs')

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
    try:
        # First check if this is a task ID in the new system
        task_info = get_task_info(task_id)
        
        if task_info:
            # This is a task ID in the new system
            original_request = task_info.get("original_request", {})
            last_status = get_last_task_status(task_id)
            
            return jsonify({
                "type": task_info.get("type", ""),
                "name": task_info.get("name", ""),
                "artist": task_info.get("artist", ""),
                "last_line": last_status,
                "original_request": original_request,
                "display_title": original_request.get("display_title", task_info.get("name", "")),
                "display_type": original_request.get("display_type", task_info.get("type", "")),
                "display_artist": original_request.get("display_artist", task_info.get("artist", ""))
            })
        
        # If not found in new system, try the old PRG file system
        # Security check to prevent path traversal attacks.
        if '..' in task_id or '/' in task_id:
            abort(400, "Invalid file request")

        filepath = os.path.join(PRGS_DIR, task_id)

        with open(filepath, 'r') as f:
            content = f.read()
            lines = content.splitlines()

        # If the file is empty, return default values.
        if not lines:
            return jsonify({
                "type": "",
                "name": "",
                "artist": "",
                "last_line": None,
                "original_request": None,
                "display_title": "",
                "display_type": "",
                "display_artist": ""
            })

        # Attempt to extract the original request from the first line.
        original_request = None
        display_title = ""
        display_type = ""
        display_artist = ""
        
        try:
            first_line = json.loads(lines[0])
            if isinstance(first_line, dict):
                if "original_request" in first_line:
                    original_request = first_line["original_request"]
                else:
                    # The first line might be the original request itself
                    original_request = first_line
                
                # Extract display information from the original request
                if original_request:
                    display_title = original_request.get("display_title", original_request.get("name", ""))
                    display_type = original_request.get("display_type", original_request.get("type", ""))
                    display_artist = original_request.get("display_artist", original_request.get("artist", ""))
        except Exception as e:
            print(f"Error parsing first line of PRG file: {e}")
            original_request = None

        # For resource type and name, use the second line if available.
        resource_type = ""
        resource_name = ""
        resource_artist = ""
        if len(lines) > 1:
            try:
                second_line = json.loads(lines[1])
                # Directly extract 'type' and 'name' from the JSON
                resource_type = second_line.get("type", "")
                resource_name = second_line.get("name", "")
                resource_artist = second_line.get("artist", "")
            except Exception:
                resource_type = ""
                resource_name = ""
                resource_artist = ""
        else:
            resource_type = ""
            resource_name = ""
            resource_artist = ""

        # Get the last line from the file.
        last_line_raw = lines[-1]
        try:
            last_line_parsed = json.loads(last_line_raw)
        except Exception:
            last_line_parsed = last_line_raw  # Fallback to raw string if JSON parsing fails.

        return jsonify({
            "type": resource_type,
            "name": resource_name,
            "artist": resource_artist,
            "last_line": last_line_parsed,
            "original_request": original_request,
            "display_title": display_title,
            "display_type": display_type,
            "display_artist": display_artist
        })
    except FileNotFoundError:
        abort(404, "Task or file not found")
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route('/delete/<task_id>', methods=['DELETE'])
def delete_prg_file(task_id):
    """
    Delete a task's information and history.
    Works with both the old PRG file system and the new task ID based system.
    
    Args:
        task_id: Either a task UUID from Celery or a PRG filename from the old system
    """
    try:
        # First try to delete from Redis if it's a task ID
        task_info = get_task_info(task_id)
        
        if task_info:
            # This is a task ID in the new system - we should cancel it first
            # if it's still running, then clear its data from Redis
            cancel_result = cancel_task(task_id)
            
            # Use Redis connection to delete the task data
            from routes.utils.celery_tasks import redis_client
            
            # Delete task info and status
            redis_client.delete(f"task:{task_id}:info")
            redis_client.delete(f"task:{task_id}:status")
            
            return {'message': f'Task {task_id} deleted successfully'}, 200
        
        # If not found in Redis, try the old PRG file system
        # Security checks to prevent path traversal and ensure correct file type.
        if '..' in task_id or '/' in task_id:
            abort(400, "Invalid file request")
        if not task_id.endswith('.prg'):
            abort(400, "Only .prg files can be deleted")
        
        filepath = os.path.join(PRGS_DIR, task_id)
        
        if not os.path.isfile(filepath):
            abort(404, "File not found")
        
        os.remove(filepath)
        return {'message': f'File {task_id} deleted successfully'}, 200
    except FileNotFoundError:
        abort(404, "Task or file not found")
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route('/list', methods=['GET'])
def list_prg_files():
    """
    Retrieve a list of all tasks in the system.
    Combines results from both the old PRG file system and the new task ID based system.
    """
    try:
        # Get tasks from the new system
        tasks = get_all_tasks()
        task_ids = [task["task_id"] for task in tasks]
        
        # Get PRG files from the old system
        prg_files = []
        if os.path.isdir(PRGS_DIR):
            with os.scandir(PRGS_DIR) as entries:
                for entry in entries:
                    if entry.is_file() and entry.name.endswith('.prg'):
                        prg_files.append(entry.name)
        
        # Combine both lists
        all_ids = task_ids + prg_files
        
        return jsonify(all_ids)
    except Exception as e:
        abort(500, f"An error occurred: {e}")


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
