from flask import Blueprint, jsonify, request
from routes.utils.history_manager import get_history_entries
import logging

logger = logging.getLogger(__name__)
history_bp = Blueprint("history", __name__, url_prefix="/api/history")


@history_bp.route("", methods=["GET"])
def get_download_history():
    """API endpoint to retrieve download history with pagination, sorting, and filtering."""
    try:
        limit = request.args.get("limit", 25, type=int)
        offset = request.args.get("offset", 0, type=int)
        sort_by = request.args.get("sort_by", "timestamp_completed")
        sort_order = request.args.get("sort_order", "DESC")

        # Create filters dictionary for various filter options
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
            
        # Track status filter
        track_status_filter = request.args.get("track_status")
        if track_status_filter:
            filters["track_status"] = track_status_filter
            
        # Show/hide child tracks
        hide_child_tracks = request.args.get("hide_child_tracks", "false").lower() == "true"
        if hide_child_tracks:
            filters["parent_task_id"] = None  # Only show parent entries or standalone tracks
            
        # Show only tracks with specific parent
        only_parent_tracks = request.args.get("only_parent_tracks", "false").lower() == "true"
        if only_parent_tracks and not parent_task_filter:
            filters["parent_task_id"] = "NOT_NULL"  # Special value to indicate we want only child tracks

        entries, total_count = get_history_entries(
            limit, offset, sort_by, sort_order, filters
        )

        return jsonify(
            {
                "entries": entries,
                "total_count": total_count,
                "limit": limit,
                "offset": offset,
            }
        )
    except Exception as e:
        logger.error(f"Error in /api/history endpoint: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve download history"}), 500


@history_bp.route("/tracks/<parent_task_id>", methods=["GET"])
def get_tracks_for_parent(parent_task_id):
    """API endpoint to retrieve all track entries for a specific parent task."""
    try:
        # We don't need pagination for this endpoint as we want all tracks for a parent
        filters = {"parent_task_id": parent_task_id}
        
        # Optional sorting
        sort_by = request.args.get("sort_by", "timestamp_completed")
        sort_order = request.args.get("sort_order", "DESC")
        
        entries, total_count = get_history_entries(
            limit=1000,  # High limit to get all tracks
            offset=0, 
            sort_by=sort_by, 
            sort_order=sort_order, 
            filters=filters
        )

        return jsonify(
            {
                "parent_task_id": parent_task_id,
                "tracks": entries,
                "total_count": total_count,
            }
        )
    except Exception as e:
        logger.error(f"Error in /api/history/tracks endpoint: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve tracks for parent task {parent_task_id}"}), 500
