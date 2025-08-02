from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import json
import traceback
import logging  # Added logging import
import uuid  # For generating error task IDs
import time  # For timestamps
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.celery_tasks import (
    store_task_info,
    store_task_status,
    ProgressState,
)  # For error task creation
import threading  # For playlist watch trigger

# Imports from playlist_watch.py
from routes.utils.watch.db import (
    add_playlist_to_watch as add_playlist_db,
    remove_playlist_from_watch as remove_playlist_db,
    get_watched_playlist,
    get_watched_playlists,
    add_specific_tracks_to_playlist_table,
    remove_specific_tracks_from_playlist_table,
    is_track_in_playlist_db,  # Added import
)
from routes.utils.get_info import get_spotify_info  # Already used, but ensure it's here
from routes.utils.watch.manager import (
    check_watched_playlists,
    get_watch_config,
)  # For manual trigger & config
from routes.utils.errors import DuplicateDownloadError

logger = logging.getLogger(__name__)  # Added logger initialization
router = APIRouter()


def construct_spotify_url(item_id: str, item_type: str = "track") -> str:
    """Construct a Spotify URL for a given item ID and type."""
    return f"https://open.spotify.com/{item_type}/{item_id}"


@router.get("/download/{playlist_id}")
async def handle_download(playlist_id: str, request: Request):
    # Retrieve essential parameters from the request.
    # name = request.args.get('name') # Removed
    # artist = request.args.get('artist') # Removed
    orig_params = dict(request.query_params)

    # Construct the URL from playlist_id
    url = construct_spotify_url(playlist_id, "playlist")
    orig_params["original_url"] = str(request.url)  # Update original_url to the constructed one

    # Fetch metadata from Spotify using optimized function
    try:
        from routes.utils.get_info import get_playlist_metadata
        playlist_info = get_playlist_metadata(playlist_id)
        if (
            not playlist_info
            or not playlist_info.get("name")
            or not playlist_info.get("owner")
        ):
            return JSONResponse(
                content={
                    "error": f"Could not retrieve metadata for playlist ID: {playlist_id}"
                },
                status_code=404
            )

        name_from_spotify = playlist_info.get("name")
        # Use owner's display_name as the 'artist' for playlists
        owner_info = playlist_info.get("owner", {})
        artist_from_spotify = owner_info.get("display_name", "Unknown Owner")

    except Exception as e:
        return JSONResponse(
            content={
                "error": f"Failed to fetch metadata for playlist {playlist_id}: {str(e)}"
            },
            status_code=500
        )

    # Validate required parameters
    if not url:  # This check might be redundant now but kept for safety
        return JSONResponse(
            content={"error": "Missing required parameter: url"},
            status_code=400
        )

    try:
        task_id = download_queue_manager.add_task(
            {
                "download_type": "playlist",
                "url": url,
                "name": name_from_spotify,  # Use fetched name
                "artist": artist_from_spotify,  # Use fetched owner name as artist
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
        error_task_id = str(uuid.uuid4())
        store_task_info(
            error_task_id,
            {
                "download_type": "playlist",
                "url": url,
                "name": name_from_spotify,  # Use fetched name
                "artist": artist_from_spotify,  # Use fetched owner name as artist
                "original_request": orig_params,
                "created_at": time.time(),
                "is_submission_error_task": True,
            },
        )
        store_task_status(
            error_task_id,
            {
                "status": ProgressState.ERROR,
                "error": f"Failed to queue playlist download: {str(e)}",
                "timestamp": time.time(),
            },
        )
        return JSONResponse(
            content={
                "error": f"Failed to queue playlist download: {str(e)}",
                "task_id": error_task_id,
            },
            status_code=500
        )

    return JSONResponse(
        content={"task_id": task_id},
        status_code=202
    )


@router.get("/download/cancel")
async def cancel_download(request: Request):
    """
    Cancel a running playlist download process by its task id.
    """
    task_id = request.query_params.get("task_id")
    if not task_id:
        return JSONResponse(
            content={"error": "Missing task id (task_id) parameter"},
            status_code=400
        )

    # Use the queue manager's cancellation method.
    result = download_queue_manager.cancel_task(task_id)
    status_code = 200 if result.get("status") == "cancelled" else 404

    return JSONResponse(content=result, status_code=status_code)


@router.get("/info")
async def get_playlist_info(request: Request):
    """
    Retrieve Spotify playlist metadata given a Spotify playlist ID.
    Expects a query parameter 'id' that contains the Spotify playlist ID.
    """
    spotify_id = request.query_params.get("id")
    include_tracks = request.query_params.get("include_tracks", "false").lower() == "true"

    if not spotify_id:
        return JSONResponse(
            content={"error": "Missing parameter: id"},
            status_code=400
        )

    try:
        # Use the optimized playlist info function
        from routes.utils.get_info import get_playlist_info_optimized
        playlist_info = get_playlist_info_optimized(spotify_id, include_tracks=include_tracks)

        # If playlist_info is successfully fetched, check if it's watched
        # and augment track items with is_locally_known status
        if playlist_info and playlist_info.get("id"):
            watched_playlist_details = get_watched_playlist(playlist_info["id"])
            if watched_playlist_details:  # Playlist is being watched
                if playlist_info.get("tracks") and playlist_info["tracks"].get("items"):
                    for item in playlist_info["tracks"]["items"]:
                        if item and item.get("track") and item["track"].get("id"):
                            track_id = item["track"]["id"]
                            item["track"]["is_locally_known"] = is_track_in_playlist_db(
                                playlist_info["id"], track_id
                            )
                        elif item and item.get(
                            "track"
                        ):  # Track object exists but no ID
                            item["track"]["is_locally_known"] = False
            # If not watched, or no tracks, is_locally_known will not be added, or tracks won't exist to add it to.
            # Frontend should handle absence of this key as false.

        return JSONResponse(
            content=playlist_info, status_code=200
        )
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return JSONResponse(content=error_data, status_code=500)


@router.get("/metadata")
async def get_playlist_metadata(request: Request):
    """
    Retrieve only Spotify playlist metadata (no tracks) to avoid rate limiting.
    Expects a query parameter 'id' that contains the Spotify playlist ID.
    """
    spotify_id = request.query_params.get("id")

    if not spotify_id:
        return JSONResponse(
            content={"error": "Missing parameter: id"},
            status_code=400
        )

    try:
        # Use the optimized playlist metadata function
        from routes.utils.get_info import get_playlist_metadata
        playlist_metadata = get_playlist_metadata(spotify_id)

        return JSONResponse(
            content=playlist_metadata, status_code=200
        )
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return JSONResponse(content=error_data, status_code=500)


@router.get("/tracks")
async def get_playlist_tracks(request: Request):
    """
    Retrieve playlist tracks with pagination support for progressive loading.
    Expects query parameters: 'id' (playlist ID), 'limit' (optional), 'offset' (optional).
    """
    spotify_id = request.query_params.get("id")
    limit = int(request.query_params.get("limit", 50))
    offset = int(request.query_params.get("offset", 0))

    if not spotify_id:
        return JSONResponse(
            content={"error": "Missing parameter: id"},
            status_code=400
        )

    try:
        # Use the optimized playlist tracks function
        from routes.utils.get_info import get_playlist_tracks
        tracks_data = get_playlist_tracks(spotify_id, limit=limit, offset=offset)

        return JSONResponse(
            content=tracks_data, status_code=200
        )
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return JSONResponse(content=error_data, status_code=500)


@router.put("/watch/{playlist_spotify_id}")
async def add_to_watchlist(playlist_spotify_id: str):
    """Adds a playlist to the watchlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        raise HTTPException(status_code=403, detail={"error": "Watch feature is currently disabled globally."})

    logger.info(f"Attempting to add playlist {playlist_spotify_id} to watchlist.")
    try:
        # Check if already watched
        if get_watched_playlist(playlist_spotify_id):
            return {"message": f"Playlist {playlist_spotify_id} is already being watched."}

        # Fetch playlist details from Spotify to populate our DB
        from routes.utils.get_info import get_playlist_metadata
        playlist_data = get_playlist_metadata(playlist_spotify_id)
        if not playlist_data or "id" not in playlist_data:
            logger.error(
                f"Could not fetch details for playlist {playlist_spotify_id} from Spotify."
            )
            raise HTTPException(
                status_code=404,
                detail={
                    "error": f"Could not fetch details for playlist {playlist_spotify_id} from Spotify."
                }
            )

        add_playlist_db(playlist_data)  # This also creates the tracks table

        # REMOVED: Do not add initial tracks directly to DB.
        # The playlist watch manager will pick them up as new and queue downloads.
        # Tracks will be added to DB only after successful download via Celery task callback.
        # initial_track_items = playlist_data.get('tracks', {}).get('items', [])
        # if initial_track_items:
        #     from routes.utils.watch.db import add_tracks_to_playlist_db # Keep local import for clarity
        #     add_tracks_to_playlist_db(playlist_spotify_id, initial_track_items)

        logger.info(
            f"Playlist {playlist_spotify_id} added to watchlist. Its tracks will be processed by the watch manager."
        )
        return {
            "message": f"Playlist {playlist_spotify_id} added to watchlist. Tracks will be processed shortly."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error adding playlist {playlist_spotify_id} to watchlist: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail={"error": f"Could not add playlist to watchlist: {str(e)}"})


@router.get("/watch/{playlist_spotify_id}/status")
async def get_playlist_watch_status(playlist_spotify_id: str):
    """Checks if a specific playlist is being watched."""
    logger.info(f"Checking watch status for playlist {playlist_spotify_id}.")
    try:
        playlist = get_watched_playlist(playlist_spotify_id)
        if playlist:
            return {"is_watched": True, "playlist_data": playlist}
        else:
            # Return 200 with is_watched: false, so frontend can clearly distinguish
            # between "not watched" and an actual error fetching status.
            return {"is_watched": False}
    except Exception as e:
        logger.error(
            f"Error checking watch status for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail={"error": f"Could not check watch status: {str(e)}"})


@router.delete("/watch/{playlist_spotify_id}")
async def remove_from_watchlist(playlist_spotify_id: str):
    """Removes a playlist from the watchlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        raise HTTPException(status_code=403, detail={"error": "Watch feature is currently disabled globally."})

    logger.info(f"Attempting to remove playlist {playlist_spotify_id} from watchlist.")
    try:
        if not get_watched_playlist(playlist_spotify_id):
            raise HTTPException(
                status_code=404,
                detail={"error": f"Playlist {playlist_spotify_id} not found in watchlist."}
            )

        remove_playlist_db(playlist_spotify_id)
        logger.info(
            f"Playlist {playlist_spotify_id} removed from watchlist successfully."
        )
        return {"message": f"Playlist {playlist_spotify_id} removed from watchlist."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error removing playlist {playlist_spotify_id} from watchlist: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail={"error": f"Could not remove playlist from watchlist: {str(e)}"}
        )


@router.post("/watch/{playlist_spotify_id}/tracks")
async def mark_tracks_as_known(playlist_spotify_id: str, request: Request):
    """Fetches details for given track IDs and adds/updates them in the playlist's local DB table."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Watch feature is currently disabled globally. Cannot mark tracks."
            }
        )

    logger.info(
        f"Attempting to mark tracks as known for playlist {playlist_spotify_id}."
    )
    try:
        track_ids = await request.json()
        if not isinstance(track_ids, list) or not all(
            isinstance(tid, str) for tid in track_ids
        ):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Invalid request body. Expecting a JSON array of track Spotify IDs."
                }
            )

        if not get_watched_playlist(playlist_spotify_id):
            raise HTTPException(
                status_code=404,
                detail={"error": f"Playlist {playlist_spotify_id} is not being watched."}
            )

        fetched_tracks_details = []
        for track_id in track_ids:
            try:
                track_detail = get_spotify_info(track_id, "track")
                if track_detail and track_detail.get("id"):
                    fetched_tracks_details.append(track_detail)
                else:
                    logger.warning(
                        f"Could not fetch details for track {track_id} when marking as known for playlist {playlist_spotify_id}."
                    )
            except Exception as e:
                logger.error(
                    f"Failed to fetch Spotify details for track {track_id}: {e}"
                )

        if not fetched_tracks_details:
            return {
                "message": "No valid track details could be fetched to mark as known.",
                "processed_count": 0,
            }

        add_specific_tracks_to_playlist_table(
            playlist_spotify_id, fetched_tracks_details
        )
        logger.info(
            f"Successfully marked/updated {len(fetched_tracks_details)} tracks as known for playlist {playlist_spotify_id}."
        )
        return {
            "message": f"Successfully processed {len(fetched_tracks_details)} tracks for playlist {playlist_spotify_id}."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error marking tracks as known for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail={"error": f"Could not mark tracks as known: {str(e)}"})


@router.delete("/watch/{playlist_spotify_id}/tracks")
async def mark_tracks_as_missing_locally(playlist_spotify_id: str, request: Request):
    """Removes specified tracks from the playlist's local DB table."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Watch feature is currently disabled globally. Cannot mark tracks."
            }
        )

    logger.info(
        f"Attempting to mark tracks as missing (remove locally) for playlist {playlist_spotify_id}."
    )
    try:
        track_ids = await request.json()
        if not isinstance(track_ids, list) or not all(
            isinstance(tid, str) for tid in track_ids
        ):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Invalid request body. Expecting a JSON array of track Spotify IDs."
                }
            )

        if not get_watched_playlist(playlist_spotify_id):
            raise HTTPException(
                status_code=404,
                detail={"error": f"Playlist {playlist_spotify_id} is not being watched."}
            )

        deleted_count = remove_specific_tracks_from_playlist_table(
            playlist_spotify_id, track_ids
        )
        logger.info(
            f"Successfully removed {deleted_count} tracks locally for playlist {playlist_spotify_id}."
        )
        return {
            "message": f"Successfully removed {deleted_count} tracks locally for playlist {playlist_spotify_id}."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error marking tracks as missing (deleting locally) for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail={"error": f"Could not mark tracks as missing: {str(e)}"})


@router.get("/watch/list")
async def list_watched_playlists_endpoint():
    """Lists all playlists currently in the watchlist."""
    try:
        playlists = get_watched_playlists()
        return playlists
    except Exception as e:
        logger.error(f"Error listing watched playlists: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"Could not list watched playlists: {str(e)}"})


@router.post("/watch/trigger_check")
async def trigger_playlist_check_endpoint():
    """Manually triggers the playlist checking mechanism for all watched playlists."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Watch feature is currently disabled globally. Cannot trigger check."
            }
        )

    logger.info("Manual trigger for playlist check received for all playlists.")
    try:
        # Run check_watched_playlists without an ID to check all
        thread = threading.Thread(target=check_watched_playlists, args=(None,))
        thread.start()
        return {
            "message": "Playlist check triggered successfully in the background for all playlists."
        }
    except Exception as e:
        logger.error(
            f"Error manually triggering playlist check for all: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail={"error": f"Could not trigger playlist check for all: {str(e)}"}
        )


@router.post("/watch/trigger_check/{playlist_spotify_id}")
async def trigger_specific_playlist_check_endpoint(playlist_spotify_id: str):
    """Manually triggers the playlist checking mechanism for a specific playlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Watch feature is currently disabled globally. Cannot trigger check."
            }
        )

    logger.info(
        f"Manual trigger for specific playlist check received for ID: {playlist_spotify_id}"
    )
    try:
        # Check if the playlist is actually in the watchlist first
        watched_playlist = get_watched_playlist(playlist_spotify_id)
        if not watched_playlist:
            logger.warning(
                f"Trigger specific check: Playlist ID {playlist_spotify_id} not found in watchlist."
            )
            raise HTTPException(
                status_code=404,
                detail={
                    "error": f"Playlist {playlist_spotify_id} is not in the watchlist. Add it first."
                }
            )

        # Run check_watched_playlists with the specific ID
        thread = threading.Thread(
            target=check_watched_playlists, args=(playlist_spotify_id,)
        )
        thread.start()
        logger.info(
            f"Playlist check triggered in background for specific playlist ID: {playlist_spotify_id}"
        )
        return {
            "message": f"Playlist check triggered successfully in the background for {playlist_spotify_id}."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error manually triggering specific playlist check for {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": f"Could not trigger playlist check for {playlist_spotify_id}: {str(e)}"
            }
        )
