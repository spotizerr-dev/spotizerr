import json
import traceback
from pathlib import Path
import os
import logging
from routes.utils.celery_queue_manager import download_queue_manager, get_config_params

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


def download_artist_albums(service, url, album_type="album,single,compilation", request_args=None, progress_callback=None):
    """
    Download albums from an artist.
    
    Args:
        service (str): 'spotify' or 'deezer'
        url (str): URL of the artist
        album_type (str): Comma-separated list of album types to download (album,single,compilation,appears_on)
        request_args (dict): Original request arguments for additional parameters
        progress_callback (callable): Optional callback function for progress reporting
        
    Returns:
        list: List of task IDs for the enqueued album downloads
    """
    logger.info(f"Starting artist albums download: {url} (service: {service}, album_types: {album_type})")
    
    if request_args is None:
        request_args = {}
    
    # Get config parameters
    config_params = get_config_params()
    
    # Get the artist information first
    if service == 'spotify':
        from deezspot.spotloader import SpoLogin
        
        # Get credentials
        spotify_profile = request_args.get('main', config_params['spotify'])
        credentials_path = os.path.abspath(os.path.join('./creds/spotify', spotify_profile, 'credentials.json'))
        
        # Validate credentials
        if not os.path.isfile(credentials_path):
            raise ValueError(f"Invalid Spotify credentials path: {credentials_path}")
        
        # Load Spotify client credentials if available
        spotify_client_id = None
        spotify_client_secret = None
        search_creds_path = Path(f'./creds/spotify/{spotify_profile}/search.json')
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    spotify_client_id = search_creds.get('client_id')
                    spotify_client_secret = search_creds.get('client_secret')
            except Exception as e:
                logger.error(f"Error loading Spotify search credentials: {e}")
        
        # Initialize the Spotify client
        spo = SpoLogin(
            credentials_path=credentials_path,
            spotify_client_id=spotify_client_id,
            spotify_client_secret=spotify_client_secret,
            progress_callback=progress_callback
        )
        
        # Get artist information
        artist_info = spo.get_artist_info(url)
        artist_name = artist_info['name']
        artist_id = artist_info['id']
        
        # Get the list of albums
        album_types = album_type.split(',')
        albums = []
        
        for album_type_item in album_types:
            # Fetch albums of the specified type
            albums_of_type = spo.get_albums_by_artist(artist_id, album_type_item.strip())
            for album in albums_of_type:
                albums.append({
                    'name': album['name'],
                    'url': album['external_urls']['spotify'],
                    'type': 'album',
                    'artist': artist_name
                })
    
    elif service == 'deezer':
        from deezspot.deezloader import DeeLogin
        
        # Get credentials
        deezer_profile = request_args.get('main', config_params['deezer'])
        credentials_path = os.path.abspath(os.path.join('./creds/deezer', deezer_profile, 'credentials.json'))
        
        # Validate credentials
        if not os.path.isfile(credentials_path):
            raise ValueError(f"Invalid Deezer credentials path: {credentials_path}")
        
        # For Deezer, we need to extract the ARL
        with open(credentials_path, 'r') as f:
            credentials = json.load(f)
            arl = credentials.get('arl')
        
        if not arl:
            raise ValueError("No ARL found in Deezer credentials")
        
        # Load Spotify client credentials if available for search purposes
        spotify_client_id = None
        spotify_client_secret = None
        search_creds_path = Path(f'./creds/spotify/{deezer_profile}/search.json')
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    spotify_client_id = search_creds.get('client_id')
                    spotify_client_secret = search_creds.get('client_secret')
            except Exception as e:
                logger.error(f"Error loading Spotify search credentials: {e}")
        
        # Initialize the Deezer client
        dee = DeeLogin(
            arl=arl,
            spotify_client_id=spotify_client_id,
            spotify_client_secret=spotify_client_secret,
            progress_callback=progress_callback
        )
        
        # Get artist information
        artist_info = dee.get_artist_info(url)
        artist_name = artist_info['name']
        
        # Get the list of albums (Deezer doesn't distinguish types like Spotify)
        albums_result = dee.get_artist_albums(url)
        albums = []
        
        for album in albums_result:
            albums.append({
                'name': album['title'],
                'url': f"https://www.deezer.com/album/{album['id']}",
                'type': 'album',
                'artist': artist_name
            })
    
    else:
        raise ValueError(f"Unsupported service: {service}")
    
    # Queue the album downloads
    album_task_ids = []
    
    for album in albums:
        # Create a task for each album
        task_id = download_queue_manager.add_task({
            "download_type": "album",
            "service": service,
            "url": album['url'],
            "name": album['name'],
            "artist": album['artist'],
            "orig_request": request_args.copy()  # Pass along original request args
        })
        
        album_task_ids.append(task_id)
        logger.info(f"Queued album: {album['name']} by {album['artist']} (task ID: {task_id})")
    
    return album_task_ids
