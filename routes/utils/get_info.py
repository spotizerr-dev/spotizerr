#!/usr/bin/python3

from deezspot.easy_spoty import Spo
import json
from pathlib import Path

# Load configuration from ./config/main.json
CONFIG_PATH = './config/main.json'
try:
    with open(CONFIG_PATH, 'r') as f:
        config_data = json.load(f)
    # Get the main Spotify account from config
    DEFAULT_SPOTIFY_ACCOUNT = config_data.get("spotify", "")
except Exception as e:
    print(f"Error loading configuration: {e}")
    DEFAULT_SPOTIFY_ACCOUNT = ""

def get_spotify_info(spotify_id, spotify_type):
    """
    Get info from Spotify API using the default Spotify account configured in main.json
    
    Args:
        spotify_id: The Spotify ID of the entity
        spotify_type: The type of entity (track, album, playlist, artist)
        
    Returns:
        Dictionary with the entity information
    """
    client_id = None
    client_secret = None
    
    # Use the default account from config
    main = DEFAULT_SPOTIFY_ACCOUNT
    
    if not main:
        raise ValueError("No Spotify account configured in settings")
    
    if spotify_id:
        search_creds_path = Path(f'./creds/spotify/{main}/search.json')
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    client_id = search_creds.get('client_id')
                    client_secret = search_creds.get('client_secret')
            except Exception as e:
                print(f"Error loading search credentials: {e}")
    
    # Initialize the Spotify client with credentials (if available)
    if client_id and client_secret:
        Spo.__init__(client_id, client_secret)
    else:
        raise ValueError("No Spotify credentials found")
    if spotify_type == "track":
        return Spo.get_track(spotify_id)
    elif spotify_type == "album":
        return Spo.get_album(spotify_id)
    elif spotify_type == "playlist":
        return Spo.get_playlist(spotify_id)
    elif spotify_type == "artist":
        return Spo.get_artist(spotify_id)
    elif spotify_type == "episode":
        return Spo.get_episode(spotify_id)
    else:
        raise ValueError(f"Unsupported Spotify type: {spotify_type}")
