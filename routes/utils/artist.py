import json
import traceback
from pathlib import Path
import os
import logging
from routes.utils.celery_queue_manager import download_queue_manager, get_config_params
from routes.utils.get_info import get_spotify_info

from deezspot.easy_spoty import Spo
from deezspot.libutils.utils import get_ids, link_is_valid

# Configure logging
logger = logging.getLogger(__name__)

def log_json(message_dict):
    """Helper function to output a JSON-formatted log message."""
    print(json.dumps(message_dict))


def get_artist_discography(url, main, album_type='album,single,compilation,appears_on', progress_callback=None):
    """
    Validate the URL, extract the artist ID, and retrieve the discography.
    """
    if not url:
        log_json({"status": "error", "message": "No artist URL provided."})
        raise ValueError("No artist URL provided.")

    # This will raise an exception if the link is invalid.
    link_is_valid(link=url)
    
    # Initialize Spotify API with credentials
    spotify_client_id = None
    spotify_client_secret = None
    search_creds_path = Path(f'./creds/spotify/{main}/search.json')
    if search_creds_path.exists():
        try:
            with open(search_creds_path, 'r') as f:
                search_creds = json.load(f)
                spotify_client_id = search_creds.get('client_id')
                spotify_client_secret = search_creds.get('client_secret')
        except Exception as e:
            log_json({"status": "error", "message": f"Error loading Spotify search credentials: {e}"})
            raise

    # Initialize the Spotify client with credentials
    if spotify_client_id and spotify_client_secret:
        Spo.__init__(spotify_client_id, spotify_client_secret)
    else:
        raise ValueError("No Spotify credentials found")

    try:
        artist_id = get_ids(url)
    except Exception as id_error:
        msg = f"Failed to extract artist ID from URL: {id_error}"
        log_json({"status": "error", "message": msg})
        raise ValueError(msg)

    try:
        discography = Spo.get_artist(artist_id, album_type=album_type)
        return discography
    except Exception as fetch_error:
        msg = f"An error occurred while fetching the discography: {fetch_error}"
        log_json({"status": "error", "message": msg})
        raise


def download_artist_albums(url, album_type="album,single,compilation", request_args=None):
    """
    Download albums by an artist, filtered by album types.
    
    Args:
        url (str): Spotify artist URL
        album_type (str): Comma-separated list of album types to download
                         (album, single, compilation, appears_on)
        request_args (dict): Original request arguments for tracking
    
    Returns:
        list: List of task IDs for the queued album downloads
    """
    if not url:
        raise ValueError("Missing required parameter: url")
    
    # Extract artist ID from URL
    artist_id = url.split('/')[-1]
    if '?' in artist_id:
        artist_id = artist_id.split('?')[0]
    
    logger.info(f"Fetching artist info for ID: {artist_id}")
    
    # Get artist info with albums
    artist_data = get_spotify_info(artist_id, "artist")
    
    if not artist_data or 'items' not in artist_data:
        raise ValueError(f"Failed to retrieve artist data or no albums found for artist ID {artist_id}")
    
    # Parse the album types to filter by
    allowed_types = [t.strip().lower() for t in album_type.split(",")]
    logger.info(f"Filtering albums by types: {allowed_types}")
    
    # Get artist name from the first album
    artist_name = ""
    if artist_data.get('items') and len(artist_data['items']) > 0:
        first_album = artist_data['items'][0]
        if first_album.get('artists') and len(first_album['artists']) > 0:
            artist_name = first_album['artists'][0].get('name', '')
    
    # Filter albums by the specified types
    filtered_albums = []
    for album in artist_data.get('items', []):
        album_type_value = album.get('album_type', '').lower()
        album_group_value = album.get('album_group', '').lower()
        
        # Apply filtering logic based on album_type and album_group
        if (('album' in allowed_types and album_type_value == 'album' and album_group_value == 'album') or
            ('single' in allowed_types and album_type_value == 'single' and album_group_value == 'single') or
            ('compilation' in allowed_types and album_type_value == 'compilation') or
            ('appears_on' in allowed_types and album_group_value == 'appears_on')):
            filtered_albums.append(album)
    
    if not filtered_albums:
        logger.warning(f"No albums match the specified types: {album_type}")
        return []
    
    # Queue each album as a separate download task
    album_task_ids = []
    
    for album in filtered_albums:
        album_url = album.get('external_urls', {}).get('spotify', '')
        album_name = album.get('name', 'Unknown Album')
        album_artists = album.get('artists', [])
        album_artist = album_artists[0].get('name', 'Unknown Artist') if album_artists else 'Unknown Artist'
        
        if not album_url:
            logger.warning(f"Skipping album without URL: {album_name}")
            continue
        
        # Create task for this album
        task_data = {
            "download_type": "album",
            "type": "album",  # Type for the download task
            "service": "spotify",  # Default to Spotify since we're using Spotify API
            "url": album_url,  # Important: use the album URL, not artist URL
            "retry_url": album_url,  # Use album URL for retry logic, not artist URL
            "name": album_name,
            "artist": album_artist,
            "orig_request": request_args or {}  # Store original request params
        }
        
        # Add the task to the queue manager
        task_id = download_queue_manager.add_task(task_data)
        album_task_ids.append(task_id)
        logger.info(f"Queued album download: {album_name} ({task_id})")
    
    logger.info(f"Queued {len(album_task_ids)} album downloads for artist: {artist_name}")
    return album_task_ids
