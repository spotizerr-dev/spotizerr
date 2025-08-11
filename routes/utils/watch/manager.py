import time
import threading
import logging
import json
import os
import re
from pathlib import Path
from typing import Any, List, Dict

from routes.utils.watch.db import (
    get_watched_playlists,
    get_watched_playlist,
    get_playlist_track_ids_from_db,
    get_playlist_tracks_with_snapshot_from_db,
    get_playlist_total_tracks_from_db,
    add_tracks_to_playlist_db,
    update_playlist_snapshot,
    mark_tracks_as_not_present_in_spotify,
    update_all_existing_tables_schema,
    ensure_playlist_table_schema,
    # Artist watch DB functions
    get_watched_artists,
    get_watched_artist,
    get_artist_album_ids_from_db,
    update_artist_metadata_after_check,  # Renamed from update_artist_metadata
)
from routes.utils.get_info import (
    get_spotify_info,
    get_playlist_metadata,
    get_playlist_tracks,
)  # To fetch playlist, track, artist, and album details
from routes.utils.celery_queue_manager import download_queue_manager

logger = logging.getLogger(__name__)
CONFIG_FILE_PATH = Path("./data/config/watch.json")
STOP_EVENT = threading.Event()

# Format mapping for audio file conversions
AUDIO_FORMAT_EXTENSIONS = {
    "mp3": ".mp3",
    "flac": ".flac",
    "m4a": ".m4a",
    "aac": ".m4a",
    "ogg": ".ogg",
    "wav": ".wav",
}

DEFAULT_WATCH_CONFIG = {
    "enabled": False,
    "watchPollIntervalSeconds": 3600,
    "max_tracks_per_run": 50,  # For playlists
    "watchedArtistAlbumGroup": ["album", "single"],  # Default for artists
    "delay_between_playlists_seconds": 2,
    "delay_between_artists_seconds": 5,  # Added for artists
    "use_snapshot_id_checking": True,  # Enable snapshot_id checking for efficiency
}


def get_watch_config():
    """Loads the watch configuration from watch.json.
    Creates the file with defaults if it doesn't exist.
    Ensures all default keys are present in the loaded config.
    """
    try:
        # Ensure ./data/config directory exists
        CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

        if not CONFIG_FILE_PATH.exists():
            logger.info(
                f"{CONFIG_FILE_PATH} not found. Creating with default watch config."
            )
            with open(CONFIG_FILE_PATH, "w") as f:
                json.dump(DEFAULT_WATCH_CONFIG, f, indent=2)
            return DEFAULT_WATCH_CONFIG.copy()

        with open(CONFIG_FILE_PATH, "r") as f:
            config = json.load(f)

        updated = False
        for key, value in DEFAULT_WATCH_CONFIG.items():
            if key not in config:
                config[key] = value
                updated = True

        if updated:
            logger.info(
                f"Watch configuration at {CONFIG_FILE_PATH} was missing some default keys. Updated with defaults."
            )
            with open(CONFIG_FILE_PATH, "w") as f:
                json.dump(config, f, indent=2)
        return config
    except Exception as e:
        logger.error(
            f"Error loading or creating watch config at {CONFIG_FILE_PATH}: {e}",
            exc_info=True,
        )
        return DEFAULT_WATCH_CONFIG.copy()  # Fallback


def construct_spotify_url(item_id, item_type="track"):
    return f"https://open.spotify.com/{item_type}/{item_id}"


def has_playlist_changed(playlist_spotify_id: str, current_snapshot_id: str) -> bool:
    """
    Check if a playlist has changed by comparing snapshot_id.
    This is much more efficient than fetching all tracks.

    Args:
        playlist_spotify_id: The Spotify playlist ID
        current_snapshot_id: The current snapshot_id from API

    Returns:
        True if playlist has changed, False otherwise
    """
    try:
        db_playlist = get_watched_playlist(playlist_spotify_id)
        if not db_playlist:
            # Playlist not in database, consider it as "changed" to trigger initial processing
            return True

        last_snapshot_id = db_playlist.get("snapshot_id")
        if not last_snapshot_id:
            # No previous snapshot_id, consider it as "changed" to trigger initial processing
            return True

        return current_snapshot_id != last_snapshot_id

    except Exception as e:
        logger.error(
            f"Error checking playlist change status for {playlist_spotify_id}: {e}"
        )
        # On error, assume playlist has changed to be safe
        return True


def needs_track_sync(
    playlist_spotify_id: str, current_snapshot_id: str, api_total_tracks: int
) -> tuple[bool, list[str]]:
    """
    Check if tracks need to be synchronized by comparing snapshot_ids and total counts.

    Args:
        playlist_spotify_id: The Spotify playlist ID
        current_snapshot_id: The current snapshot_id from API
        api_total_tracks: The total number of tracks reported by API

    Returns:
        Tuple of (needs_sync, tracks_to_find) where:
        - needs_sync: True if tracks need to be synchronized
        - tracks_to_find: List of track IDs that need to be found in API response
    """
    try:
        # Get tracks from database with their snapshot_ids
        db_tracks = get_playlist_tracks_with_snapshot_from_db(playlist_spotify_id)
        db_total_tracks = get_playlist_total_tracks_from_db(playlist_spotify_id)

        # Check if total count matches
        if db_total_tracks != api_total_tracks:
            logger.info(
                f"Track count mismatch for playlist {playlist_spotify_id}: DB={db_total_tracks}, API={api_total_tracks}. Full sync needed to ensure all tracks are captured."
            )
            # Always do full sync when counts don't match to ensure we don't miss any tracks
            # This handles cases like:
            # - Empty database (DB=0, API=1345)
            # - Missing tracks (DB=1000, API=1345)
            # - Removed tracks (DB=1345, API=1000)
            return True, []  # Empty list indicates full sync needed

        # Check if any tracks have different snapshot_id
        tracks_to_find = []
        for track_id, track_data in db_tracks.items():
            if track_data.get("snapshot_id") != current_snapshot_id:
                tracks_to_find.append(track_id)

        if tracks_to_find:
            logger.info(
                f"Found {len(tracks_to_find)} tracks with outdated snapshot_id for playlist {playlist_spotify_id}"
            )
            return True, tracks_to_find

        return False, []

    except Exception as e:
        logger.error(f"Error checking track sync status for {playlist_spotify_id}: {e}")
        # On error, assume sync is needed to be safe
        return True, []


def find_tracks_in_playlist(
    playlist_spotify_id: str, tracks_to_find: list[str], current_snapshot_id: str
) -> tuple[list, list]:
    """
    Progressively fetch playlist tracks until all specified tracks are found or playlist is exhausted.

    Args:
        playlist_spotify_id: The Spotify playlist ID
        tracks_to_find: List of track IDs to find
        current_snapshot_id: The current snapshot_id

    Returns:
        Tuple of (found_tracks, not_found_tracks) where:
        - found_tracks: List of track items that were found
        - not_found_tracks: List of track IDs that were not found
    """
    found_tracks = []
    not_found_tracks = tracks_to_find.copy()
    offset = 0
    limit = 100

    logger.info(
        f"Searching for {len(tracks_to_find)} tracks in playlist {playlist_spotify_id} starting from offset {offset}"
    )

    while not_found_tracks and offset < 10000:  # Safety limit
        try:
            tracks_batch = get_playlist_tracks(
                playlist_spotify_id, limit=limit, offset=offset
            )

            if not tracks_batch or "items" not in tracks_batch:
                logger.warning(
                    f"No tracks returned for playlist {playlist_spotify_id} at offset {offset}"
                )
                break

            batch_items = tracks_batch.get("items", [])
            if not batch_items:
                logger.info(f"No more tracks found at offset {offset}")
                break

            # Check each track in this batch
            for track_item in batch_items:
                track = track_item.get("track")
                if track and track.get("id") and not track.get("is_local"):
                    track_id = track["id"]
                    if track_id in not_found_tracks:
                        found_tracks.append(track_item)
                        not_found_tracks.remove(track_id)
                        logger.debug(f"Found track {track_id} at offset {offset}")

            offset += len(batch_items)

            # Add small delay between batches
            time.sleep(0.1)

        except Exception as e:
            logger.error(
                f"Error fetching tracks batch for playlist {playlist_spotify_id} at offset {offset}: {e}"
            )
            break

    logger.info(
        f"Track search complete for playlist {playlist_spotify_id}: "
        f"Found {len(found_tracks)}/{len(tracks_to_find)} tracks, "
        f"Not found: {len(not_found_tracks)}"
    )

    return found_tracks, not_found_tracks


def check_watched_playlists(specific_playlist_id: str = None):
    """Checks watched playlists for new tracks and queues downloads.
    If specific_playlist_id is provided, only that playlist is checked.
    """
    logger.info(
        f"Playlist Watch Manager: Starting check. Specific playlist: {specific_playlist_id or 'All'}"
    )
    config = get_watch_config()
    use_snapshot_checking = config.get("use_snapshot_id_checking", True)

    if specific_playlist_id:
        playlist_obj = get_watched_playlist(specific_playlist_id)
        if not playlist_obj:
            logger.error(
                f"Playlist Watch Manager: Playlist {specific_playlist_id} not found in watch database."
            )
            return
        watched_playlists_to_check = [playlist_obj]
    else:
        watched_playlists_to_check = get_watched_playlists()

    if not watched_playlists_to_check:
        logger.info("Playlist Watch Manager: No playlists to check.")
        return

    for playlist_in_db in watched_playlists_to_check:
        playlist_spotify_id = playlist_in_db["spotify_id"]
        playlist_name = playlist_in_db["name"]
        logger.info(
            f"Playlist Watch Manager: Checking playlist '{playlist_name}' ({playlist_spotify_id})..."
        )

        try:
            # Ensure the playlist's track table has the latest schema before processing
            ensure_playlist_table_schema(playlist_spotify_id)

            # First, get playlist metadata to check if it has changed
            current_playlist_metadata = get_playlist_metadata(playlist_spotify_id)
            if not current_playlist_metadata:
                logger.error(
                    f"Playlist Watch Manager: Failed to fetch metadata from Spotify for playlist {playlist_spotify_id}."
                )
                continue

            api_snapshot_id = current_playlist_metadata.get("snapshot_id")
            api_total_tracks = current_playlist_metadata.get("tracks", {}).get(
                "total", 0
            )

            # Enhanced snapshot_id checking with track-level tracking
            if use_snapshot_checking:
                # First check if playlist snapshot_id has changed
                playlist_changed = has_playlist_changed(
                    playlist_spotify_id, api_snapshot_id
                )

                if not playlist_changed:
                    # Even if playlist snapshot_id hasn't changed, check if individual tracks need sync
                    needs_sync, tracks_to_find = needs_track_sync(
                        playlist_spotify_id, api_snapshot_id, api_total_tracks
                    )

                    if not needs_sync:
                        logger.info(
                            f"Playlist Watch Manager: Playlist '{playlist_name}' ({playlist_spotify_id}) has not changed since last check (snapshot_id: {api_snapshot_id}). Skipping detailed check."
                        )
                        continue
                    else:
                        if not tracks_to_find:
                            # Empty tracks_to_find means full sync is needed (track count mismatch detected)
                            logger.info(
                                f"Playlist Watch Manager: Playlist '{playlist_name}' snapshot_id unchanged, but full sync needed due to track count mismatch. Proceeding with full check."
                            )
                            # Continue to full sync below
                        else:
                            logger.info(
                                f"Playlist Watch Manager: Playlist '{playlist_name}' snapshot_id unchanged, but {len(tracks_to_find)} tracks need sync. Proceeding with targeted check."
                            )
                            # Use targeted track search instead of full fetch
                            found_tracks, not_found_tracks = find_tracks_in_playlist(
                                playlist_spotify_id, tracks_to_find, api_snapshot_id
                            )

                            # Update found tracks with new snapshot_id
                            if found_tracks:
                                add_tracks_to_playlist_db(
                                    playlist_spotify_id, found_tracks, api_snapshot_id
                                )

                            # Mark not found tracks as removed
                            if not_found_tracks:
                                logger.info(
                                    f"Playlist Watch Manager: {len(not_found_tracks)} tracks not found in playlist '{playlist_name}'. Marking as removed."
                                )
                                mark_tracks_as_not_present_in_spotify(
                                    playlist_spotify_id, not_found_tracks
                                )

                                # Update the playlist's m3u file after tracks are removed
                                try:
                                    logger.info(
                                        f"Updating m3u file for playlist '{playlist_name}' after removing {len(not_found_tracks)} tracks."
                                    )
                                    update_playlist_m3u_file(playlist_spotify_id)
                                except Exception as m3u_update_err:
                                    logger.error(
                                        f"Failed to update m3u file for playlist '{playlist_name}' after marking tracks as removed: {m3u_update_err}",
                                        exc_info=True,
                                    )

                            # Update playlist snapshot and continue to next playlist
                            update_playlist_snapshot(
                                playlist_spotify_id, api_snapshot_id, api_total_tracks
                            )
                            logger.info(
                                f"Playlist Watch Manager: Finished targeted sync for playlist '{playlist_name}'. Snapshot ID updated to {api_snapshot_id}."
                            )
                            continue
                else:
                    logger.info(
                        f"Playlist Watch Manager: Playlist '{playlist_name}' has changed. New snapshot_id: {api_snapshot_id}. Proceeding with full check."
                    )
            else:
                logger.info(
                    f"Playlist Watch Manager: Snapshot checking disabled. Proceeding with full check for playlist '{playlist_name}'."
                )

            # Fetch all tracks using the optimized function
            # This happens when:
            # 1. Playlist snapshot_id has changed (full sync needed)
            # 2. Snapshot checking is disabled (full sync always)
            # 3. Database is empty but API has tracks (full sync needed)
            logger.info(
                f"Playlist Watch Manager: Fetching all tracks for playlist '{playlist_name}' ({playlist_spotify_id}) with {api_total_tracks} total tracks."
            )

            all_api_track_items = []
            offset = 0
            limit = 100  # Use maximum batch size for efficiency

            while offset < api_total_tracks:
                try:
                    # Use the optimized get_playlist_tracks function
                    tracks_batch = get_playlist_tracks(
                        playlist_spotify_id, limit=limit, offset=offset
                    )

                    if not tracks_batch or "items" not in tracks_batch:
                        logger.warning(
                            f"Playlist Watch Manager: No tracks returned for playlist {playlist_spotify_id} at offset {offset}"
                        )
                        break

                    batch_items = tracks_batch.get("items", [])
                    if not batch_items:
                        break

                    all_api_track_items.extend(batch_items)
                    offset += len(batch_items)

                    # Add small delay between batches to be respectful to API
                    if offset < api_total_tracks:
                        time.sleep(0.1)

                except Exception as e:
                    logger.error(
                        f"Playlist Watch Manager: Error fetching tracks batch for playlist {playlist_spotify_id} at offset {offset}: {e}"
                    )
                    break

            current_api_track_ids = set()
            api_track_id_to_item_map = {}
            for item in all_api_track_items:  # Use all_api_track_items
                track = item.get("track")
                if track and track.get("id") and not track.get("is_local"):
                    track_id = track["id"]
                    current_api_track_ids.add(track_id)
                    api_track_id_to_item_map[track_id] = item

            db_track_ids = get_playlist_track_ids_from_db(playlist_spotify_id)

            new_track_ids_for_download = current_api_track_ids - db_track_ids
            queued_for_download_count = 0
            if new_track_ids_for_download:
                logger.info(
                    f"Playlist Watch Manager: Found {len(new_track_ids_for_download)} new tracks for playlist '{playlist_name}' to download."
                )
                for track_id in new_track_ids_for_download:
                    api_item = api_track_id_to_item_map.get(track_id)
                    if not api_item or not api_item.get("track"):
                        logger.warning(
                            f"Playlist Watch Manager: Missing track details in API map for new track_id {track_id} in playlist {playlist_spotify_id}. Cannot queue."
                        )
                        continue

                    track_to_queue = api_item["track"]
                    task_payload = {
                        "download_type": "track",
                        "url": construct_spotify_url(track_id, "track"),
                        "name": track_to_queue.get("name", "Unknown Track"),
                        "artist": ", ".join(
                            [
                                a["name"]
                                for a in track_to_queue.get("artists", [])
                                if a.get("name")
                            ]
                        ),
                        "orig_request": {
                            "source": "playlist_watch",
                            "playlist_id": playlist_spotify_id,
                            "playlist_name": playlist_name,
                            "track_spotify_id": track_id,
                            "track_item_for_db": api_item,  # Pass full API item for DB update on completion
                        },
                        # "track_details_for_db" was old name, using track_item_for_db consistent with celery_tasks
                    }
                    try:
                        task_id_or_none = download_queue_manager.add_task(
                            task_payload, from_watch_job=True
                        )
                        if task_id_or_none:  # Task was newly queued
                            logger.info(
                                f"Playlist Watch Manager: Queued download task {task_id_or_none} for new track {track_id} ('{track_to_queue.get('name')}') from playlist '{playlist_name}'."
                            )
                            queued_for_download_count += 1
                        # If task_id_or_none is None, it was a duplicate and not re-queued, Celery manager handles logging.
                    except Exception as e:
                        logger.error(
                            f"Playlist Watch Manager: Failed to queue download for new track {track_id} from playlist '{playlist_name}': {e}",
                            exc_info=True,
                        )
                logger.info(
                    f"Playlist Watch Manager: Attempted to queue {queued_for_download_count} new tracks for playlist '{playlist_name}'."
                )
            else:
                logger.info(
                    f"Playlist Watch Manager: No new tracks to download for playlist '{playlist_name}'."
                )

            # Update DB for tracks that are still present in API (e.g. update 'last_seen_in_spotify')
            # add_tracks_to_playlist_db handles INSERT OR REPLACE, updating existing entries.
            # We should pass all current API tracks to ensure their `last_seen_in_spotify`, `is_present_in_spotify`, and `snapshot_id` are updated.
            if (
                all_api_track_items
            ):  # If there are any tracks in the API for this playlist
                logger.info(
                    f"Playlist Watch Manager: Refreshing {len(all_api_track_items)} tracks from API in local DB for playlist '{playlist_name}'."
                )
                add_tracks_to_playlist_db(
                    playlist_spotify_id, all_api_track_items, api_snapshot_id
                )

            removed_db_ids = db_track_ids - current_api_track_ids
            if removed_db_ids:
                logger.info(
                    f"Playlist Watch Manager: {len(removed_db_ids)} tracks removed from Spotify playlist '{playlist_name}'. Marking in DB."
                )
                mark_tracks_as_not_present_in_spotify(
                    playlist_spotify_id, list(removed_db_ids)
                )

            # Update the playlist's m3u file after any changes (new tracks queued or tracks removed)
            if new_track_ids_for_download or removed_db_ids:
                try:
                    logger.info(
                        f"Updating m3u file for playlist '{playlist_name}' after playlist changes."
                    )
                    update_playlist_m3u_file(playlist_spotify_id)
                except Exception as m3u_update_err:
                    logger.error(
                        f"Failed to update m3u file for playlist '{playlist_name}' after playlist changes: {m3u_update_err}",
                        exc_info=True,
                    )

            update_playlist_snapshot(
                playlist_spotify_id, api_snapshot_id, api_total_tracks
            )  # api_total_tracks from initial fetch
            logger.info(
                f"Playlist Watch Manager: Finished checking playlist '{playlist_name}'. Snapshot ID updated to {api_snapshot_id}. API Total Tracks: {api_total_tracks}. Queued {queued_for_download_count} new tracks."
            )

        except Exception as e:
            logger.error(
                f"Playlist Watch Manager: Error processing playlist {playlist_spotify_id}: {e}",
                exc_info=True,
            )

        time.sleep(max(1, config.get("delay_between_playlists_seconds", 2)))

    logger.info("Playlist Watch Manager: Finished checking all watched playlists.")


def check_watched_artists(specific_artist_id: str = None):
    """Checks watched artists for new albums and queues downloads."""
    logger.info(
        f"Artist Watch Manager: Starting check. Specific artist: {specific_artist_id or 'All'}"
    )
    config = get_watch_config()
    watched_album_groups = [
        g.lower() for g in config.get("watchedArtistAlbumGroup", ["album", "single"])
    ]
    logger.info(
        f"Artist Watch Manager: Watching for album groups: {watched_album_groups}"
    )

    if specific_artist_id:
        artist_obj_in_db = get_watched_artist(specific_artist_id)
        if not artist_obj_in_db:
            logger.error(
                f"Artist Watch Manager: Artist {specific_artist_id} not found in watch database."
            )
            return
        artists_to_check = [artist_obj_in_db]
    else:
        artists_to_check = get_watched_artists()

    if not artists_to_check:
        logger.info("Artist Watch Manager: No artists to check.")
        return

    for artist_in_db in artists_to_check:
        artist_spotify_id = artist_in_db["spotify_id"]
        artist_name = artist_in_db["name"]
        logger.info(
            f"Artist Watch Manager: Checking artist '{artist_name}' ({artist_spotify_id})..."
        )

        try:
            # Use the optimized artist discography function with pagination
            all_artist_albums_from_api: List[Dict[str, Any]] = []
            offset = 0
            limit = 50  # Spotify API limit for artist albums

            logger.info(
                f"Artist Watch Manager: Fetching albums for artist '{artist_name}' ({artist_spotify_id})"
            )

            while True:
                logger.debug(
                    f"Artist Watch Manager: Fetching albums for {artist_spotify_id}. Limit: {limit}, Offset: {offset}"
                )
                artist_albums_page = get_spotify_info(
                    artist_spotify_id, "artist_discography", limit=limit, offset=offset
                )

                if not artist_albums_page or not isinstance(
                    artist_albums_page.get("items"), list
                ):
                    logger.warning(
                        f"Artist Watch Manager: No album items found or invalid format for artist {artist_spotify_id} (name: '{artist_name}') at offset {offset}. Response: {artist_albums_page}"
                    )
                    break

                current_page_albums = artist_albums_page.get("items", [])
                if not current_page_albums:
                    logger.info(
                        f"Artist Watch Manager: No more albums on page for artist {artist_spotify_id} (name: '{artist_name}') at offset {offset}. Total fetched so far: {len(all_artist_albums_from_api)}."
                    )
                    break

                logger.debug(
                    f"Artist Watch Manager: Fetched {len(current_page_albums)} albums on current page for artist '{artist_name}'."
                )
                all_artist_albums_from_api.extend(current_page_albums)

                # Correct pagination: Check if Spotify indicates a next page URL
                # The `next` field in Spotify API responses is a URL to the next page or null.
                if artist_albums_page.get("next"):
                    offset += limit  # CORRECT: Increment offset by the limit used for the request
                else:
                    logger.info(
                        f"Artist Watch Manager: No 'next' page URL for artist '{artist_name}'. Pagination complete. Total albums fetched: {len(all_artist_albums_from_api)}."
                    )
                    break

            # total_albums_from_api = len(all_artist_albums_from_api)
            # Use the 'total' field from the API response for a more accurate count of all available albums (matching current API filter if any)
            api_reported_total_albums = (
                artist_albums_page.get("total", 0)
                if "artist_albums_page" in locals() and artist_albums_page
                else len(all_artist_albums_from_api)
            )
            logger.info(
                f"Artist Watch Manager: Fetched {len(all_artist_albums_from_api)} albums in total from API for artist '{artist_name}'. API reports total: {api_reported_total_albums}."
            )

            db_album_ids = get_artist_album_ids_from_db(artist_spotify_id)
            logger.info(
                f"Artist Watch Manager: Found {len(db_album_ids)} albums in DB for artist '{artist_name}'. These will be skipped if re-encountered unless logic changes."
            )

            queued_for_download_count = 0
            processed_album_ids_in_run = set()  # To avoid processing duplicate album_ids if API returns them across pages (should not happen with correct pagination)

            for album_data in all_artist_albums_from_api:
                album_id = album_data.get("id")
                album_name = album_data.get("name", "Unknown Album")
                album_group = album_data.get("album_group", "N/A").lower()
                album_type = album_data.get("album_type", "N/A").lower()

                if not album_id:
                    logger.warning(
                        f"Artist Watch Manager: Skipping album without ID for artist '{artist_name}'. Album data: {album_data}"
                    )
                    continue

                if album_id in processed_album_ids_in_run:
                    logger.debug(
                        f"Artist Watch Manager: Album '{album_name}' ({album_id}) already processed in this run. Skipping."
                    )
                    continue
                processed_album_ids_in_run.add(album_id)

                # Filter based on watchedArtistAlbumGroup
                # The album_group field is generally preferred for this type of categorization as per Spotify docs.
                is_matching_group = album_group in watched_album_groups

                logger.debug(
                    f"Artist '{artist_name}', Album '{album_name}' ({album_id}): album_group='{album_group}', album_type='{album_type}'. Watched groups: {watched_album_groups}. Match: {is_matching_group}."
                )

                if not is_matching_group:
                    logger.debug(
                        f"Artist Watch Manager: Skipping album '{album_name}' ({album_id}) by '{artist_name}' - group '{album_group}' not in watched list: {watched_album_groups}."
                    )
                    continue

                logger.info(
                    f"Artist Watch Manager: Album '{album_name}' ({album_id}) by '{artist_name}' (group: {album_group}) IS a matching group."
                )

                if album_id not in db_album_ids:
                    logger.info(
                        f"Artist Watch Manager: Found NEW matching album '{album_name}' ({album_id}) by '{artist_name}'. Queuing for download."
                    )

                    album_artists_list = album_data.get("artists", [])
                    album_main_artist_name = (
                        album_artists_list[0].get("name", "Unknown Artist")
                        if album_artists_list
                        else "Unknown Artist"
                    )

                    task_payload = {
                        "download_type": "album",  # Or "track" if downloading individual tracks of album later
                        "url": construct_spotify_url(album_id, "album"),
                        "name": album_name,
                        "artist": album_main_artist_name,  # Primary artist of the album
                        "orig_request": {
                            "source": "artist_watch",
                            "artist_spotify_id": artist_spotify_id,  # Watched artist
                            "artist_name": artist_name,
                            "album_spotify_id": album_id,
                            "album_data_for_db": album_data,  # Pass full API album object for DB update on completion/queuing
                        },
                    }
                    try:
                        # Add to DB first with task_id, then queue. Or queue and add task_id to DB.
                        # Let's use add_or_update_album_for_artist to record it with a task_id before queuing.
                        # The celery_queue_manager.add_task might return None if it's a duplicate.

                        # Record the album in DB as being processed for download
                        # Task_id will be added if successfully queued

                        # We should call add_task first, and if it returns a task_id (not a duplicate), then update our DB.
                        task_id_or_none = download_queue_manager.add_task(
                            task_payload, from_watch_job=True
                        )

                        if task_id_or_none:  # Task was newly queued
                            # REMOVED: add_or_update_album_for_artist(artist_spotify_id, album_data, task_id=task_id_or_none, is_download_complete=False)
                            # The album will be added/updated in the DB by celery_tasks.py upon successful download completion.
                            logger.info(
                                f"Artist Watch Manager: Queued download task {task_id_or_none} for new album '{album_name}' from artist '{artist_name}'. DB entry will be created/updated on success."
                            )
                            queued_for_download_count += 1
                        # If task_id_or_none is None, it was a duplicate. Celery manager handles logging.

                    except Exception as e:
                        logger.error(
                            f"Artist Watch Manager: Failed to queue download for new album {album_id} ('{album_name}') from artist '{artist_name}': {e}",
                            exc_info=True,
                        )
                else:
                    logger.info(
                        f"Artist Watch Manager: Album '{album_name}' ({album_id}) by '{artist_name}' already known in DB (ID found in db_album_ids). Skipping queue."
                    )
                    # Optionally, update its entry (e.g. last_seen, or if details changed), but for now, we only queue new ones.
                    # add_or_update_album_for_artist(artist_spotify_id, album_data, task_id=None, is_download_complete=False) # would update added_to_db_at

            logger.info(
                f"Artist Watch Manager: For artist '{artist_name}', processed {len(all_artist_albums_from_api)} API albums, attempted to queue {queued_for_download_count} new albums."
            )

            update_artist_metadata_after_check(
                artist_spotify_id, api_reported_total_albums
            )
            logger.info(
                f"Artist Watch Manager: Finished checking artist '{artist_name}'. DB metadata updated. API reported total albums (for API filter): {api_reported_total_albums}."
            )

        except Exception as e:
            logger.error(
                f"Artist Watch Manager: Error processing artist {artist_spotify_id} ('{artist_name}'): {e}",
                exc_info=True,
            )

        time.sleep(max(1, config.get("delay_between_artists_seconds", 5)))

    logger.info("Artist Watch Manager: Finished checking all watched artists.")


def playlist_watch_scheduler():
    """Periodically calls check_watched_playlists and check_watched_artists."""
    logger.info("Watch Scheduler: Thread started.")

    while not STOP_EVENT.is_set():
        current_config = get_watch_config()  # Get latest config for this run
        interval = current_config.get("watchPollIntervalSeconds", 3600)
        watch_enabled = current_config.get("enabled", False)  # Get enabled status

        if not watch_enabled:
            logger.info(
                "Watch Scheduler: Watch feature is disabled in config. Skipping checks."
            )
            STOP_EVENT.wait(
                interval
            )  # Still respect poll interval for checking config again
            continue  # Skip to next iteration

        try:
            logger.info("Watch Scheduler: Starting playlist check run.")
            check_watched_playlists()
            logger.info("Watch Scheduler: Playlist check run completed.")
        except Exception as e:
            logger.error(
                f"Watch Scheduler: Unhandled exception during check_watched_playlists: {e}",
                exc_info=True,
            )

        # Add a small delay between playlist and artist checks if desired
        # time.sleep(current_config.get("delay_between_check_types_seconds", 10))
        if STOP_EVENT.is_set():
            break  # Check stop event again before starting artist check

        try:
            logger.info("Watch Scheduler: Starting artist check run.")
            check_watched_artists()
            logger.info("Watch Scheduler: Artist check run completed.")
        except Exception as e:
            logger.error(
                f"Watch Scheduler: Unhandled exception during check_watched_artists: {e}",
                exc_info=True,
            )

        logger.info(
            f"Watch Scheduler: All checks complete. Next run in {interval} seconds."
        )
        STOP_EVENT.wait(interval)
    logger.info("Watch Scheduler: Thread stopped.")


# --- Global thread for the scheduler ---
_watch_scheduler_thread = None  # Renamed from _playlist_watch_thread


def start_watch_manager():  # Renamed from start_playlist_watch_manager
    global _watch_scheduler_thread
    if _watch_scheduler_thread is None or not _watch_scheduler_thread.is_alive():
        STOP_EVENT.clear()
        # Initialize DBs on start
        from routes.utils.watch.db import (
            init_playlists_db,
            init_artists_db,
        )  # Updated import

        init_playlists_db()  # For playlists
        init_artists_db()  # For artists

        # Update all existing tables to ensure they have the latest schema
        try:
            update_all_existing_tables_schema()
            logger.info(
                "Watch Manager: Successfully updated all existing tables schema"
            )
        except Exception as e:
            logger.error(
                f"Watch Manager: Error updating existing tables schema: {e}",
                exc_info=True,
            )

        _watch_scheduler_thread = threading.Thread(
            target=playlist_watch_scheduler, daemon=True
        )
        _watch_scheduler_thread.start()
        logger.info(
            "Watch Manager: Background scheduler started (includes playlists and artists)."
        )
    else:
        logger.info("Watch Manager: Background scheduler already running.")


def stop_watch_manager():  # Renamed from stop_playlist_watch_manager
    global _watch_scheduler_thread
    if _watch_scheduler_thread and _watch_scheduler_thread.is_alive():
        logger.info("Watch Manager: Stopping background scheduler...")
        STOP_EVENT.set()
        _watch_scheduler_thread.join(timeout=10)
        if _watch_scheduler_thread.is_alive():
            logger.warning("Watch Manager: Scheduler thread did not stop in time.")
        else:
            logger.info("Watch Manager: Background scheduler stopped.")
        _watch_scheduler_thread = None
    else:
        logger.info("Watch Manager: Background scheduler not running.")


def get_playlist_tracks_for_m3u(playlist_spotify_id: str) -> List[Dict[str, Any]]:
    """
    Get all tracks for a playlist from the database with complete metadata needed for m3u generation.

    Args:
        playlist_spotify_id: The Spotify playlist ID

    Returns:
        List of track dictionaries with metadata
    """
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    tracks: List[Dict[str, Any]] = []

    try:
        from routes.utils.watch.db import (
            _get_playlists_db_connection,
            _ensure_table_schema,
            EXPECTED_PLAYLIST_TRACKS_COLUMNS,
        )

        with _get_playlists_db_connection() as conn:
            cursor = conn.cursor()

            # Check if table exists
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                logger.warning(
                    f"Track table {table_name} does not exist. Cannot generate m3u file."
                )
                return tracks

            # Ensure the table has the latest schema before querying
            _ensure_table_schema(
                cursor,
                table_name,
                EXPECTED_PLAYLIST_TRACKS_COLUMNS,
                f"playlist tracks ({playlist_spotify_id})",
            )

            # Get all tracks that are present in Spotify
            cursor.execute(f"""
                SELECT spotify_track_id, title, artist_names, album_name,
                       album_artist_names, track_number, duration_ms
                FROM {table_name}
                WHERE is_present_in_spotify = 1
                ORDER BY track_number, title
            """)

            rows = cursor.fetchall()
            for row in rows:
                tracks.append(
                    {
                        "spotify_track_id": row["spotify_track_id"],
                        "title": row["title"] or "Unknown Track",
                        "artist_names": row["artist_names"] or "Unknown Artist",
                        "album_name": row["album_name"] or "Unknown Album",
                        "album_artist_names": row["album_artist_names"]
                        or "Unknown Artist",
                        "track_number": row["track_number"] or 0,
                        "duration_ms": row["duration_ms"] or 0,
                    }
                )

        return tracks

    except Exception as e:
        logger.error(
            f"Error retrieving tracks for m3u generation for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        return tracks


def generate_track_file_path(
    track: Dict[str, Any],
    custom_dir_format: str,
    custom_track_format: str,
    convert_to: str = None,
) -> str:
    """
    Generate the file path for a track based on custom format strings.
    This mimics the path generation logic used by the deezspot library.

    Args:
        track: Track metadata dictionary
        custom_dir_format: Directory format string (e.g., "%ar_album%/%album%")
        custom_track_format: Track format string (e.g., "%tracknum%. %music% - %artist%")
        convert_to: Target conversion format (e.g., "mp3", "flac", "m4a")

    Returns:
        Generated file path relative to output directory
    """
    try:
        # Extract metadata
        artist_names = track.get("artist_names", "Unknown Artist")
        album_name = track.get("album_name", "Unknown Album")
        album_artist_names = track.get("album_artist_names", "Unknown Artist")
        title = track.get("title", "Unknown Track")
        track_number = track.get("track_number", 0)
        duration_ms = track.get("duration_ms", 0)

        # Use album artist for directory structure, main artist for track name
        main_artist = artist_names.split(", ")[0] if artist_names else "Unknown Artist"
        album_artist = (
            album_artist_names.split(", ")[0] if album_artist_names else main_artist
        )

        # Clean names for filesystem
        def clean_name(name):
            # Remove or replace characters that are problematic in filenames
            name = re.sub(r'[<>:"/\\|?*]', "_", str(name))
            name = re.sub(r"[\x00-\x1f]", "", name)  # Remove control characters
            return name.strip()

        clean_album_artist = clean_name(album_artist)
        clean_album = clean_name(album_name)
        clean_main_artist = clean_name(main_artist)
        clean_title = clean_name(title)

        # Prepare placeholder replacements
        replacements = {
            # Common placeholders
            "%music%": clean_title,
            "%artist%": clean_main_artist,
            "%album%": clean_album,
            "%ar_album%": clean_album_artist,
            "%tracknum%": f"{track_number:02d}" if track_number > 0 else "00",
            "%year%": "",  # Not available in current DB schema
            # Additional placeholders (not available in current DB schema, using defaults)
            "%discnum%": "01",  # Default to disc 1
            "%date%": "",  # Not available
            "%genre%": "",  # Not available
            "%isrc%": "",  # Not available
            "%explicit%": "",  # Not available
            "%duration%": str(duration_ms // 1000)
            if duration_ms > 0
            else "0",  # Convert ms to seconds
        }

        # Apply replacements to directory format
        dir_path = custom_dir_format
        for placeholder, value in replacements.items():
            dir_path = dir_path.replace(placeholder, value)

        # Apply replacements to track format
        track_filename = custom_track_format
        for placeholder, value in replacements.items():
            track_filename = track_filename.replace(placeholder, value)

        # Combine and clean up path
        full_path = os.path.join(dir_path, track_filename)
        full_path = os.path.normpath(full_path)

        # Determine file extension based on convert_to setting or default to mp3
        if not any(
            full_path.lower().endswith(ext)
            for ext in [".mp3", ".flac", ".m4a", ".ogg", ".wav"]
        ):
            if convert_to:
                extension = AUDIO_FORMAT_EXTENSIONS.get(convert_to.lower(), ".mp3")
                full_path += extension
            else:
                full_path += ".mp3"  # Default fallback

        return full_path

    except Exception as e:
        logger.error(
            f"Error generating file path for track {track.get('title', 'Unknown')}: {e}"
        )
        # Return a fallback path with appropriate extension
        safe_title = re.sub(
            r'[<>:"/\\|?*\x00-\x1f]', "_", str(track.get("title", "Unknown Track"))
        )

        # Determine extension for fallback
        if convert_to:
            extension = AUDIO_FORMAT_EXTENSIONS.get(convert_to.lower(), ".mp3")
        else:
            extension = ".mp3"

        return f"Unknown Artist/Unknown Album/{safe_title}{extension}"


def update_playlist_m3u_file(playlist_spotify_id: str):
    """
    Generate/update the m3u file for a watched playlist based on tracks in the database.

    Args:
        playlist_spotify_id: The Spotify playlist ID
    """
    try:
        # Get playlist metadata
        playlist_info = get_watched_playlist(playlist_spotify_id)
        if not playlist_info:
            logger.warning(
                f"Playlist {playlist_spotify_id} not found in watched playlists. Cannot update m3u file."
            )
            return

        playlist_name = playlist_info.get("name", "Unknown Playlist")

        # Get configuration settings
        from routes.utils.celery_config import get_config_params

        config = get_config_params()

        custom_dir_format = config.get("customDirFormat", "%ar_album%/%album%")
        custom_track_format = config.get("customTrackFormat", "%tracknum%. %music%")
        convert_to = config.get("convertTo")  # Get conversion format setting
        output_dir = (
            "./downloads"  # This matches the output_dir used in download functions
        )

        # Get all tracks for the playlist
        tracks = get_playlist_tracks_for_m3u(playlist_spotify_id)

        if not tracks:
            logger.info(
                f"No tracks found for playlist '{playlist_name}'. M3U file will be empty or removed."
            )

        # Clean playlist name for filename
        safe_playlist_name = re.sub(
            r'[<>:"/\\|?*\x00-\x1f]', "_", playlist_name
        ).strip()

        # Create m3u file path
        playlists_dir = Path(output_dir) / "playlists"
        playlists_dir.mkdir(parents=True, exist_ok=True)
        m3u_file_path = playlists_dir / f"{safe_playlist_name}.m3u"

        # Generate m3u content
        m3u_lines = ["#EXTM3U"]

        for track in tracks:
            # Generate file path for this track
            track_file_path = generate_track_file_path(
                track, custom_dir_format, custom_track_format, convert_to
            )

            # Create relative path from m3u file location to track file
            # M3U file is in ./downloads/playlists/
            # Track files are in ./downloads/{custom_dir_format}/
            relative_path = os.path.join("..", track_file_path)
            relative_path = relative_path.replace(
                "\\", "/"
            )  # Use forward slashes for m3u compatibility

            # Add EXTINF line with track duration and title
            duration_seconds = (
                (track.get("duration_ms", 0) // 1000)
                if track.get("duration_ms")
                else -1
            )
            artist_and_title = f"{track.get('artist_names', 'Unknown Artist')} - {track.get('title', 'Unknown Track')}"

            m3u_lines.append(f"#EXTINF:{duration_seconds},{artist_and_title}")
            m3u_lines.append(relative_path)

        # Write m3u file
        with open(m3u_file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(m3u_lines))

        logger.info(
            f"Updated m3u file for playlist '{playlist_name}' at {m3u_file_path} with {len(tracks)} tracks{f' (format: {convert_to})' if convert_to else ''}."
        )

    except Exception as e:
        logger.error(
            f"Error updating m3u file for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
