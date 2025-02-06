#!/usr/bin/python3

from deezspot.easy_spoty import Spo

Spo()

def get_spotify_info(spotify_id, spotify_type):
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
