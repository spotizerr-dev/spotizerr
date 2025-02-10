import json
import traceback

from deezspot.easy_spoty import Spo
from deezspot.libutils.utils import get_ids, link_is_valid
from routes.utils.queue import download_queue_manager  # Global download queue manager


def log_json(message_dict):
    """Helper function to output a JSON-formatted log message."""
    print(json.dumps(message_dict))


def get_artist_discography(url, album_type='album,single,compilation,appears_on'):
    """
    Validate the URL, extract the artist ID, and retrieve the discography.
    """
    if not url:
        log_json({"status": "error", "message": "No artist URL provided."})
        raise ValueError("No artist URL provided.")

    # This will raise an exception if the link is invalid.
    link_is_valid(link=url)

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


def download_artist_albums(service, url, main, fallback=None, quality=None,
                           fall_quality=None, real_time=False,
                           album_type='album,single,compilation,appears_on',
                           custom_dir_format="%ar_album%/%album%/%copyright%",
                           custom_track_format="%tracknum%. %music% - %artist%"):
    """
    Retrieves the artist discography and, for each album with a valid Spotify URL,
    creates a download task that is queued via the global download queue. The queue
    creates a PRG file for each album download. This function returns a list of those
    album PRG filenames.
    """
    try:
        discography = get_artist_discography(url, album_type=album_type)
    except Exception as e:
        log_json({"status": "error", "message": f"Error retrieving artist discography: {e}"})
        raise

    albums = discography.get('items', [])
    if not albums:
        log_json({"status": "done", "message": "No albums found for the artist."})
        return []

    prg_files = []

    for album in albums:
        try:
            album_url = album.get('external_urls', {}).get('spotify')
            if not album_url:
                log_json({
                    "status": "warning",
                    "message": f"No Spotify URL found for album '{album.get('name', 'Unknown Album')}'; skipping."
                })
                continue

            album_name = album.get('name', 'Unknown Album')
            artists = album.get('artists', [])
            # Extract artist names or use "Unknown" as a fallback.
            artists = [artist.get("name", "Unknown") for artist in artists]

            # Prepare the download task dictionary.
            task = {
                "download_type": "album",
                "service": service,
                "url": album_url,
                "main": main,
                "fallback": fallback,
                "quality": quality,
                "fall_quality": fall_quality,
                "real_time": real_time,
                "custom_dir_format": custom_dir_format,
                "custom_track_format": custom_track_format,
                # Extra info for logging in the PRG file.
                "name": album_name,
                "type": "album",
                "artist": artists,
                "orig_request": {
                    "type": "album",
                    "name": album_name,
                    "artist": artists
                }
            }

            # Add the task to the global download queue.
            # The queue manager creates the album's PRG file and returns its filename.
            prg_filename = download_queue_manager.add_task(task)
            prg_files.append(prg_filename)

            log_json({
                "status": "queued",
                "album": album_name,
                "artist": artists,
                "prg_file": prg_filename,
                "message": "Album queued for download."
            })

        except Exception as album_error:
            log_json({
                "status": "error",
                "message": f"Error processing album '{album.get('name', 'Unknown')}': {album_error}"
            })
            traceback.print_exc()

    return prg_files
