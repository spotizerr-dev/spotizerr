import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from routes.utils.credentials import _get_global_spotify_api_creds
import logging
import time
from typing import Dict, Optional, Any

# Import Deezer API and logging
from deezspot.deezloader.dee_api import API as DeezerAPI

# Initialize logger
logger = logging.getLogger(__name__)

# Global Spotify client instance for reuse
_spotify_client = None
_last_client_init = 0
_client_init_interval = 3600  # Reinitialize client every hour


def _get_spotify_client():
    """
    Get or create a Spotify client with global credentials.
    Implements client reuse and periodic reinitialization.
    """
    global _spotify_client, _last_client_init

    current_time = time.time()

    # Reinitialize client if it's been more than an hour or if client doesn't exist
    if (
        _spotify_client is None
        or current_time - _last_client_init > _client_init_interval
    ):
        client_id, client_secret = _get_global_spotify_api_creds()

        if not client_id or not client_secret:
            raise ValueError(
                "Global Spotify API client_id or client_secret not configured in ./data/creds/search.json."
            )

        # Create new client
        _spotify_client = spotipy.Spotify(
            client_credentials_manager=SpotifyClientCredentials(
                client_id=client_id, client_secret=client_secret
            )
        )
        _last_client_init = current_time
        logger.info("Spotify client initialized/reinitialized")

    return _spotify_client


def _rate_limit_handler(func):
    """
    Decorator to handle rate limiting with exponential backoff.
    """

    def wrapper(*args, **kwargs):
        max_retries = 3
        base_delay = 1

        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                if "429" in str(e) or "rate limit" in str(e).lower():
                    if attempt < max_retries - 1:
                        delay = base_delay * (2**attempt)
                        logger.warning(f"Rate limited, retrying in {delay} seconds...")
                        time.sleep(delay)
                        continue
                raise e
        return func(*args, **kwargs)

    return wrapper


@_rate_limit_handler
def get_playlist_metadata(playlist_id: str) -> Dict[str, Any]:
    """
    Get playlist metadata only (no tracks) to avoid rate limiting.

    Args:
        playlist_id: The Spotify playlist ID

    Returns:
        Dictionary with playlist metadata (name, description, owner, etc.)
    """
    client = _get_spotify_client()

    try:
        # Get basic playlist info without tracks
        playlist = client.playlist(
            playlist_id,
            fields="id,name,description,owner,images,snapshot_id,public,followers,tracks.total",
        )

        # Add a flag to indicate this is metadata only
        playlist["_metadata_only"] = True
        playlist["_tracks_loaded"] = False

        logger.debug(
            f"Retrieved playlist metadata for {playlist_id}: {playlist.get('name', 'Unknown')}"
        )
        return playlist

    except Exception as e:
        logger.error(f"Error fetching playlist metadata for {playlist_id}: {e}")
        raise


@_rate_limit_handler
def get_playlist_tracks(
    playlist_id: str, limit: int = 100, offset: int = 0
) -> Dict[str, Any]:
    """
    Get playlist tracks with pagination support to handle large playlists efficiently.

    Args:
        playlist_id: The Spotify playlist ID
        limit: Number of tracks to fetch per request (max 100)
        offset: Starting position for pagination

    Returns:
        Dictionary with tracks data
    """
    client = _get_spotify_client()

    try:
        # Get tracks with specified limit and offset
        tracks_data = client.playlist_tracks(
            playlist_id,
            limit=min(limit, 100),  # Spotify API max is 100
            offset=offset,
            fields="items(track(id,name,artists,album,external_urls,preview_url,duration_ms,explicit,popularity)),total,limit,offset",
        )

        logger.debug(
            f"Retrieved {len(tracks_data.get('items', []))} tracks for playlist {playlist_id} (offset: {offset})"
        )
        return tracks_data

    except Exception as e:
        logger.error(f"Error fetching playlist tracks for {playlist_id}: {e}")
        raise


@_rate_limit_handler
def get_playlist_full(playlist_id: str, batch_size: int = 100) -> Dict[str, Any]:
    """
    Get complete playlist data with all tracks, using batched requests to avoid rate limiting.

    Args:
        playlist_id: The Spotify playlist ID
        batch_size: Number of tracks to fetch per batch (max 100)

    Returns:
        Complete playlist data with all tracks
    """
    try:
        # First get metadata
        playlist = get_playlist_metadata(playlist_id)

        # Get total track count
        total_tracks = playlist.get("tracks", {}).get("total", 0)

        if total_tracks == 0:
            playlist["tracks"] = {"items": [], "total": 0}
            return playlist

        # Fetch all tracks in batches
        all_tracks = []
        offset = 0

        while offset < total_tracks:
            batch = get_playlist_tracks(playlist_id, limit=batch_size, offset=offset)
            batch_items = batch.get("items", [])
            all_tracks.extend(batch_items)

            offset += len(batch_items)

            # Add small delay between batches to be respectful to API
            if offset < total_tracks:
                time.sleep(0.1)

        # Update playlist with complete tracks data
        playlist["tracks"] = {
            "items": all_tracks,
            "total": total_tracks,
            "limit": batch_size,
            "offset": 0,
        }
        playlist["_metadata_only"] = False
        playlist["_tracks_loaded"] = True

        logger.info(
            f"Retrieved complete playlist {playlist_id} with {total_tracks} tracks"
        )
        return playlist

    except Exception as e:
        logger.error(f"Error fetching complete playlist {playlist_id}: {e}")
        raise


def check_playlist_updated(playlist_id: str, last_snapshot_id: str) -> bool:
    """
    Check if playlist has been updated by comparing snapshot_id.
    This is much more efficient than fetching all tracks.

    Args:
        playlist_id: The Spotify playlist ID
        last_snapshot_id: The last known snapshot_id

    Returns:
        True if playlist has been updated, False otherwise
    """
    try:
        metadata = get_playlist_metadata(playlist_id)
        current_snapshot_id = metadata.get("snapshot_id")

        return current_snapshot_id != last_snapshot_id

    except Exception as e:
        logger.error(f"Error checking playlist update status for {playlist_id}: {e}")
        raise


@_rate_limit_handler
def get_spotify_info(
    spotify_id: str,
    spotify_type: str,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Get info from Spotify API using Spotipy directly.
    Optimized to prevent rate limiting by using appropriate endpoints.

    Args:
        spotify_id: The Spotify ID of the entity
        spotify_type: The type of entity (track, album, playlist, artist, artist_discography, episode)
        limit (int, optional): The maximum number of items to return. Used for pagination.
        offset (int, optional): The index of the first item to return. Used for pagination.

    Returns:
        Dictionary with the entity information
    """
    client = _get_spotify_client()

    try:
        if spotify_type == "track":
            return client.track(spotify_id)

        elif spotify_type == "album":
            return client.album(spotify_id)

        elif spotify_type == "playlist":
            # Use optimized playlist fetching
            return get_playlist_full(spotify_id)

        elif spotify_type == "playlist_metadata":
            # Get only metadata for playlists
            return get_playlist_metadata(spotify_id)

        elif spotify_type == "artist":
            return client.artist(spotify_id)

        elif spotify_type == "artist_discography":
            # Get artist's albums with pagination
            albums = client.artist_albums(
                spotify_id, limit=limit or 20, offset=offset or 0
            )
            return albums

        elif spotify_type == "episode":
            return client.episode(spotify_id)

        else:
            raise ValueError(f"Unsupported Spotify type: {spotify_type}")

    except Exception as e:
        logger.error(f"Error fetching {spotify_type} {spotify_id}: {e}")
        raise


# Cache for playlist metadata to reduce API calls
_playlist_metadata_cache: Dict[str, tuple[Dict[str, Any], float]] = {}
_cache_ttl = 300  # 5 minutes cache


def get_cached_playlist_metadata(playlist_id: str) -> Optional[Dict[str, Any]]:
    """
    Get playlist metadata from cache if available and not expired.

    Args:
        playlist_id: The Spotify playlist ID

    Returns:
        Cached metadata or None if not available/expired
    """
    if playlist_id in _playlist_metadata_cache:
        cached_data, timestamp = _playlist_metadata_cache[playlist_id]
        if time.time() - timestamp < _cache_ttl:
            return cached_data

    return None


def cache_playlist_metadata(playlist_id: str, metadata: Dict[str, Any]):
    """
    Cache playlist metadata with timestamp.

    Args:
        playlist_id: The Spotify playlist ID
        metadata: The metadata to cache
    """
    _playlist_metadata_cache[playlist_id] = (metadata, time.time())


def get_playlist_info_optimized(
    playlist_id: str, include_tracks: bool = False
) -> Dict[str, Any]:
    """
    Optimized playlist info function that uses caching and selective loading.

    Args:
        playlist_id: The Spotify playlist ID
        include_tracks: Whether to include track data (default: False to save API calls)

    Returns:
        Playlist data with or without tracks
    """
    # Check cache first
    cached_metadata = get_cached_playlist_metadata(playlist_id)

    if cached_metadata and not include_tracks:
        logger.debug(f"Returning cached metadata for playlist {playlist_id}")
        return cached_metadata

    if include_tracks:
        # Get complete playlist data
        playlist_data = get_playlist_full(playlist_id)
        # Cache the metadata portion
        metadata_only = {k: v for k, v in playlist_data.items() if k != "tracks"}
        metadata_only["_metadata_only"] = True
        metadata_only["_tracks_loaded"] = False
        cache_playlist_metadata(playlist_id, metadata_only)
        return playlist_data
    else:
        # Get metadata only
        metadata = get_playlist_metadata(playlist_id)
        cache_playlist_metadata(playlist_id, metadata)
        return metadata


# Keep the existing Deezer functions unchanged
def get_deezer_info(deezer_id, deezer_type, limit=None):
    """
    Get info from Deezer API.

    Args:
        deezer_id: The Deezer ID of the entity.
        deezer_type: The type of entity (track, album, playlist, artist, episode,
                     artist_top_tracks, artist_albums, artist_related,
                     artist_radio, artist_playlists).
        limit (int, optional): The maximum number of items to return. Used for
                               artist_top_tracks, artist_albums, artist_playlists.
                               Deezer API methods usually have their own defaults (e.g., 25)
                               if limit is not provided or None is passed to them.

    Returns:
        Dictionary with the entity information.
    Raises:
        ValueError: If deezer_type is unsupported.
        Various exceptions from DeezerAPI (NoDataApi, QuotaExceeded, requests.exceptions.RequestException, etc.)
    """
    logger.debug(
        f"Fetching Deezer info for ID {deezer_id}, type {deezer_type}, limit {limit}"
    )

    # DeezerAPI uses class methods; its @classmethod __init__ handles setup.
    # No specific ARL or account handling here as DeezerAPI seems to use general endpoints.

    if deezer_type == "track":
        return DeezerAPI.get_track(deezer_id)
    elif deezer_type == "album":
        return DeezerAPI.get_album(deezer_id)
    elif deezer_type == "playlist":
        return DeezerAPI.get_playlist(deezer_id)
    elif deezer_type == "artist":
        return DeezerAPI.get_artist(deezer_id)
    elif deezer_type == "episode":
        return DeezerAPI.get_episode(deezer_id)
    elif deezer_type == "artist_top_tracks":
        if limit is not None:
            return DeezerAPI.get_artist_top_tracks(deezer_id, limit=limit)
        return DeezerAPI.get_artist_top_tracks(deezer_id)  # Use API default limit
    elif deezer_type == "artist_albums":  # Maps to get_artist_top_albums
        if limit is not None:
            return DeezerAPI.get_artist_top_albums(deezer_id, limit=limit)
        return DeezerAPI.get_artist_top_albums(deezer_id)  # Use API default limit
    elif deezer_type == "artist_related":
        return DeezerAPI.get_artist_related(deezer_id)
    elif deezer_type == "artist_radio":
        return DeezerAPI.get_artist_radio(deezer_id)
    elif deezer_type == "artist_playlists":
        if limit is not None:
            return DeezerAPI.get_artist_top_playlists(deezer_id, limit=limit)
        return DeezerAPI.get_artist_top_playlists(deezer_id)  # Use API default limit
    else:
        logger.error(f"Unsupported Deezer type: {deezer_type}")
        raise ValueError(f"Unsupported Deezer type: {deezer_type}")
