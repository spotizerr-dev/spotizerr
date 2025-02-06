import json
import traceback

from deezspot.easy_spoty import Spo
from deezspot.libutils.utils import get_ids, link_is_valid
from routes.utils.album import download_album  # Assumes album.py is in routes/utils/

def log_json(message_dict):
    """Helper function to output a JSON-formatted log message."""
    print(json.dumps(message_dict))


def get_artist_discography(url, album_type='album,single,compilation,appears_on'):
    if not url:
        message = "No artist URL provided."
        log_json({"status": "error", "message": message})
        raise ValueError(message)

    try:
        # Validate the URL (this function should raise an error if invalid).
        link_is_valid(link=url)
    except Exception as validation_error:
        message = f"Link validation failed: {validation_error}"
        log_json({"status": "error", "message": message})
        raise ValueError(message)

    try:
        # Extract the artist ID from the URL.
        artist_id = get_ids(url)
    except Exception as id_error:
        message = f"Failed to extract artist ID from URL: {id_error}"
        log_json({"status": "error", "message": message})
        raise ValueError(message)

    try:
        # Retrieve the discography using the artist ID.
        discography = Spo.get_artist(artist_id, album_type=album_type)
        return discography
    except Exception as fetch_error:
        message = f"An error occurred while fetching the discography: {fetch_error}"
        log_json({"status": "error", "message": message})
        raise


def download_artist_albums(service, artist_url, main, fallback=None, quality=None,
                           fall_quality=None, real_time=False, album_type='album,single,compilation,appears_on'):
    try:
        discography = get_artist_discography(artist_url, album_type=album_type)
    except Exception as e:
        log_json({"status": "error", "message": f"Error retrieving artist discography: {e}"})
        raise
    albums = discography.get('items', [])
    # Extract artist name from the first album's artists
    artist_name = artist_url  # default fallback
    if albums:
        first_album = albums[0]
        artists = first_album.get('artists', [])
        if artists:
            artist_name = artists[0].get('name', artist_url)

    if not albums:
        log_json({
            "status": "done",
            "type": "artist",
            "artist": artist_name,
            "album_type": album_type,
            "message": "No albums found for the artist."
        })
        return

    log_json({"status": "initializing", "type": "artist", "artist": artist_name, "total_albums": len(albums), "album_type": album_type})

    for album in albums:
        try:
            album_url = album.get('external_urls', {}).get('spotify')
            album_name = album.get('name', 'Unknown Album')
            # Extract artist names if available.
            artists = []
            if "artists" in album:
                artists = [artist.get("name", "Unknown") for artist in album["artists"]]
            if not album_url:
                log_json({
                    "status": "warning",
                    "type": "album",
                    "album": album_name,
                    "artist": artists,
                    "message": "No Spotify URL found; skipping."
                })
                continue

            download_album(
                service=service,
                url=album_url,
                main=main,
                fallback=fallback,
                quality=quality,
                fall_quality=fall_quality,
                real_time=real_time
            )

        except Exception as album_error:
            log_json({
                "status": "error",
                "type": "album",
                "album": album.get('name', 'Unknown'),
                "error": str(album_error)
            })
            traceback.print_exc()

    # When everything has been processed, print the final status.
    log_json({
        "status": "done",
        "type": "artist",
        "artist": artist_name,
        "album_type": album_type
    })