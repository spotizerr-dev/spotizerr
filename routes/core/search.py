from fastapi import APIRouter, HTTPException, Request, Depends
import json
import traceback
import logging
from routes.utils.search import search

# Import authentication dependencies
from routes.auth.middleware import require_auth_from_state, User

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
@router.get("")
async def handle_search(request: Request, current_user: User = Depends(require_auth_from_state)):
    """
    Handle search requests for tracks, albums, playlists, or artists.
    Frontend compatible endpoint that returns results in { items: [] } format.
    """
    query = request.query_params.get("q")
    # Frontend sends 'search_type', so check both 'search_type' and 'type'
    search_type = request.query_params.get("search_type") or request.query_params.get("type", "track")
    limit = request.query_params.get("limit", "20")
    main = request.query_params.get("main")  # Account context

    if not query:
        raise HTTPException(status_code=400, detail={"error": "Missing parameter: q"})

    try:
        limit = int(limit)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "limit must be an integer"})

    try:
        # Use the single search_type (not multiple types like before)
        result = search(
            query=query,
            search_type=search_type,
            limit=limit,
            main=main
        )
        
        # Extract items from the Spotify API response based on search type
        # Spotify API returns results in format like { "tracks": { "items": [...] } }
        items = []
        
        # Map search types to their plural forms in Spotify response
        type_mapping = {
            "track": "tracks",
            "album": "albums", 
            "artist": "artists",
            "playlist": "playlists",
            "episode": "episodes",
            "show": "shows"
        }
        
        response_key = type_mapping.get(search_type.lower(), "tracks")
        
        if result and response_key in result:
            items = result[response_key].get("items", [])
        
        # Return in the format expected by frontend: { items: [] }
        return {"items": items}
        
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        logger.error(f"Error in search: {error_data}")
        raise HTTPException(status_code=500, detail=error_data)
