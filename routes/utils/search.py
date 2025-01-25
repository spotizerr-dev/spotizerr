from deezspot.easy_spoty import Spo
from deezspot.deezloader import API
import json
import difflib
from typing import List, Dict

def string_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()

def normalize_item(item: Dict, service: str, item_type: str) -> Dict:
    normalized = {
        "service": service,
        "type": item_type
    }
    
    if item_type == "track":
        normalized.update({
            "id": item.get('id'),
            "title": item.get('title') if service == "deezer" else item.get('name'),
            "artists": [{"name": item['artist']['name']}] if service == "deezer" 
                       else [{"name": a['name']} for a in item.get('artists', [])],
            "album": {
                "title": item['album']['title'] if service == "deezer" else item['album']['name'],
                "id": item['album']['id'] if service == "deezer" else item['album'].get('id'),
            },
            "duration": item.get('duration') if service == "deezer" else item.get('duration_ms'),
            "url": item.get('link') if service == "deezer" else item.get('external_urls', {}).get('spotify'),
            "isrc": item.get('isrc') if service == "deezer" else item.get('external_ids', {}).get('isrc')
        })
    
    elif item_type == "album":
        normalized.update({
            "id": item.get('id'),
            "title": item.get('title') if service == "deezer" else item.get('name'),
            "artists": [{"name": item['artist']['name']}] if service == "deezer" 
                       else [{"name": a['name']} for a in item.get('artists', [])],
            "total_tracks": item.get('nb_tracks') if service == "deezer" else item.get('total_tracks'),
            "release_date": item.get('release_date'),
            "url": item.get('link') if service == "deezer" else item.get('external_urls', {}).get('spotify'),
            "images": [
                {"url": item.get('cover_xl')},
                {"url": item.get('cover_big')},
                {"url": item.get('cover_medium')}
            ] if service == "deezer" else item.get('images', [])
        })
    
    elif item_type == "artist":
        normalized.update({
            "id": item.get('id'),
            "name": item.get('name'),
            "url": item.get('link') if service == "deezer" else item.get('external_urls', {}).get('spotify'),
            "images": [
                {"url": item.get('picture_xl')},
                {"url": item.get('picture_big')},
                {"url": item.get('picture_medium')}
            ] if service == "deezer" else item.get('images', [])
        })
    
    else:  # For playlists, episodes, etc.
        normalized.update({
            "id": item.get('id'),
            "title": item.get('title') if service == "deezer" else item.get('name'),
            "url": item.get('link') if service == "deezer" else item.get('external_urls', {}).get('spotify'),
            "description": item.get('description'),
            "owner": item.get('user', {}).get('name') if service == "deezer" else item.get('owner', {}).get('display_name')
        })
    
    return {k: v for k, v in normalized.items() if v is not None}

def is_same_item(deezer_item: Dict, spotify_item: Dict, item_type: str) -> bool:
    deezer_normalized = normalize_item(deezer_item, "deezer", item_type)
    spotify_normalized = normalize_item(spotify_item, "spotify", item_type)

    if item_type == "track":
        title_match = string_similarity(deezer_normalized['title'], spotify_normalized['title']) >= 0.8
        artist_match = string_similarity(
            deezer_normalized['artists'][0]['name'], 
            spotify_normalized['artists'][0]['name']
        ) >= 0.8
        album_match = string_similarity(
            deezer_normalized['album']['title'], 
            spotify_normalized['album']['title']
        ) >= 0.9
        return title_match and artist_match and album_match
    
    if item_type == "album":
        title_match = string_similarity(deezer_normalized['title'], spotify_normalized['title']) >= 0.8
        artist_match = string_similarity(
            deezer_normalized['artists'][0]['name'], 
            spotify_normalized['artists'][0]['name']
        ) >= 0.8
        tracks_match = deezer_normalized['total_tracks'] == spotify_normalized['total_tracks']
        return title_match and artist_match and tracks_match
    
    if item_type == "artist":
        name_match = string_similarity(deezer_normalized['name'], spotify_normalized['name']) >= 0.85
        return name_match
    
    return False

def process_results(deezer_results: Dict, spotify_results: Dict, search_type: str) -> List[Dict]:
    combined = []
    processed_spotify_ids = set()

    for deezer_item in deezer_results.get('data', []):
        match_found = False
        normalized_deezer = normalize_item(deezer_item, "deezer", search_type)
        
        for spotify_item in spotify_results.get('items', []):
            if is_same_item(deezer_item, spotify_item, search_type):
                processed_spotify_ids.add(spotify_item['id'])
                match_found = True
                break
        
        combined.append(normalized_deezer)

    for spotify_item in spotify_results.get('items', []):
        if spotify_item['id'] not in processed_spotify_ids:
            combined.append(normalize_item(spotify_item, "spotify", search_type))

    return combined

def search_and_combine(
    query: str, 
    search_type: str, 
    service: str = "both",
    limit: int = 3
) -> List[Dict]:
    if search_type == "playlist" and service == "both":
        raise ValueError("Playlist search requires explicit service selection (deezer or spotify)")
    
    if search_type == "episode" and service != "spotify":
        raise ValueError("Episode search is only available for Spotify")

    deezer_data = []
    spotify_items = []

    # Deezer search with limit
    if service in ["both", "deezer"] and search_type != "episode":
        deezer_api = API()
        deezer_methods = {
            'track': deezer_api.search_track,
            'album': deezer_api.search_album,
            'artist': deezer_api.search_artist,
            'playlist': deezer_api.search_playlist
        }
        deezer_method = deezer_methods.get(search_type, deezer_api.search)
        deezer_response = deezer_method(query, limit=limit)
        deezer_data = deezer_response.get('data', [])[:limit]
        
        if service == "deezer":
            return [normalize_item(item, "deezer", search_type) for item in deezer_data]

    # Spotify search with limit
    if service in ["both", "spotify"]:
        Spo.__init__()
        spotify_response = Spo.search(query=query, search_type=search_type, limit=limit)
        
        if search_type == "episode":
            spotify_items = spotify_response.get('episodes', {}).get('items', [])[:limit]
        else:
            spotify_items = spotify_response.get('tracks', {}).get('items', 
                              spotify_response.get('albums', {}).get('items',
                              spotify_response.get('artists', {}).get('items',
                              spotify_response.get('playlists', {}).get('items', []))))[:limit]
        
        if service == "spotify":
            return [normalize_item(item, "spotify", search_type) for item in spotify_items]

    # Combined results
    if service == "both" and search_type != "playlist":
        return process_results(
            {"data": deezer_data},
            {"items": spotify_items},
            search_type
        )[:limit]

    return []