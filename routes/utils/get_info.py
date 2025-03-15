#!/usr/bin/python3

from deezspot.easy_spoty import Spo
import json
from pathlib import Path

def get_spotify_info(spotify_id, spotify_type, main=None):
    client_id = None
    client_secret = None
    if spotify_id:
        search_creds_path = Path(f'./creds/spotify/{main}/search.json')
        print(search_creds_path)
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    client_id = search_creds.get('client_id')
                    print(client_id)
                    client_secret = search_creds.get('client_secret')
                    print(client_secret)
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
