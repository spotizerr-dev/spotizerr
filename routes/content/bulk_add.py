import re
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging

# Assuming these imports are available for queue management and Spotify info
from routes.utils.get_info import get_spotify_info
from routes.utils.celery_tasks import download_track, download_album, download_playlist

router = APIRouter()
logger = logging.getLogger(__name__)

class BulkAddLinksRequest(BaseModel):
    links: List[str]

@router.post("/bulk-add-spotify-links")
async def bulk_add_spotify_links(request: BulkAddLinksRequest):
    added_count = 0
    failed_links = []
    total_links = len(request.links)
    
    for link in request.links:
        # Assuming links are pre-filtered by the frontend,
        # but still handle potential errors during info retrieval or unsupported types
        # Extract type and ID from the link directly using regex
        match = re.match(r"https://open\.spotify\.com(?:/intl-[a-z]{2})?/(track|album|playlist|artist)/([a-zA-Z0-9]+)(?:\?.*)?", link)
        if not match:
            logger.warning(f"Could not parse Spotify link (unexpected format after frontend filter): {link}")
            failed_links.append(link)
            continue

        spotify_type = match.group(1)
        spotify_id = match.group(2)

        try:
            # Get basic info to confirm existence and get name/artist
            # For playlists, we might want to get full info later when adding to queue
            if spotify_type == "playlist":
                item_info = get_spotify_info(spotify_id, "playlist_metadata")
            else:
                item_info = get_spotify_info(spotify_id, spotify_type)
            
            item_name = item_info.get("name", "Unknown Name")
            artist_name = ""
            if spotify_type in ["track", "album"]:
                artists = item_info.get("artists", [])
                if artists:
                    artist_name = ", ".join([a.get("name", "Unknown Artist") for a in artists])
            elif spotify_type == "playlist":
                owner = item_info.get("owner", {})
                artist_name = owner.get("display_name", "Unknown Owner")

            # Construct URL for the download task
            spotify_url = f"https://open.spotify.com/{spotify_type}/{spotify_id}"

            # Add to Celery queue based on type
            if spotify_type == "track":
                download_track.delay(
                    url=spotify_url,
                    spotify_id=spotify_id,
                    type=spotify_type,
                    name=item_name,
                    artist=artist_name,
                    download_type="track",
                )
            elif spotify_type == "album":
                download_album.delay(
                    url=spotify_url,
                    spotify_id=spotify_id,
                    type=spotify_type,
                    name=item_name,
                    artist=artist_name,
                    download_type="album",
                )
            elif spotify_type == "playlist":
                download_playlist.delay(
                    url=spotify_url,
                    spotify_id=spotify_id,
                    type=spotify_type,
                    name=item_name,
                    artist=artist_name,
                    download_type="playlist",
                )
            else:
                logger.warning(f"Unsupported Spotify type for download: {spotify_type} for link: {link}")
                failed_links.append(link)
                continue

            added_count += 1
            logger.debug(f"Added {added_count+1}/{total_links} {spotify_type} '{item_name}' ({spotify_id}) to queue.")

        except Exception as e:
            logger.error(f"Error processing Spotify link {link}: {e}", exc_info=True)
            failed_links.append(link)

    message = f"Successfully added {added_count}/{total_links} links to queue."
    if failed_links:
        message += f" Failed to add {len(failed_links)} links."
        logger.warning(f"Bulk add completed with {len(failed_links)} failures.")
    else:
        logger.info(f"Bulk add completed successfully. Added {added_count} links.")

    return {
        "message": message,
        "count": added_count,
        "failed_links": failed_links,
    }