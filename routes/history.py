from flask import Blueprint, Response, request, jsonify
import json
import traceback
import logging
from routes.utils.history_manager import history_manager

logger = logging.getLogger(__name__)

history_bp = Blueprint("history", __name__)


@history_bp.route("/", methods=["GET"])
def get_history():
    """
    Retrieve download history with optional filtering and pagination.
    
    Query parameters:
    - limit: Maximum number of records (default: 100, max: 500)
    - offset: Number of records to skip (default: 0)
    - download_type: Filter by type ('track', 'album', 'playlist')
    - status: Filter by status ('completed', 'failed', 'skipped', 'in_progress')
    """
    try:
        # Parse query parameters
        limit = min(int(request.args.get("limit", 100)), 500)  # Cap at 500
        offset = max(int(request.args.get("offset", 0)), 0)
        download_type = request.args.get("download_type")
        status = request.args.get("status")
        
        # Validate download_type if provided
        valid_types = ["track", "album", "playlist"]
        if download_type and download_type not in valid_types:
            return Response(
                json.dumps({"error": f"Invalid download_type. Must be one of: {valid_types}"}),
                status=400,
                mimetype="application/json",
            )
        
        # Validate status if provided
        valid_statuses = ["completed", "failed", "skipped", "in_progress"]
        if status and status not in valid_statuses:
            return Response(
                json.dumps({"error": f"Invalid status. Must be one of: {valid_statuses}"}),
                status=400,
                mimetype="application/json",
            )
        
        # Get history from manager
        history = history_manager.get_download_history(
            limit=limit,
            offset=offset,
            download_type=download_type,
            status=status
        )
        
        # Add pagination info
        response_data = {
            "downloads": history,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned_count": len(history)
            }
        }
        
        if download_type:
            response_data["filters"] = {"download_type": download_type}
        if status:
            if "filters" not in response_data:
                response_data["filters"] = {}
            response_data["filters"]["status"] = status
        
        return Response(
            json.dumps(response_data), 
            status=200, 
            mimetype="application/json"
        )
        
    except ValueError as e:
        return Response(
            json.dumps({"error": f"Invalid parameter value: {str(e)}"}),
            status=400,
            mimetype="application/json",
        )
    except Exception as e:
        logger.error(f"Error retrieving download history: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to retrieve download history", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/<task_id>", methods=["GET"])
def get_download_by_task_id(task_id):
    """
    Retrieve specific download history by task ID.
    
    Args:
        task_id: Celery task ID
    """
    try:
        download = history_manager.get_download_by_task_id(task_id)
        
        if not download:
            return Response(
                json.dumps({"error": f"Download with task ID '{task_id}' not found"}),
                status=404,
                mimetype="application/json",
            )
        
        return Response(
            json.dumps(download), 
            status=200, 
            mimetype="application/json"
        )
        
    except Exception as e:
        logger.error(f"Error retrieving download for task {task_id}: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to retrieve download", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/<task_id>/children", methods=["GET"])
def get_download_children(task_id):
    """
    Retrieve children tracks for an album or playlist download.
    
    Args:
        task_id: Celery task ID
    """
    try:
        # First get the main download to find the children table
        download = history_manager.get_download_by_task_id(task_id)
        
        if not download:
            return Response(
                json.dumps({"error": f"Download with task ID '{task_id}' not found"}),
                status=404,
                mimetype="application/json",
            )
        
        children_table = download.get("children_table")
        if not children_table:
            return Response(
                json.dumps({"error": f"Download '{task_id}' has no children tracks"}),
                status=404,
                mimetype="application/json",
            )
        
        # Get children tracks
        children = history_manager.get_children_history(children_table)
        
        response_data = {
            "task_id": task_id,
            "download_type": download.get("download_type"),
            "title": download.get("title"),
            "children_table": children_table,
            "tracks": children,
            "track_count": len(children)
        }
        
        return Response(
            json.dumps(response_data), 
            status=200, 
            mimetype="application/json"
        )
        
    except Exception as e:
        logger.error(f"Error retrieving children for task {task_id}: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to retrieve download children", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/stats", methods=["GET"])
def get_download_stats():
    """
    Get download statistics and summary information.
    """
    try:
        stats = history_manager.get_download_stats()
        
        return Response(
            json.dumps(stats), 
            status=200, 
            mimetype="application/json"
        )
        
    except Exception as e:
        logger.error(f"Error retrieving download stats: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to retrieve download statistics", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/search", methods=["GET"])
def search_history():
    """
    Search download history by title or artist.
    
    Query parameters:
    - q: Search query (required)
    - limit: Maximum number of results (default: 50, max: 200)
    """
    try:
        query = request.args.get("q")
        if not query:
            return Response(
                json.dumps({"error": "Missing required parameter: q (search query)"}),
                status=400,
                mimetype="application/json",
            )
        
        limit = min(int(request.args.get("limit", 50)), 200)  # Cap at 200
        
        # Search history
        results = history_manager.search_history(query, limit)
        
        response_data = {
            "query": query,
            "results": results,
            "result_count": len(results),
            "limit": limit
        }
        
        return Response(
            json.dumps(response_data), 
            status=200, 
            mimetype="application/json"
        )
        
    except ValueError as e:
        return Response(
            json.dumps({"error": f"Invalid parameter value: {str(e)}"}),
            status=400,
            mimetype="application/json",
        )
    except Exception as e:
        logger.error(f"Error searching download history: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to search download history", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/recent", methods=["GET"])
def get_recent_downloads():
    """
    Get most recent downloads.
    
    Query parameters:
    - limit: Maximum number of results (default: 20, max: 100)
    """
    try:
        limit = min(int(request.args.get("limit", 20)), 100)  # Cap at 100
        
        recent = history_manager.get_recent_downloads(limit)
        
        response_data = {
            "downloads": recent,
            "count": len(recent),
            "limit": limit
        }
        
        return Response(
            json.dumps(response_data), 
            status=200, 
            mimetype="application/json"
        )
        
    except ValueError as e:
        return Response(
            json.dumps({"error": f"Invalid parameter value: {str(e)}"}),
            status=400,
            mimetype="application/json",
        )
    except Exception as e:
        logger.error(f"Error retrieving recent downloads: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to retrieve recent downloads", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/failed", methods=["GET"])
def get_failed_downloads():
    """
    Get failed downloads.
    
    Query parameters:
    - limit: Maximum number of results (default: 50, max: 200)
    """
    try:
        limit = min(int(request.args.get("limit", 50)), 200)  # Cap at 200
        
        failed = history_manager.get_failed_downloads(limit)
        
        response_data = {
            "downloads": failed,
            "count": len(failed),
            "limit": limit
        }
        
        return Response(
            json.dumps(response_data), 
            status=200, 
            mimetype="application/json"
        )
        
    except ValueError as e:
        return Response(
            json.dumps({"error": f"Invalid parameter value: {str(e)}"}),
            status=400,
            mimetype="application/json",
        )
    except Exception as e:
        logger.error(f"Error retrieving failed downloads: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to retrieve failed downloads", "details": str(e)}),
            status=500,
            mimetype="application/json",
        )


@history_bp.route("/cleanup", methods=["POST"])
def cleanup_old_history():
    """
    Clean up old download history.
    
    JSON body:
    - days_old: Number of days old to keep (default: 30)
    """
    try:
        data = request.get_json() or {}
        days_old = data.get("days_old", 30)
        
        if not isinstance(days_old, int) or days_old <= 0:
            return Response(
                json.dumps({"error": "days_old must be a positive integer"}),
                status=400,
                mimetype="application/json",
            )
        
        deleted_count = history_manager.clear_old_history(days_old)
        
        response_data = {
            "message": f"Successfully cleaned up old download history",
            "deleted_records": deleted_count,
            "days_old": days_old
        }
        
        return Response(
            json.dumps(response_data), 
            status=200, 
            mimetype="application/json"
        )
        
    except Exception as e:
        logger.error(f"Error cleaning up old history: {e}", exc_info=True)
        return Response(
            json.dumps({"error": "Failed to cleanup old history", "details": str(e)}),
            status=500,
            mimetype="application/json",
        ) 