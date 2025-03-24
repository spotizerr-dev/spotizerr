from flask import Blueprint, abort, jsonify, Response, stream_with_context
import os
import json
import logging
import time
import random

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
            
            # Get the latest status update for this task
            last_status = get_last_task_status(task_id)
            logger.debug(f"API: Got last_status for {task_id}: {json.dumps(last_status) if last_status else None}")
            
            # Get all status updates for debugging
            all_statuses = get_task_status(task_id)
            status_count = len(all_statuses)
            logger.debug(f"API: Task {task_id} has {status_count} status updates")
            
            # Prepare the response with basic info
            response = {
                "type": task_info.get("type", ""),
                "name": task_info.get("name", ""),
                "artist": task_info.get("artist", ""),
                "last_line": last_status,
                "original_request": original_request,
                "display_title": original_request.get("display_title", task_info.get("name", "")),
                "display_type": original_request.get("display_type", task_info.get("type", "")),
                "display_artist": original_request.get("display_artist", task_info.get("artist", "")),
                "status_count": status_count
            }
            
            # Handle different status types 
            if last_status:
                status_type = last_status.get("status", "unknown")
                
                # For terminal statuses (complete, error, cancelled)
                if status_type in [ProgressState.COMPLETE, ProgressState.ERROR, ProgressState.CANCELLED]:
                    response["progress_message"] = last_status.get("message", f"Download {status_type}")
                
                # For progress status with track information
                elif status_type == "progress" and last_status.get("track"):
                    # Add explicit track progress fields to the top level for easy access
                    response["current_track"] = last_status.get("track", "")
                    response["track_number"] = last_status.get("parsed_current_track", 0)
                    response["total_tracks"] = last_status.get("parsed_total_tracks", 0)
                    response["progress_percent"] = last_status.get("overall_progress", 0)
                    response["album"] = last_status.get("album", "")
                    
                    # Format a nice progress message for display
                    track_info = last_status.get("track", "")
                    current = last_status.get("parsed_current_track", 0)
                    total = last_status.get("parsed_total_tracks", 0)
                    progress = last_status.get("overall_progress", 0)
                    
                    if current and total:
                        response["progress_message"] = f"Downloading track {current}/{total} ({progress}%): {track_info}"
                    elif track_info:
                        response["progress_message"] = f"Downloading: {track_info}"
                
                # For initializing status
                elif status_type == "initializing":
                    album = last_status.get("album", "")
                    if album:
                        response["progress_message"] = f"Initializing download for {album}"
                    else:
                        response["progress_message"] = "Initializing download..."
                
                # For processing status (default)
                elif status_type == "processing":
                    # Search for the most recent track progress in all statuses
                    has_progress = False
                    for status in reversed(all_statuses):
                        if status.get("status") == "progress" and status.get("track"):
                            # Use this track progress information
                            track_info = status.get("track", "")
                            current_raw = status.get("current_track", "")
                            response["current_track"] = track_info
                            
                            # Try to parse track numbers if available
                            if isinstance(current_raw, str) and "/" in current_raw:
                                try:
                                    parts = current_raw.split("/")
                                    current = int(parts[0])
                                    total = int(parts[1])
                                    response["track_number"] = current
                                    response["total_tracks"] = total
                                    response["progress_percent"] = min(int((current / total) * 100), 100)
                                    response["progress_message"] = f"Processing track {current}/{total}: {track_info}"
                                except (ValueError, IndexError):
                                    response["progress_message"] = f"Processing: {track_info}"
                            else:
                                response["progress_message"] = f"Processing: {track_info}"
                                
                            has_progress = True
                            break
                    
                    if not has_progress:
                        # Just use the processing message
                        response["progress_message"] = last_status.get("message", "Processing download...")
                
                # For other status types
                else:
                    response["progress_message"] = last_status.get("message", f"Status: {status_type}")
            
            return jsonify(response)
        
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


@prgs_bp.route('/stream/<task_id>', methods=['GET'])
def stream_task_status(task_id):
    """
    Stream task status updates as Server-Sent Events (SSE).
    This endpoint opens a persistent connection and sends updates in real-time.
    
    Args:
        task_id: The ID of the task to stream updates for
    """
    def generate():
        try:
            # Get initial task info to send as the opening message
            task_info = get_task_info(task_id)
            
            if not task_info:
                # Check if this is an old PRG file
                if os.path.exists(os.path.join(PRGS_DIR, task_id)):
                    # Return error - SSE not supported for old PRG files
                    yield f"event: error\ndata: {json.dumps({'error': 'SSE streaming not supported for old PRG files'})}\n\n"
                    return
                else:
                    # Task not found
                    yield f"event: error\ndata: {json.dumps({'error': 'Task not found'})}\n\n"
                    return
            
            # Get the original request and other basic info for the opening message
            original_request = task_info.get("original_request", {})
            download_type = task_info.get("type", "")
            name = task_info.get("name", "")
            artist = task_info.get("artist", "")
            
            # Prepare the opening message with the required information
            opening_data = {
                "event": "start",
                "task_id": task_id,
                "type": download_type,
                "name": name,
                "artist": artist,
                "url": original_request.get("url", ""),
                "service": original_request.get("service", ""),
                "timestamp": time.time(),
                "status": "initializing",
                "message": f"Starting {download_type} download: {name}" + (f" by {artist}" if artist else "")
            }
            
            # Send the opening message
            yield f"event: start\ndata: {json.dumps(opening_data)}\n\n"
            
            # Get existing status updates to catch up (most recent first)
            all_updates = get_task_status(task_id)
            # Sort updates by id
            sorted_updates = sorted(all_updates, key=lambda x: x.get("id", 0))
            
            # Limit to send only the 5 most recent updates to reduce initial payload
            for i, update in enumerate(sorted_updates[-5:]):
                # Add the task_id to each update message
                update["task_id"] = task_id
                yield f"event: update\ndata: {json.dumps(update)}\n\n"
            
            # Keep track of the last update ID we've sent
            last_sent_id = 0
            if sorted_updates:
                last_sent_id = sorted_updates[-1].get("id", 0)
            
            # Create a Redis connection for subscribing to updates
            redis_pubsub = redis_client.pubsub()
            redis_pubsub.subscribe(f"task_updates:{task_id}")
            
            # Hold the connection open and check for updates
            last_heartbeat = time.time()
            heartbeat_interval = 30  # Increased from 15 to 30 seconds to reduce overhead
            
            # Optimize polling with a more efficient loop structure
            check_interval = 0.2  # Check for messages every 200ms instead of continuously
            message_batch_size = 5  # Process up to 5 messages at a time
            
            while True:
                # Process a batch of messages to reduce CPU usage
                messages_processed = 0
                while messages_processed < message_batch_size:
                    # Check for new updates via Redis Pub/Sub with a timeout
                    message = redis_pubsub.get_message(timeout=check_interval)
                    
                    if not message:
                        break  # No more messages to process
                    
                    if message['type'] == 'message':
                        messages_processed += 1
                        # Got a new message from Redis Pub/Sub
                        try:
                            data = json.loads(message['data'].decode('utf-8'))
                            status_id = data.get('status_id', 0)
                            
                            # Only process if this is a new status update
                            if status_id > last_sent_id:
                                # Efficient fetch - only get the specific status update we need
                                for idx in range(-10, 0):  # Check last 10 entries for efficiency
                                    status_data = redis_client.lindex(f"task:{task_id}:status", idx)
                                    if status_data:
                                        status = json.loads(status_data.decode('utf-8'))
                                        if status.get("id") == status_id:
                                            # Add the task_id to the update
                                            status["task_id"] = task_id
                                            
                                            # Choose the appropriate event type based on status
                                            status_type = status.get("status", "")
                                            event_type = "update"
                                            
                                            if status_type == ProgressState.COMPLETE or status_type == ProgressState.DONE:
                                                event_type = "complete"
                                            elif status_type == ProgressState.TRACK_COMPLETE:
                                                # Create a distinct event type for track completion to prevent UI issues
                                                event_type = "track_complete"
                                            elif status_type == ProgressState.ERROR:
                                                event_type = "error"
                                            elif status_type in [ProgressState.TRACK_PROGRESS, ProgressState.REAL_TIME]:
                                                event_type = "progress"
                                            
                                            # Send the update
                                            yield f"event: {event_type}\ndata: {json.dumps(status)}\n\n"
                                            last_sent_id = status_id
                                            break
                        except Exception as e:
                            logger.error(f"Error processing Redis Pub/Sub message: {e}")
                
                # Check if task is complete, error, or cancelled - if so, end the stream
                # Only do this check every 5 loops to reduce load
                if random.random() < 0.2:  # ~20% chance to check terminal status each loop
                    last_status = get_last_task_status(task_id)
                    if last_status and last_status.get("status") in [ProgressState.COMPLETE, ProgressState.ERROR, ProgressState.CANCELLED, ProgressState.DONE]:
                        # Send final message
                        final_data = {
                            "event": "end",
                            "task_id": task_id,
                            "status": last_status.get("status"),
                            "message": last_status.get("message", "Download complete"),
                            "timestamp": time.time()
                        }
                        yield f"event: end\ndata: {json.dumps(final_data)}\n\n"
                        break
                
                # Send a heartbeat periodically to keep the connection alive
                now = time.time()
                if now - last_heartbeat >= heartbeat_interval:
                    yield f"event: heartbeat\ndata: {json.dumps({'timestamp': now})}\n\n"
                    last_heartbeat = now
                
                # More efficient sleep between batch checks
                time.sleep(check_interval)
        
        except Exception as e:
            logger.error(f"Error in SSE stream: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Clean up: unsubscribe and close Redis Pub/Sub connection
            if 'redis_pubsub' in locals():
                try:
                    redis_pubsub.unsubscribe()
                    redis_pubsub.close()
                except Exception as e:
                    logger.error(f"Error closing Redis Pub/Sub: {e}")
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'  # Disable Nginx buffering
        }
    )
