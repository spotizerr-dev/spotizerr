from flask import Blueprint, jsonify, request
from routes.utils.history_manager import (
    get_task_history, 
    get_child_tracks, 
    get_status_history,
    get_track_mini_history,
    add_track_status_update,
    # Legacy compatibility
    get_history_entries
)
import logging

logger = logging.getLogger(__name__)
history_bp = Blueprint("history", __name__, url_prefix="/api/history")

"""
Enhanced History API Endpoints:

Main History Endpoints:
- GET /api/history - Get paginated download history with filtering
- GET /api/history/task/<task_id> - Get detailed task information
- GET /api/history/summary - Get summary statistics

Track Management Endpoints:
- GET /api/history/tracks/<parent_task_id> - Get all tracks for a parent task
  ?include_mini_histories=true - Include comprehensive mini-histories for each track
- GET /api/history/tracks/<parent_task_id>/mini-histories - Get mini-histories for all tracks

Individual Track Endpoints:
- GET /api/history/track/<parent_task_id>/<track_id>/mini-history - Get comprehensive mini-history for a specific track
- GET /api/history/track/<parent_task_id>/<track_id>/timeline - Get simplified timeline view
- POST /api/history/track/<parent_task_id>/<track_id>/status - Update track status (admin/testing)

Status & Legacy:
- GET /api/history/status/<task_id> - Get complete status history for a task
- GET /api/history/legacy - Legacy endpoint for backward compatibility

Mini-History Features:
- Complete status progression timeline with timestamps
- Progress tracking and retry information
- File size, quality, and download path details
- Error information and duration statistics
- Human-readable timestamps and calculated metrics
"""


@history_bp.route("", methods=["GET"])
def get_download_history():
    """API endpoint to retrieve download history with pagination, sorting, and filtering."""
    try:
        limit = request.args.get("limit", 25, type=int)
        offset = request.args.get("offset", 0, type=int)
        sort_by = request.args.get("sort_by", "timestamp_updated")
        sort_order = request.args.get("sort_order", "DESC")
        include_children = request.args.get("include_children", "false").lower() == "true"

        # Create filters dictionary for various filter options
        filters = {}
        
        # Status filter - support both old and new field names
        status_filter = request.args.get("status_final")
        if status_filter:
            filters["status_final"] = status_filter

        # Task type filter (renamed from download_type)
        type_filter = request.args.get("task_type") or request.args.get("download_type")
        if type_filter:
            filters["task_type"] = type_filter
            
        # Parent task filter
        parent_task_filter = request.args.get("parent_task_id")
        if parent_task_filter:
            filters["parent_task_id"] = parent_task_filter
            
        # Show/hide child tracks (tasks with parent_task_id)
        hide_child_tracks = request.args.get("hide_child_tracks", "false").lower() == "true"
        if hide_child_tracks:
            filters["parent_task_id"] = None  # Only show parent entries or standalone tracks
            
        # Show only child tracks
        only_child_tracks = request.args.get("only_child_tracks", "false").lower() == "true"
        if only_child_tracks and not parent_task_filter:
            # This would require a NOT NULL filter, but we'll handle it differently
            # by excluding tasks that don't have a parent_task_id
            pass  # We'll implement this in the query logic

        # Additional filters
        current_status_filter = request.args.get("status_current")
        if current_status_filter:
            filters["status_current"] = current_status_filter

        tasks, total_count = get_task_history(
            limit=limit, 
            offset=offset, 
            sort_by=sort_by, 
            sort_order=sort_order, 
            filters=filters,
            include_children=include_children
        )

        # Transform data for backward compatibility and add computed fields
        entries = []
        for task in tasks:
            entry = {
                # Core fields
                "task_id": task["task_id"],
                "task_type": task["task_type"],
                "title": task["title"],
                "status_current": task["status_current"],
                "status_final": task["status_final"],
                "timestamp_created": task["timestamp_created"],
                "timestamp_updated": task["timestamp_updated"],
                "timestamp_completed": task["timestamp_completed"],
                "parent_task_id": task["parent_task_id"],
                "position": task["position"],
                
                # Legacy compatibility fields
                "download_type": task["task_type"],
                "item_name": task["title"],
                "timestamp_added": task["timestamp_created"],
                
                # Rich data fields (parsed JSON)
                "artists": task.get("artists", []),
                "ids": task.get("ids", {}),
                "metadata": task.get("metadata", {}),
                "config": task.get("config", {}),
                "error_info": task.get("error_info", {}),
                "progress": task.get("progress", {}),
                "summary": task.get("summary", {}),
                
                # Child information
                "children_table": task["children_table"],
                "has_children": bool(task["children_table"]),
                "child_tracks": task.get("child_tracks", []) if include_children else []
            }
            
            # Extract commonly used fields for easier access
            if entry["artists"]:
                entry["artist_names"] = [artist.get("name", "") for artist in entry["artists"]]
                entry["item_artist"] = ", ".join(entry["artist_names"])  # Legacy compatibility
            
            if entry["config"]:
                entry["service_used"] = entry["config"].get("service_used")
                entry["quality_profile"] = entry["config"].get("quality_profile")
                entry["convert_to"] = entry["config"].get("convert_to")
                entry["bitrate"] = entry["config"].get("bitrate")
            
            if entry["error_info"]:
                entry["error_message"] = entry["error_info"].get("message")  # Legacy compatibility
            
            # Extract album info from metadata if available
            if entry["metadata"] and "album" in entry["metadata"]:
                entry["item_album"] = entry["metadata"]["album"].get("title")
            
            # Child track summary
            if entry["child_tracks"]:
                entry["child_track_count"] = len(entry["child_tracks"])
                entry["child_track_summary"] = {
                    "completed": len([t for t in entry["child_tracks"] if t.get("status_final") == "COMPLETED"]),
                    "error": len([t for t in entry["child_tracks"] if t.get("status_final") == "ERROR"]),
                    "skipped": len([t for t in entry["child_tracks"] if t.get("status_final") == "SKIPPED"])
                }
            
            entries.append(entry)

        return jsonify({
            "entries": entries,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "include_children": include_children
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history endpoint: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve download history"}), 500


@history_bp.route("/task/<task_id>", methods=["GET"])
def get_task_details(task_id):
    """API endpoint to retrieve detailed information about a specific task."""
    try:
        include_children = request.args.get("include_children", "true").lower() == "true"
        include_status_history = request.args.get("include_status_history", "false").lower() == "true"
        
        # Get the task
        tasks, _ = get_task_history(
            limit=1, 
            offset=0, 
            filters={"task_id": task_id},
            include_children=include_children
        )
        
        if not tasks:
            return jsonify({"error": f"Task {task_id} not found"}), 404
        
        task = tasks[0]
        
        # Add status history if requested
        if include_status_history:
            task["status_history"] = get_status_history(task_id)
        
        return jsonify({
            "task": task,
            "include_children": include_children,
            "include_status_history": include_status_history
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/task/{task_id} endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve task {task_id}"}), 500


@history_bp.route("/tracks/<parent_task_id>", methods=["GET"])
def get_tracks_for_parent(parent_task_id):
    """API endpoint to retrieve all track entries for a specific parent task."""
    try:
        # First, verify the parent task exists and get its children table
        parent_tasks, _ = get_task_history(
            limit=1, 
            offset=0, 
            filters={"task_id": parent_task_id}
        )
        
        if not parent_tasks:
            return jsonify({"error": f"Parent task {parent_task_id} not found"}), 404
        
        parent_task = parent_tasks[0]
        children_table = parent_task.get("children_table")
        
        if not children_table:
            return jsonify({
                "parent_task_id": parent_task_id,
                "tracks": [],
                "total_count": 0,
                "message": "No child tracks found for this task"
            })
        
        # Get tracks from the child table
        tracks = get_child_tracks(children_table)
        
        # Check if mini-histories should be included
        include_mini_histories = request.args.get("include_mini_histories", "false").lower() == "true"
        
        # Sort tracks if requested
        sort_by = request.args.get("sort_by", "position")
        sort_order = request.args.get("sort_order", "ASC")
        
        if sort_by == "position":
            tracks.sort(key=lambda x: x.get("position", 0), reverse=(sort_order.upper() == "DESC"))
        elif sort_by == "timestamp_completed":
            tracks.sort(key=lambda x: x.get("timestamp_completed", 0) or 0, reverse=(sort_order.upper() == "DESC"))
        
        # Transform tracks for easier consumption
        transformed_tracks = []
        for track in tracks:
            track_info = {
                "track_id": track["track_id"],
                "parent_task_id": track["parent_task_id"],
                "position": track["position"],
                "status_current": track["status_current"],
                "status_final": track["status_final"],
                "timestamp_created": track["timestamp_created"],
                "timestamp_completed": track["timestamp_completed"],
                "error_info": track.get("error_info"),
                "config": track.get("config"),
            }
            
            # Parse track data
            if track["track_data"]:
                track_data = track["track_data"]
                track_info.update({
                    "title": track_data.get("title"),
                    "artists": track_data.get("artists", []),
                    "album": track_data.get("album", {}),
                    "duration_ms": track_data.get("duration_ms"),
                    "track_number": track_data.get("track_number"),
                    "disc_number": track_data.get("disc_number"),
                    "explicit": track_data.get("explicit"),
                    "ids": track_data.get("ids", {})
                })
                
                # Extract artist names for easier display
                if track_info["artists"]:
                    track_info["artist_names"] = [artist.get("name", "") for artist in track_info["artists"]]
            
            # Include mini-history if requested
            if include_mini_histories:
                mini_history = get_track_mini_history(track["track_id"], children_table)
                if mini_history:
                    track_info["mini_history"] = mini_history
                    # Add quick access to timeline and key metrics
                    track_info["timeline"] = mini_history.get("timeline", [])
                    track_info["retry_count"] = mini_history.get("retry_count", 0)
                    track_info["time_elapsed"] = mini_history.get("time_elapsed")
                    track_info["quality_achieved"] = mini_history.get("quality_achieved")
                    track_info["file_size"] = mini_history.get("file_size")
                    track_info["download_path"] = mini_history.get("download_path")
            
            transformed_tracks.append(track_info)

        return jsonify({
            "parent_task_id": parent_task_id,
            "parent_task_info": {
                "title": parent_task["title"],
                "task_type": parent_task["task_type"],
                "status_final": parent_task["status_final"]
            },
            "tracks": transformed_tracks,
            "total_count": len(transformed_tracks),
            "include_mini_histories": include_mini_histories
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/tracks/{parent_task_id} endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve tracks for parent task {parent_task_id}"}), 500


@history_bp.route("/status/<task_id>", methods=["GET"])
def get_task_status_history(task_id):
    """API endpoint to retrieve the complete status history for a task."""
    try:
        status_history = get_status_history(task_id)
        
        if not status_history:
            return jsonify({
                "task_id": task_id,
                "status_history": [],
                "message": "No status history found for this task"
            })
        
        return jsonify({
            "task_id": task_id,
            "status_history": status_history,
            "total_updates": len(status_history)
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/status/{task_id} endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve status history for task {task_id}"}), 500


@history_bp.route("/summary", methods=["GET"])
def get_history_summary():
    """API endpoint to retrieve summary statistics about download history."""
    try:
        # Get overall statistics
        all_tasks, total_tasks = get_task_history(limit=10000, offset=0)  # Get a large number to count
        
        # Calculate statistics
        stats = {
            "total_tasks": total_tasks,
            "by_type": {},
            "by_status": {},
            "recent_activity": {
                "last_24h": 0,
                "last_7d": 0,
                "last_30d": 0
            }
        }
        
        import time
        current_time = time.time()
        day_seconds = 24 * 60 * 60
        
        for task in all_tasks:
            # Count by type
            task_type = task.get("task_type", "unknown")
            stats["by_type"][task_type] = stats["by_type"].get(task_type, 0) + 1
            
            # Count by status
            status = task.get("status_final", "unknown")
            stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
            
            # Count recent activity
            if task.get("timestamp_created"):
                time_diff = current_time - task["timestamp_created"]
                if time_diff <= day_seconds:
                    stats["recent_activity"]["last_24h"] += 1
                if time_diff <= 7 * day_seconds:
                    stats["recent_activity"]["last_7d"] += 1
                if time_diff <= 30 * day_seconds:
                    stats["recent_activity"]["last_30d"] += 1
        
        return jsonify(stats)
        
    except Exception as e:
        logger.error(f"Error in /api/history/summary endpoint: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve history summary"}), 500


@history_bp.route("/track/<parent_task_id>/<track_id>/mini-history", methods=["GET"])
def get_track_mini_history_api(parent_task_id, track_id):
    """API endpoint to retrieve comprehensive mini-history for a specific track."""
    try:
        # First, verify the parent task exists and get its children table
        parent_tasks, _ = get_task_history(
            limit=1, 
            offset=0, 
            filters={"task_id": parent_task_id}
        )
        
        if not parent_tasks:
            return jsonify({"error": f"Parent task {parent_task_id} not found"}), 404
        
        parent_task = parent_tasks[0]
        children_table = parent_task.get("children_table")
        
        if not children_table:
            return jsonify({"error": f"No child tracks found for parent task {parent_task_id}"}), 404
        
        # Get the track mini-history
        mini_history = get_track_mini_history(track_id, children_table)
        
        if not mini_history:
            return jsonify({"error": f"Track {track_id} not found in parent task {parent_task_id}"}), 404
        
        return jsonify({
            "parent_task_id": parent_task_id,
            "parent_task_info": {
                "title": parent_task["title"],
                "task_type": parent_task["task_type"]
            },
            "track_mini_history": mini_history
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/track/{parent_task_id}/{track_id}/mini-history endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve mini-history for track {track_id}"}), 500


@history_bp.route("/tracks/<parent_task_id>/mini-histories", methods=["GET"])
def get_all_track_mini_histories(parent_task_id):
    """API endpoint to retrieve mini-histories for all tracks in a parent task."""
    try:
        # Verify the parent task exists and get its children table
        parent_tasks, _ = get_task_history(
            limit=1, 
            offset=0, 
            filters={"task_id": parent_task_id}
        )
        
        if not parent_tasks:
            return jsonify({"error": f"Parent task {parent_task_id} not found"}), 404
        
        parent_task = parent_tasks[0]
        children_table = parent_task.get("children_table")
        
        if not children_table:
            return jsonify({
                "parent_task_id": parent_task_id,
                "track_mini_histories": [],
                "total_count": 0,
                "message": "No child tracks found for this task"
            })
        
        # Get all child tracks
        tracks = get_child_tracks(children_table)
        
        # Get mini-history for each track
        track_mini_histories = []
        for track in tracks:
            mini_history = get_track_mini_history(track["track_id"], children_table)
            if mini_history:
                track_mini_histories.append(mini_history)
        
        # Sort by position or track number
        track_mini_histories.sort(key=lambda x: (
            x.get("disc_number", 1), 
            x.get("track_number", 0), 
            x.get("position", 0)
        ))
        
        return jsonify({
            "parent_task_id": parent_task_id,
            "parent_task_info": {
                "title": parent_task["title"],
                "task_type": parent_task["task_type"],
                "status_final": parent_task["status_final"]
            },
            "track_mini_histories": track_mini_histories,
            "total_count": len(track_mini_histories)
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/tracks/{parent_task_id}/mini-histories endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve mini-histories for parent task {parent_task_id}"}), 500


@history_bp.route("/track/<parent_task_id>/<track_id>/status", methods=["POST"])
def update_track_status(parent_task_id, track_id):
    """API endpoint to update the status of a specific track (for testing/admin purposes)."""
    try:
        # Verify the parent task exists and get its children table
        parent_tasks, _ = get_task_history(
            limit=1, 
            offset=0, 
            filters={"task_id": parent_task_id}
        )
        
        if not parent_tasks:
            return jsonify({"error": f"Parent task {parent_task_id} not found"}), 404
        
        parent_task = parent_tasks[0]
        children_table = parent_task.get("children_table")
        
        if not children_table:
            return jsonify({"error": f"No child tracks found for parent task {parent_task_id}"}), 404
        
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body must contain JSON data"}), 400
        
        status_type = data.get("status_type")
        if not status_type:
            return jsonify({"error": "status_type is required"}), 400
        
        status_data = data.get("status_data", {})
        progress_info = data.get("progress_info")
        error_info = data.get("error_info")
        
        # Update the track status
        add_track_status_update(
            track_id=track_id,
            table_name=children_table,
            status_type=status_type,
            status_data=status_data,
            progress_info=progress_info,
            error_info=error_info
        )
        
        # Get updated mini-history
        updated_mini_history = get_track_mini_history(track_id, children_table)
        
        return jsonify({
            "message": f"Track {track_id} status updated to {status_type}",
            "parent_task_id": parent_task_id,
            "track_id": track_id,
            "updated_mini_history": updated_mini_history
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/track/{parent_task_id}/{track_id}/status endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to update status for track {track_id}"}), 500


@history_bp.route("/track/<parent_task_id>/<track_id>/timeline", methods=["GET"])
def get_track_timeline(parent_task_id, track_id):
    """API endpoint to get a simplified timeline view of a track's status progression."""
    try:
        # Verify the parent task exists and get its children table
        parent_tasks, _ = get_task_history(
            limit=1, 
            offset=0, 
            filters={"task_id": parent_task_id}
        )
        
        if not parent_tasks:
            return jsonify({"error": f"Parent task {parent_task_id} not found"}), 404
        
        parent_task = parent_tasks[0]
        children_table = parent_task.get("children_table")
        
        if not children_table:
            return jsonify({"error": f"No child tracks found for parent task {parent_task_id}"}), 404
        
        # Get the track mini-history
        mini_history = get_track_mini_history(track_id, children_table)
        
        if not mini_history:
            return jsonify({"error": f"Track {track_id} not found in parent task {parent_task_id}"}), 404
        
        # Extract timeline and add summary statistics
        timeline = mini_history.get("timeline", [])
        
        # Calculate timeline statistics
        timeline_stats = {
            "total_status_changes": len(timeline),
            "duration_seconds": mini_history.get("time_elapsed"),
            "calculated_duration": mini_history.get("calculated_duration"),
            "retry_count": mini_history.get("retry_count", 0),
            "final_status": mini_history.get("status_final"),
            "quality_achieved": mini_history.get("quality_achieved"),
            "file_size": mini_history.get("file_size"),
            "download_path": mini_history.get("download_path")
        }
        
        return jsonify({
            "parent_task_id": parent_task_id,
            "track_id": track_id,
            "track_info": {
                "title": mini_history.get("title"),
                "disc_number": mini_history.get("disc_number"),
                "track_number": mini_history.get("track_number"),
                "position": mini_history.get("position"),
                "duration_ms": mini_history.get("duration_ms")
            },
            "timeline": timeline,
            "timeline_stats": timeline_stats
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/track/{parent_task_id}/{track_id}/timeline endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve timeline for track {track_id}"}), 500


# Legacy endpoint for backward compatibility
@history_bp.route("/legacy", methods=["GET"])
def get_download_history_legacy():
    """Legacy API endpoint using the old history system (for backward compatibility)."""
    try:
        limit = request.args.get("limit", 25, type=int)
        offset = request.args.get("offset", 0, type=int)
        sort_by = request.args.get("sort_by", "timestamp_completed")
        sort_order = request.args.get("sort_order", "DESC")

        filters = {}
        
        # Status filter
        status_filter = request.args.get("status_final")
        if status_filter:
            filters["status_final"] = status_filter

        # Download type filter
        type_filter = request.args.get("download_type")
        if type_filter:
            filters["download_type"] = type_filter
            
        # Parent task filter
        parent_task_filter = request.args.get("parent_task_id")
        if parent_task_filter:
            filters["parent_task_id"] = parent_task_filter

        entries, total_count = get_history_entries(
            limit, offset, sort_by, sort_order, filters
        )

        return jsonify({
            "entries": entries,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "note": "This is the legacy endpoint. Consider migrating to /api/history"
        })
        
    except Exception as e:
        logger.error(f"Error in /api/history/legacy endpoint: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve download history"}), 500
