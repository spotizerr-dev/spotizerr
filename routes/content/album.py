from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
import json
import traceback
import uuid
import time
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.celery_tasks import store_task_info, store_task_status, ProgressState
from routes.utils.get_info import get_spotify_info
from routes.utils.errors import DuplicateDownloadError

# Import authentication dependencies
from routes.auth.middleware import require_auth_from_state, User

router = APIRouter()


def construct_spotify_url(item_id: str, item_type: str = "track") -> str:
    """Construct a Spotify URL for a given item ID and type."""
    return f"https://open.spotify.com/{item_type}/{item_id}"


@router.get("/download/{album_id}")
async def handle_download(album_id: str, request: Request, current_user: User = Depends(require_auth_from_state)):
    # Retrieve essential parameters from the request.
    # name = request.args.get('name')
    # artist = request.args.get('artist')

    # Construct the URL from album_id
    url = construct_spotify_url(album_id, "album")

    # Fetch metadata from Spotify
    try:
        album_info = get_spotify_info(album_id, "album")
        if (
            not album_info
            or not album_info.get("name")
            or not album_info.get("artists")
        ):
            return JSONResponse(
                content={"error": f"Could not retrieve metadata for album ID: {album_id}"},
                status_code=404
            )

        name_from_spotify = album_info.get("name")
        artist_from_spotify = (
            album_info["artists"][0].get("name")
            if album_info["artists"]
            else "Unknown Artist"
        )

    except Exception as e:
        return JSONResponse(
            content={"error": f"Failed to fetch metadata for album {album_id}: {str(e)}"},
            status_code=500
        )

    # Validate required parameters
    if not url:
        return JSONResponse(
            content={"error": "Missing required parameter: url"},
            status_code=400
        )

    # Add the task to the queue with only essential parameters
    # The queue manager will now handle all config parameters
    # Include full original request URL in metadata
    orig_params = dict(request.query_params)
    orig_params["original_url"] = str(request.url)
    try:
        task_id = download_queue_manager.add_task(
            {
                "download_type": "album",
                "url": url,
                "name": name_from_spotify,
                "artist": artist_from_spotify,
                "orig_request": orig_params,
            }
        )
    except DuplicateDownloadError as e:
        return JSONResponse(
            content={
                "error": "Duplicate download detected.",
                "existing_task": e.existing_task,
            },
            status_code=409
        )
    except Exception as e:
        # Generic error handling for other issues during task submission
        # Create an error task ID if add_task itself fails before returning an ID
        error_task_id = str(uuid.uuid4())

        store_task_info(
            error_task_id,
            {
                "download_type": "album",
                "url": url,
                "name": name_from_spotify,
                "artist": artist_from_spotify,
                "original_request": orig_params,
                "created_at": time.time(),
                "is_submission_error_task": True,
            },
        )
        store_task_status(
            error_task_id,
            {
                "status": ProgressState.ERROR,
                "error": f"Failed to queue album download: {str(e)}",
                "timestamp": time.time(),
            },
        )
        return JSONResponse(
            content={
                "error": f"Failed to queue album download: {str(e)}",
                "task_id": error_task_id,
            },
            status_code=500
        )

    return JSONResponse(
        content={"task_id": task_id}, 
        status_code=202
    )


@router.get("/download/cancel")
async def cancel_download(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Cancel a running download process by its task id.
    """
    task_id = request.query_params.get("task_id")
    if not task_id:
        return JSONResponse(
            content={"error": "Missing process id (task_id) parameter"},
            status_code=400
        )

    # Use the queue manager's cancellation method.
    result = download_queue_manager.cancel_task(task_id)
    status_code = 200 if result.get("status") == "cancelled" else 404

    return JSONResponse(content=result, status_code=status_code)


@router.get("/info")
async def get_album_info(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Retrieve Spotify album metadata given a Spotify album ID.
    Expects a query parameter 'id' that contains the Spotify album ID.
    """
    spotify_id = request.query_params.get("id")

    if not spotify_id:
        return JSONResponse(
            content={"error": "Missing parameter: id"},
            status_code=400
        )

    try:
        # Use the get_spotify_info function (already imported at top)
        album_info = get_spotify_info(spotify_id, "album")
        return JSONResponse(content=album_info, status_code=200)
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return JSONResponse(content=error_data, status_code=500)
