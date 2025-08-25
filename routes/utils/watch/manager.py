import time
import threading
import logging
import json
import re
from pathlib import Path
from typing import Any, List, Dict, Optional

from routes.utils.watch.db import (
    get_watched_playlists,
    get_watched_playlist,
    get_playlist_track_ids_from_db,
    get_playlist_tracks_with_snapshot_from_db,
    get_playlist_total_tracks_from_db,
    add_tracks_to_playlist_db,
    update_playlist_snapshot,
    update_all_existing_tables_schema,
    ensure_playlist_table_schema,
    # Artist watch DB functions
    get_watched_artists,
    get_watched_artist,
    get_artist_album_ids_from_db,
    update_artist_metadata_after_check,  # Renamed from update_artist_metadata
    # New batch progress helpers
    get_playlist_batch_progress,
    set_playlist_batch_progress,
    get_artist_batch_next_offset,
    set_artist_batch_next_offset,
)
from routes.utils.get_info import (
    get_spotify_info,
    get_playlist_metadata,
    get_playlist_tracks,
)  # To fetch playlist, track, artist, and album details
from routes.utils.celery_queue_manager import download_queue_manager

# Added import to fetch base formatting config
from routes.utils.celery_queue_manager import get_config_params

logger = logging.getLogger(__name__)
MAIN_CONFIG_FILE_PATH = Path("./data/config/main.json")
WATCH_OLD_FILE_PATH = Path("./data/config/watch.json")
STOP_EVENT = threading.Event()


DEFAULT_WATCH_CONFIG = {
    "enabled": False,
    "watchPollIntervalSeconds": 3600,
    "maxTracksPerRun": 50,
    "watchedArtistAlbumGroup": ["album", "single"],
    "delayBetweenPlaylistsSeconds": 2,
    "delayBetweenArtistsSeconds": 5,
    "useSnapshotIdChecking": True,
    "maxItemsPerRun": 50,
}

# Round-robin index for one-item-per-interval scheduling
_round_robin_index = 0

# Per-item locks to ensure only one run processes a given item at a time
_playlist_locks: Dict[str, threading.RLock] = {}
_artist_locks: Dict[str, threading.RLock] = {}
_locks_guard = threading.RLock()


def _get_playlist_lock(playlist_spotify_id: str) -> threading.RLock:
    with _locks_guard:
        lock = _playlist_locks.get(playlist_spotify_id)
        if lock is None:
            lock = threading.RLock()
            _playlist_locks[playlist_spotify_id] = lock
        return lock


def _get_artist_lock(artist_spotify_id: str) -> threading.RLock:
    with _locks_guard:
        lock = _artist_locks.get(artist_spotify_id)
        if lock is None:
            lock = threading.RLock()
            _artist_locks[artist_spotify_id] = lock
        return lock


def get_watch_config():
    """Loads the watch configuration from main.json's 'watch' key (camelCase).
    Applies defaults and migrates legacy snake_case keys if found.
    """
    try:
        MAIN_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not MAIN_CONFIG_FILE_PATH.exists():
            # Create main config with default watch block
            with open(MAIN_CONFIG_FILE_PATH, "w") as f:
                json.dump({"watch": DEFAULT_WATCH_CONFIG}, f, indent=2)
            return DEFAULT_WATCH_CONFIG.copy()

        with open(MAIN_CONFIG_FILE_PATH, "r") as f:
            main_cfg = json.load(f) or {}

        watch_cfg = main_cfg.get("watch", {}) or {}

        # Detect legacy watch.json and migrate it into main.json's watch key
        legacy_file_found = False
        legacy_migrated_ok = False
        if WATCH_OLD_FILE_PATH.exists():
            try:
                with open(WATCH_OLD_FILE_PATH, "r") as wf:
                    legacy_watch = json.load(wf) or {}
                # Map legacy snake_case keys to camelCase
                legacy_to_camel_watch = {
                    "enabled": "enabled",
                    "watchPollIntervalSeconds": "watchPollIntervalSeconds",
                    "watch_poll_interval_seconds": "watchPollIntervalSeconds",
                    "watchedArtistAlbumGroup": "watchedArtistAlbumGroup",
                    "watched_artist_album_group": "watchedArtistAlbumGroup",
                    "delay_between_playlists_seconds": "delayBetweenPlaylistsSeconds",
                    "delay_between_artists_seconds": "delayBetweenArtistsSeconds",
                    "use_snapshot_id_checking": "useSnapshotIdChecking",
                    "max_tracks_per_run": "maxItemsPerRun",
                    "max_items_per_run": "maxItemsPerRun",
                }
                migrated_watch = {}
                for k, v in legacy_watch.items():
                    target_key = legacy_to_camel_watch.get(k, k)
                    migrated_watch[target_key] = v
                # Merge with existing watch (legacy overrides existing)
                watch_cfg.update(migrated_watch)
                migrated = True
                legacy_file_found = True
                legacy_migrated_ok = True
            except Exception as le:
                logger.error(
                    f"Failed to migrate legacy watch.json: {le}", exc_info=True
                )

        # Migration: map legacy keys inside watch block if present
        # Keep camelCase names in memory
        legacy_to_camel = {
            "watch_poll_interval_seconds": "watchPollIntervalSeconds",
            "watched_artist_album_group": "watchedArtistAlbumGroup",
            "delay_between_playlists_seconds": "delayBetweenPlaylistsSeconds",
            "delay_between_artists_seconds": "delayBetweenArtistsSeconds",
            "use_snapshot_id_checking": "useSnapshotIdChecking",
            "max_tracks_per_run": "maxItemsPerRun",
            "max_items_per_run": "maxItemsPerRun",
        }
        migrated = False
        for legacy_key, camel_key in legacy_to_camel.items():
            if legacy_key in watch_cfg and camel_key not in watch_cfg:
                watch_cfg[camel_key] = watch_cfg.pop(legacy_key)
                migrated = True

        # Additional migration: if maxTracksPerRun exists but maxItemsPerRun does not, promote it
        if "maxTracksPerRun" in watch_cfg and "maxItemsPerRun" not in watch_cfg:
            watch_cfg["maxItemsPerRun"] = watch_cfg.get("maxTracksPerRun")
            migrated = True

        # Ensure defaults
        for k, v in DEFAULT_WATCH_CONFIG.items():
            if k not in watch_cfg:
                watch_cfg[k] = v

        # Enforce range for maxItemsPerRun (1..50)
        try:
            current_value = int(
                watch_cfg.get("maxItemsPerRun", DEFAULT_WATCH_CONFIG["maxItemsPerRun"])
            )
        except Exception:
            current_value = DEFAULT_WATCH_CONFIG["maxItemsPerRun"]
        clamped_value = (
            1 if current_value < 1 else (50 if current_value > 50 else current_value)
        )
        if clamped_value != watch_cfg.get("maxItemsPerRun"):
            watch_cfg["maxItemsPerRun"] = clamped_value
            migrated = True

        if migrated or legacy_file_found:
            # Persist migration back to main.json
            main_cfg["watch"] = watch_cfg
            with open(MAIN_CONFIG_FILE_PATH, "w") as f:
                json.dump(main_cfg, f, indent=2)

            # Rename legacy file to avoid re-migration next start
            if legacy_file_found and legacy_migrated_ok:
                try:
                    WATCH_OLD_FILE_PATH.rename(
                        WATCH_OLD_FILE_PATH.with_suffix(".migrated")
                    )
                    logger.info(
                        f"Legacy watch.json migrated and renamed to {WATCH_OLD_FILE_PATH.with_suffix('.migrated')}"
                    )
                except Exception:
                    try:
                        WATCH_OLD_FILE_PATH.unlink()
                        logger.info("Legacy watch.json migrated and removed.")
                    except Exception:
                        pass

        return watch_cfg
    except Exception as e:
        logger.error(
            f"Error loading watch config from {MAIN_CONFIG_FILE_PATH}: {e}",
            exc_info=True,
        )
        return DEFAULT_WATCH_CONFIG.copy()


def construct_spotify_url(item_id, item_type="track"):
    return f"https://open.spotify.com/{item_type}/{item_id}"


# Helper to replace playlist placeholders in custom formats per-track
def _apply_playlist_placeholders(
    base_dir_fmt: str,
    base_track_fmt: str,
    playlist_name: str,
    playlist_position_one_based: int,
    total_tracks_in_playlist: int,
    pad_tracks: bool,
) -> tuple[str, str]:
    try:
        width = max(2, len(str(total_tracks_in_playlist))) if pad_tracks else 0
        if (
            pad_tracks
            and playlist_position_one_based is not None
            and playlist_position_one_based > 0
        ):
            playlist_num_str = str(playlist_position_one_based).zfill(width)
        else:
            playlist_num_str = (
                str(playlist_position_one_based) if playlist_position_one_based else ""
            )

        dir_fmt = base_dir_fmt.replace("%playlist%", playlist_name)
        track_fmt = base_track_fmt.replace("%playlist%", playlist_name).replace(
            "%playlistnum%", playlist_num_str
        )
        return dir_fmt, track_fmt
    except Exception:
        # On any error, return originals
        return base_dir_fmt, base_track_fmt


def has_playlist_changed(
    playlist_spotify_id: str, current_snapshot_id: Optional[str]
) -> bool:
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
    playlist_spotify_id: str, current_snapshot_id: Optional[str], api_total_tracks: int
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
    # Use configured max items per run for pagination (Spotify max 50)
    try:
        cfg = get_watch_config()
        limit = max(1, min(int(cfg.get("maxItemsPerRun", 50)), 50))
    except Exception:
        limit = 50

    logger.info(
        f"Searching for {len(tracks_to_find)} tracks in playlist {playlist_spotify_id} starting from offset {offset} with limit {limit}"
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


def check_watched_playlists(specific_playlist_id: Optional[str] = None):
    """Checks watched playlists for new tracks and queues downloads.
    If specific_playlist_id is provided, only that playlist is checked.
    Processes at most one batch per run (offset advanced between runs) to avoid rate limits.
    """
    logger.info(
        f"Playlist Watch Manager: Starting check. Specific playlist: {specific_playlist_id or 'All'}"
    )
    config = get_watch_config()
    use_snapshot_checking = config.get("useSnapshotIdChecking", True)
    # Fetch base formatting configuration once for this run
    formatting_cfg = get_config_params()
    base_dir_fmt = formatting_cfg.get("customDirFormat", "%ar_album%/%album%")
    base_track_fmt = formatting_cfg.get("customTrackFormat", "%tracknum%. %music%")
    pad_tracks = formatting_cfg.get("tracknumPadding", True)
    # Determine pagination limit for this run
    try:
        batch_limit = max(1, min(int(config.get("maxItemsPerRun", 50)), 50))
    except Exception:
        batch_limit = 50

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
        playlist_lock = _get_playlist_lock(playlist_spotify_id)
        logger.debug(
            f"Playlist Watch Manager: Waiting for lock on playlist {playlist_spotify_id}..."
        )
        with playlist_lock:
            logger.debug(
                f"Playlist Watch Manager: Acquired lock for playlist {playlist_spotify_id}."
            )
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
                else:
                    playlist_changed = True  # Force full check

                # Determine if we need a full multi-run sync
                needs_full_sync = False
                if playlist_changed:
                    needs_full_sync = True
                else:
                    # Even if playlist snapshot_id hasn't changed, check if individual tracks need sync
                    needs_sync, tracks_to_find = needs_track_sync(
                        playlist_spotify_id, api_snapshot_id, api_total_tracks
                    )
                    if not needs_sync:
                        logger.info(
                            f"Playlist Watch Manager: Playlist '{playlist_name}' ({playlist_spotify_id}) unchanged (snapshot {api_snapshot_id}). Skipping."
                        )
                        continue
                    else:
                        if not tracks_to_find:
                            # Track count mismatch → treat as full sync
                            needs_full_sync = True
                        else:
                            # Targeted sync required. To avoid rate limits, process only one page this run.
                            logger.info(
                                f"Playlist Watch Manager: Targeted sync for '{playlist_name}' with {len(tracks_to_find)} tracks needing update. Processing one page (limit={batch_limit})."
                            )
                            # Use one-page scan to try find some of the tracks
                            progress_offset, _ = get_playlist_batch_progress(
                                playlist_spotify_id
                            )
                            tracks_batch = get_playlist_tracks(
                                playlist_spotify_id,
                                limit=batch_limit,
                                offset=progress_offset,
                            )
                            batch_items = (
                                tracks_batch.get("items", []) if tracks_batch else []
                            )
                            found_tracks = []
                            remaining_to_find = set(tracks_to_find)
                            for item in batch_items:
                                track = item.get("track")
                                if (
                                    track
                                    and track.get("id")
                                    and track["id"] in remaining_to_find
                                    and not track.get("is_local")
                                ):
                                    found_tracks.append(item)
                                    remaining_to_find.remove(track["id"])
                            if found_tracks:
                                add_tracks_to_playlist_db(
                                    playlist_spotify_id, found_tracks, api_snapshot_id
                                )
                            # Advance offset for next run
                            next_offset = progress_offset + len(batch_items)
                            if batch_items and next_offset < api_total_tracks:
                                set_playlist_batch_progress(
                                    playlist_spotify_id, next_offset, None
                                )
                                logger.info(
                                    f"Playlist Watch Manager: Targeted sync processed page (offset {progress_offset}, size {len(batch_items)}). Next offset set to {next_offset}."
                                )
                            else:
                                # End of scan cycle for targeted mode; reset progress cursor
                                set_playlist_batch_progress(
                                    playlist_spotify_id, 0, None
                                )
                                logger.info(
                                    "Playlist Watch Manager: Targeted sync reached end of playlist. Resetting scan offset to 0."
                                )
                            # Do not update playlist snapshot here; only when full sync finishes
                            continue

                if needs_full_sync:
                    # Multi-run full sync: process only one batch per run
                    progress_offset, processing_snapshot = get_playlist_batch_progress(
                        playlist_spotify_id
                    )
                    # If processing a new snapshot or no processing snapshot recorded, start from offset 0
                    if (
                        not processing_snapshot
                        or processing_snapshot != api_snapshot_id
                        or progress_offset >= api_total_tracks
                    ):
                        progress_offset = 0
                        set_playlist_batch_progress(
                            playlist_spotify_id, 0, api_snapshot_id
                        )
                        logger.info(
                            f"Playlist Watch Manager: Starting/Resetting full sync for '{playlist_name}' snapshot {api_snapshot_id}."
                        )

                    logger.info(
                        f"Playlist Watch Manager: Fetching one batch (limit={batch_limit}, offset={progress_offset}) for playlist '{playlist_name}'."
                    )
                    tracks_batch = get_playlist_tracks(
                        playlist_spotify_id, limit=batch_limit, offset=progress_offset
                    )
                    batch_items = tracks_batch.get("items", []) if tracks_batch else []

                    # Build quick lookup for new tracks vs DB
                    db_track_ids = get_playlist_track_ids_from_db(playlist_spotify_id)
                    queued_for_download_count = 0
                    for item in batch_items:
                        track = item.get("track")
                        if not track or not track.get("id") or track.get("is_local"):
                            continue
                        track_id = track["id"]
                        if track_id not in db_track_ids:
                            # Compute per-track formatting overrides
                            position_in_playlist = None  # Unknown without full context; use None so %playlistnum% resolves to '' or basic padding
                            custom_dir_format, custom_track_format = (
                                _apply_playlist_placeholders(
                                    base_dir_fmt,
                                    base_track_fmt,
                                    playlist_name,
                                    position_in_playlist if position_in_playlist else 0,
                                    api_total_tracks,
                                    pad_tracks,
                                )
                            )
                            task_payload = {
                                "download_type": "track",
                                "url": construct_spotify_url(track_id, "track"),
                                "name": track.get("name", "Unknown Track"),
                                "artist": ", ".join(
                                    [
                                        a["name"]
                                        for a in track.get("artists", [])
                                        if a.get("name")
                                    ]
                                ),
                                "orig_request": {
                                    "source": "playlist_watch",
                                    "playlist_id": playlist_spotify_id,
                                    "playlist_name": playlist_name,
                                    "track_spotify_id": track_id,
                                    "track_item_for_db": item,
                                },
                                "custom_dir_format": custom_dir_format,
                                "custom_track_format": custom_track_format,
                            }
                            try:
                                task_id_or_none = download_queue_manager.add_task(
                                    task_payload, from_watch_job=True
                                )
                                if task_id_or_none:
                                    queued_for_download_count += 1
                            except Exception as e:
                                logger.error(
                                    f"Playlist Watch Manager: Failed to queue download for track {track_id} from playlist '{playlist_name}': {e}",
                                    exc_info=True,
                                )

                    # Refresh/mark present for items in this batch
                    if batch_items:
                        add_tracks_to_playlist_db(
                            playlist_spotify_id, batch_items, api_snapshot_id
                        )

                    # Advance or finalize progress
                    next_offset = progress_offset + len(batch_items)
                    if batch_items and next_offset < api_total_tracks:
                        set_playlist_batch_progress(
                            playlist_spotify_id, next_offset, api_snapshot_id
                        )
                        logger.info(
                            f"Playlist Watch Manager: Processed batch size {len(batch_items)} at offset {progress_offset}. Next offset {next_offset}."
                        )
                        # Do not update snapshot yet; continue next run
                    else:
                        # Finished this snapshot's full sync
                        set_playlist_batch_progress(playlist_spotify_id, 0, None)
                        update_playlist_snapshot(
                            playlist_spotify_id, api_snapshot_id, api_total_tracks
                        )
                        logger.info(
                            f"Playlist Watch Manager: Full sync completed for '{playlist_name}'. Snapshot updated to {api_snapshot_id}."
                        )
                        # Optionally update m3u at the end
                        try:
                            update_playlist_m3u_file(playlist_spotify_id)
                        except Exception as m3u_update_err:
                            logger.error(
                                f"Failed to update m3u file for playlist '{playlist_name}' after full sync: {m3u_update_err}",
                                exc_info=True,
                            )

            except Exception as e:
                logger.error(
                    f"Playlist Watch Manager: Error processing playlist {playlist_spotify_id}: {e}",
                    exc_info=True,
                )

        # Only sleep between items when running a batch (no specific ID)
        if not specific_playlist_id:
            time.sleep(max(1, config.get("delayBetweenPlaylistsSeconds", 2)))

    logger.info("Playlist Watch Manager: Finished checking all watched playlists.")


def check_watched_artists(specific_artist_id: Optional[str] = None):
    """Checks watched artists for new albums and queues downloads. Processes one page per run to avoid rate limits."""
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
    # Determine pagination limit for artist albums (Spotify max 50)
    try:
        artist_batch_limit = max(1, min(int(config.get("maxItemsPerRun", 50)), 50))
    except Exception:
        artist_batch_limit = 50

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
        artist_lock = _get_artist_lock(artist_spotify_id)
        logger.debug(
            f"Artist Watch Manager: Waiting for lock on artist {artist_spotify_id}..."
        )
        with artist_lock:
            logger.debug(
                f"Artist Watch Manager: Acquired lock for artist {artist_spotify_id}."
            )
            logger.info(
                f"Artist Watch Manager: Checking artist '{artist_name}' ({artist_spotify_id})..."
            )

            try:
                # One page per run
                offset = get_artist_batch_next_offset(artist_spotify_id)
                limit = artist_batch_limit
                logger.debug(
                    f"Artist Watch Manager: Fetching albums for {artist_spotify_id}. Limit: {limit}, Offset: {offset}"
                )
                artist_albums_page = get_spotify_info(
                    artist_spotify_id, "artist_discography", limit=limit, offset=offset
                )

                current_page_albums = (
                    artist_albums_page.get("items", [])
                    if artist_albums_page
                    and isinstance(artist_albums_page.get("items"), list)
                    else []
                )
                api_reported_total_albums = (
                    artist_albums_page.get("total", 0) if artist_albums_page else 0
                )

                db_album_ids = get_artist_album_ids_from_db(artist_spotify_id)
                queued_for_download_count = 0
                processed_album_ids_in_run = set()

                for album_data in current_page_albums:
                    album_id = album_data.get("id")
                    if not album_id:
                        continue
                    if album_id in processed_album_ids_in_run:
                        continue
                    processed_album_ids_in_run.add(album_id)

                    album_group = album_data.get("album_group", "N/A").lower()
                    if album_group not in watched_album_groups:
                        continue

                    if album_id not in db_album_ids:
                        album_name = album_data.get("name", "Unknown Album")
                        album_artists_list = album_data.get("artists", [])
                        album_main_artist_name = (
                            album_artists_list[0].get("name", "Unknown Artist")
                            if album_artists_list
                            else "Unknown Artist"
                        )
                        task_payload = {
                            "download_type": "album",
                            "url": construct_spotify_url(album_id, "album"),
                            "name": album_name,
                            "artist": album_main_artist_name,
                            "orig_request": {
                                "source": "artist_watch",
                                "artist_spotify_id": artist_spotify_id,
                                "artist_name": artist_name,
                                "album_spotify_id": album_id,
                                "album_data_for_db": album_data,
                            },
                        }
                        try:
                            task_id_or_none = download_queue_manager.add_task(
                                task_payload, from_watch_job=True
                            )
                            if task_id_or_none:
                                queued_for_download_count += 1
                        except Exception as e:
                            logger.error(
                                f"Artist Watch Manager: Failed to queue download for new album {album_id} ('{album_name}') from artist '{artist_name}': {e}",
                                exc_info=True,
                            )

                # Advance offset or finalize
                if artist_albums_page and artist_albums_page.get("next"):
                    next_offset = offset + len(current_page_albums)
                    set_artist_batch_next_offset(artist_spotify_id, next_offset)
                    logger.info(
                        f"Artist Watch Manager: Processed page size {len(current_page_albums)} at offset {offset}. Next offset {next_offset}."
                    )
                else:
                    set_artist_batch_next_offset(artist_spotify_id, 0)
                    update_artist_metadata_after_check(
                        artist_spotify_id, api_reported_total_albums
                    )
                    logger.info(
                        f"Artist Watch Manager: Completed discography scan for '{artist_name}'. Metadata updated."
                    )

            except Exception as e:
                logger.error(
                    f"Artist Watch Manager: Error processing artist {artist_spotify_id} ('{artist_name}'): {e}",
                    exc_info=True,
                )

        # Only sleep between items when running a batch (no specific ID)
        if not specific_artist_id:
            time.sleep(max(1, config.get("delayBetweenArtistsSeconds", 5)))

    logger.info("Artist Watch Manager: Finished checking all watched artists.")


def playlist_watch_scheduler():
    """Periodically checks one watched item (playlist or artist) per interval in round-robin order."""
    logger.info("Watch Scheduler: Thread started.")
    global _round_robin_index

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

        # Build the current list of items to watch (playlists and artists)
        try:
            playlists_list = get_watched_playlists() or []
            recorded_playlists = [("playlist", p["spotify_id"]) for p in playlists_list]
            artists_list = get_watched_artists() or []
            recorded_artists = [("artist", a["spotify_id"]) for a in artists_list]
            all_items = recorded_playlists + recorded_artists
        except Exception as e:
            logger.error(
                f"Watch Scheduler: Failed to build items list: {e}", exc_info=True
            )
            all_items = []

        if not all_items:
            logger.info(
                "Watch Scheduler: No watched playlists or artists. Waiting for next interval."
            )
            STOP_EVENT.wait(interval)
            continue

        # Pick the next item in round-robin order
        index = _round_robin_index % len(all_items)
        item_type, item_id = all_items[index]
        _round_robin_index += 1

        try:
            if item_type == "playlist":
                logger.info(
                    f"Watch Scheduler: Checking next playlist {item_id} (index {index})."
                )
                check_watched_playlists(specific_playlist_id=item_id)
            elif item_type == "artist":
                logger.info(
                    f"Watch Scheduler: Checking next artist {item_id} (index {index})."
                )
                check_watched_artists(specific_artist_id=item_id)
            else:
                logger.warning(
                    f"Watch Scheduler: Unknown item type '{item_type}' for id '{item_id}'. Skipping."
                )
        except Exception as e:
            logger.error(
                f"Watch Scheduler: Unhandled exception during item check ({item_type}:{item_id}): {e}",
                exc_info=True,
            )

        logger.info(
            f"Watch Scheduler: One-item check complete. Next run in {interval} seconds."
        )
        STOP_EVENT.wait(interval)
    logger.info("Watch Scheduler: Thread stopped.")


def run_playlist_check_over_intervals(playlist_spotify_id: str) -> None:
    """Run checks for a specific playlist over repeated intervals until sync completes.
    Spreads batches across watchPollInterval to avoid rate limits.
    """
    logger.info(
        f"Manual Playlist Runner: Starting interval-based sync for playlist {playlist_spotify_id}."
    )
    while not STOP_EVENT.is_set():
        try:
            check_watched_playlists(specific_playlist_id=playlist_spotify_id)
            # Determine if we are done: no active processing snapshot and no pending sync
            cfg = get_watch_config()
            interval = cfg.get("watchPollIntervalSeconds", 3600)
            metadata = get_playlist_metadata(playlist_spotify_id)
            if not metadata:
                logger.warning(
                    f"Manual Playlist Runner: Could not load metadata for {playlist_spotify_id}. Stopping."
                )
                break
            api_snapshot_id = metadata.get("snapshot_id")
            total = metadata.get("tracks", {}).get("total", 0)
            progress_offset, processing_snapshot = get_playlist_batch_progress(
                playlist_spotify_id
            )
            needs_sync, _ = needs_track_sync(
                playlist_spotify_id, api_snapshot_id, total
            )
            if processing_snapshot is None and not needs_sync:
                logger.info(
                    f"Manual Playlist Runner: Sync complete for playlist {playlist_spotify_id}."
                )
                break
            logger.info(
                f"Manual Playlist Runner: Waiting {interval}s before next batch for playlist {playlist_spotify_id}."
            )
            if STOP_EVENT.wait(interval):
                break
        except Exception as e:
            logger.error(
                f"Manual Playlist Runner: Error during interval sync for {playlist_spotify_id}: {e}",
                exc_info=True,
            )
            break
    logger.info(f"Manual Playlist Runner: Finished for playlist {playlist_spotify_id}.")


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
				       album_artist_names, track_number, duration_ms, final_path
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
                        "final_path": row["final_path"]
                        if "final_path" in row.keys()
                        else None,
                    }
                )

        return tracks

    except Exception as e:
        logger.error(
            f"Error retrieving tracks for m3u generation for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        return tracks


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
        included_count = 0
        skipped_missing_final_path = 0

        for track in tracks:
            # Use final_path from deezspot summary and convert from ./downloads to ../ relative path
            final_path = track.get("final_path")
            if not final_path:
                skipped_missing_final_path += 1
                continue
            normalized = str(final_path).replace("\\", "/")
            if normalized.startswith("./downloads/"):
                relative_path = normalized.replace("./downloads/", "../", 1)
            elif "/downloads/" in normalized.lower():
                idx = normalized.lower().rfind("/downloads/")
                relative_path = "../" + normalized[idx + len("/downloads/") :]
            elif normalized.startswith("downloads/"):
                relative_path = "../" + normalized[len("downloads/") :]
            else:
                # As per assumption, everything is under downloads; if not, keep as-is
                relative_path = normalized

            # Add EXTINF line with track duration and title
            duration_seconds = (
                (track.get("duration_ms", 0) // 1000)
                if track.get("duration_ms")
                else -1
            )
            artist_and_title = f"{track.get('artist_names', 'Unknown Artist')} - {track.get('title', 'Unknown Track')}"

            m3u_lines.append(f"#EXTINF:{duration_seconds},{artist_and_title}")
            m3u_lines.append(relative_path)
            included_count += 1

        # Write m3u file
        with open(m3u_file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(m3u_lines))

        logger.info(
            f"Updated m3u file for playlist '{playlist_name}' at {m3u_file_path} with {included_count} entries.{f' Skipped {skipped_missing_final_path} without final_path.' if skipped_missing_final_path else ''}"
        )

    except Exception as e:
        logger.error(
            f"Error updating m3u file for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
