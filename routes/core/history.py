from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
import json
import traceback
import logging
from routes.utils.history_manager import history_manager

# Import authentication dependencies
from routes.auth.middleware import require_auth_from_state, User

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/")
async def get_history(request: Request, current_user: User = Depends(require_auth_from_state)):
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
        limit = min(int(request.query_params.get("limit", 100)), 500)  # Cap at 500
        offset = max(int(request.query_params.get("offset", 0)), 0)
        download_type = request.query_params.get("download_type")
        status = request.query_params.get("status")
        
        # Validate download_type if provided
        valid_types = ["track", "album", "playlist"]
        if download_type and download_type not in valid_types:
            return JSONResponse(
                content={"error": f"Invalid download_type. Must be one of: {valid_types}"},
                status_code=400
            )
        
        # Validate status if provided
        valid_statuses = ["completed", "failed", "skipped", "in_progress"]
        if status and status not in valid_statuses:
            return JSONResponse(
                content={"error": f"Invalid status. Must be one of: {valid_statuses}"},
                status_code=400
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
        
        return JSONResponse(
            content=response_data, 
            status_code=200
        )
        
    except ValueError as e:
        return JSONResponse(
            content={"error": f"Invalid parameter value: {str(e)}"},
            status_code=400
        )
    except Exception as e:
        logger.error(f"Error retrieving download history: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to retrieve download history", "details": str(e)},
            status_code=500
        )


@router.get("/{task_id}")
async def get_download_by_task_id(task_id: str, current_user: User = Depends(require_auth_from_state)):
    """
    Retrieve specific download history by task ID.
    
    Args:
        task_id: Celery task ID
    """
    try:
        download = history_manager.get_download_by_task_id(task_id)
        
        if not download:
            return JSONResponse(
                content={"error": f"Download with task ID '{task_id}' not found"},
                status_code=404
            )
        
        return JSONResponse(
            content=download, 
            status_code=200
        )
        
    except Exception as e:
        logger.error(f"Error retrieving download for task {task_id}: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to retrieve download", "details": str(e)},
            status_code=500
        )


@router.get("/{task_id}/children")
async def get_download_children(task_id: str, current_user: User = Depends(require_auth_from_state)):
    """
    Retrieve children tracks for an album or playlist download.
    
    Args:
        task_id: Celery task ID
    """
    try:
        # First get the main download to find the children table
        download = history_manager.get_download_by_task_id(task_id)
        
        if not download:
            return JSONResponse(
                content={"error": f"Download with task ID '{task_id}' not found"},
                status_code=404
            )
        
        children_table = download.get("children_table")
        if not children_table:
            return JSONResponse(
                content={"error": f"Download '{task_id}' has no children tracks"},
                status_code=404
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
        
        return JSONResponse(
            content=response_data, 
            status_code=200
        )
        
    except Exception as e:
        logger.error(f"Error retrieving children for task {task_id}: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to retrieve download children", "details": str(e)},
            status_code=500
        )


@router.get("/stats")
async def get_download_stats(current_user: User = Depends(require_auth_from_state)):
    """
    Get download statistics and summary information.
    """
    try:
        stats = history_manager.get_download_stats()
        
        return JSONResponse(
            content=stats, 
            status_code=200
        )
        
    except Exception as e:
        logger.error(f"Error retrieving download stats: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to retrieve download statistics", "details": str(e)},
            status_code=500
        )


@router.get("/search")
async def search_history(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Search download history by title or artist.
    
    Query parameters:
    - q: Search query (required)
    - limit: Maximum number of results (default: 50, max: 200)
    """
    try:
        query = request.query_params.get("q")
        if not query:
            return JSONResponse(
                content={"error": "Missing required parameter: q (search query)"},
                status_code=400
            )
        
        limit = min(int(request.query_params.get("limit", 50)), 200)  # Cap at 200
        
        # Search history
        results = history_manager.search_history(query, limit)
        
        response_data = {
            "query": query,
            "results": results,
            "result_count": len(results),
            "limit": limit
        }
        
        return JSONResponse(
            content=response_data, 
            status_code=200
        )
        
    except ValueError as e:
        return JSONResponse(
            content={"error": f"Invalid parameter value: {str(e)}"},
            status_code=400
        )
    except Exception as e:
        logger.error(f"Error searching download history: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to search download history", "details": str(e)},
            status_code=500
        )


@router.get("/recent")
async def get_recent_downloads(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Get most recent downloads.
    
    Query parameters:
    - limit: Maximum number of results (default: 20, max: 100)
    """
    try:
        limit = min(int(request.query_params.get("limit", 20)), 100)  # Cap at 100
        
        recent = history_manager.get_recent_downloads(limit)
        
        response_data = {
            "downloads": recent,
            "count": len(recent),
            "limit": limit
        }
        
        return JSONResponse(
            content=response_data, 
            status_code=200
        )
        
    except ValueError as e:
        return JSONResponse(
            content={"error": f"Invalid parameter value: {str(e)}"},
            status_code=400
        )
    except Exception as e:
        logger.error(f"Error retrieving recent downloads: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to retrieve recent downloads", "details": str(e)},
            status_code=500
        )


@router.get("/failed")
async def get_failed_downloads(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Get failed downloads.
    
    Query parameters:
    - limit: Maximum number of results (default: 50, max: 200)
    """
    try:
        limit = min(int(request.query_params.get("limit", 50)), 200)  # Cap at 200
        
        failed = history_manager.get_failed_downloads(limit)
        
        response_data = {
            "downloads": failed,
            "count": len(failed),
            "limit": limit
        }
        
        return JSONResponse(
            content=response_data, 
            status_code=200
        )
        
    except ValueError as e:
        return JSONResponse(
            content={"error": f"Invalid parameter value: {str(e)}"},
            status_code=400
        )
    except Exception as e:
        logger.error(f"Error retrieving failed downloads: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to retrieve failed downloads", "details": str(e)},
            status_code=500
        )


@router.post("/cleanup")
async def cleanup_old_history(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Clean up old download history.
    
    JSON body:
    - days_old: Number of days old to keep (default: 30)
    """
    try:
        data = await request.json() if request.headers.get("content-type") == "application/json" else {}
        days_old = data.get("days_old", 30)
        
        if not isinstance(days_old, int) or days_old <= 0:
            return JSONResponse(
                content={"error": "days_old must be a positive integer"},
                status_code=400
            )
        
        deleted_count = history_manager.clear_old_history(days_old)
        
        response_data = {
            "message": f"Successfully cleaned up old download history",
            "deleted_records": deleted_count,
            "days_old": days_old
        }
        
        return JSONResponse(
            content=response_data, 
            status_code=200
        )
        
    except Exception as e:
        logger.error(f"Error cleaning up old history: {e}", exc_info=True)
        return JSONResponse(
            content={"error": "Failed to cleanup old history", "details": str(e)},
            status_code=500
        ) 