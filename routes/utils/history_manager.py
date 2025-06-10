import sqlite3
import json
import time
import logging
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

HISTORY_DIR = Path("./data/history")
HISTORY_DB_FILE = HISTORY_DIR / "download_history.db"

EXPECTED_COLUMNS = {
    "task_id": "TEXT PRIMARY KEY",
    "download_type": "TEXT",
    "item_name": "TEXT",
    "item_artist": "TEXT",
    "item_album": "TEXT",
    "item_url": "TEXT",
    "spotify_id": "TEXT",
    "status_final": "TEXT",  # 'COMPLETED', 'ERROR', 'CANCELLED'
    "error_message": "TEXT",
    "timestamp_added": "REAL",
    "timestamp_completed": "REAL",
    "original_request_json": "TEXT",
    "last_status_obj_json": "TEXT",
    "service_used": "TEXT",
    "quality_profile": "TEXT",
    "convert_to": "TEXT",
    "bitrate": "TEXT",
    "parent_task_id": "TEXT",  # Reference to parent task for individual tracks
    "track_status": "TEXT",    # 'SUCCESSFUL', 'SKIPPED', 'FAILED'
    "summary_json": "TEXT",    # JSON string of the summary object from task
    "total_successful": "INTEGER", # Count of successful tracks
    "total_skipped": "INTEGER",   # Count of skipped tracks
    "total_failed": "INTEGER",    # Count of failed tracks
}


def init_history_db():
    """Initializes the download history database, creates the table if it doesn't exist,
    and adds any missing columns to an existing table."""
    conn = None
    try:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()

        # Create table if it doesn't exist (idempotent)
        # The primary key constraint is handled by the initial CREATE TABLE.
        # If 'task_id' is missing, it cannot be added as PRIMARY KEY to an existing table
        # without complex migrations. We assume 'task_id' will exist if the table exists.
        create_table_sql = """
            CREATE TABLE IF NOT EXISTS download_history (
                task_id TEXT PRIMARY KEY,
                download_type TEXT,
                item_name TEXT,
                item_artist TEXT,
                item_album TEXT,
                item_url TEXT,
                spotify_id TEXT,
                status_final TEXT,
                error_message TEXT,
                timestamp_added REAL,
                timestamp_completed REAL,
                original_request_json TEXT,
                last_status_obj_json TEXT,
                service_used TEXT,
                quality_profile TEXT,
                convert_to TEXT,
                bitrate TEXT,
                parent_task_id TEXT,
                track_status TEXT,
                summary_json TEXT,
                total_successful INTEGER,
                total_skipped INTEGER,
                total_failed INTEGER
            )
        """
        cursor.execute(create_table_sql)
        conn.commit()

        # Check for missing columns and add them
        cursor.execute("PRAGMA table_info(download_history)")
        existing_columns_info = cursor.fetchall()
        existing_column_names = {col[1] for col in existing_columns_info}

        added_columns = False
        for col_name, col_type in EXPECTED_COLUMNS.items():
            if col_name not in existing_column_names:
                if "PRIMARY KEY" in col_type.upper() and col_name == "task_id":
                    # This case should be handled by CREATE TABLE, but as a safeguard:
                    # If task_id is somehow missing and table exists, this is a problem.
                    # Adding it as PK here is complex and might fail if data exists.
                    # For now, we assume CREATE TABLE handles the PK.
                    # If we were to add it, it would be 'ALTER TABLE download_history ADD COLUMN task_id TEXT;'
                    # and then potentially a separate step to make it PK if table is empty, which is non-trivial.
                    logger.warning(
                        f"Column '{col_name}' is part of PRIMARY KEY and was expected to be created by CREATE TABLE. Skipping explicit ADD COLUMN."
                    )
                    continue

                # For other columns, just add them.
                # Remove PRIMARY KEY from type definition if present, as it's only for table creation.
                col_type_for_add = col_type.replace(" PRIMARY KEY", "").strip()
                try:
                    cursor.execute(
                        f"ALTER TABLE download_history ADD COLUMN {col_name} {col_type_for_add}"
                    )
                    logger.info(
                        f"Added missing column '{col_name} {col_type_for_add}' to download_history table."
                    )
                    added_columns = True
                except sqlite3.OperationalError as alter_e:
                    # This might happen if a column (e.g. task_id) without "PRIMARY KEY" is added by this loop
                    # but the initial create table already made it a primary key.
                    # Or other more complex scenarios.
                    logger.warning(
                        f"Could not add column '{col_name}': {alter_e}. It might already exist or there's a schema mismatch."
                    )

        # Add additional columns for summary data if they don't exist
        for col_name, col_type in {
            "summary_json": "TEXT",
            "total_successful": "INTEGER",
            "total_skipped": "INTEGER", 
            "total_failed": "INTEGER"
        }.items():
            if col_name not in existing_column_names and col_name not in EXPECTED_COLUMNS:
                try:
                    cursor.execute(
                        f"ALTER TABLE download_history ADD COLUMN {col_name} {col_type}"
                    )
                    logger.info(
                        f"Added missing column '{col_name} {col_type}' to download_history table."
                    )
                    added_columns = True
                except sqlite3.OperationalError as alter_e:
                    logger.warning(
                        f"Could not add column '{col_name}': {alter_e}. It might already exist or there's a schema mismatch."
                    )

        if added_columns:
            conn.commit()
            logger.info(f"Download history table schema updated at {HISTORY_DB_FILE}")
        else:
            logger.info(
                f"Download history database schema is up-to-date at {HISTORY_DB_FILE}"
            )

    except sqlite3.Error as e:
        logger.error(
            f"Error initializing download history database: {e}", exc_info=True
        )
    finally:
        if conn:
            conn.close()


def add_entry_to_history(history_data: dict):
    """Adds or replaces an entry in the download_history table.

    Args:
        history_data (dict): A dictionary containing the data for the history entry.
                             Expected keys match the table columns.
    """
    required_keys = [
        "task_id",
        "download_type",
        "item_name",
        "item_artist",
        "item_album",
        "item_url",
        "spotify_id",
        "status_final",
        "error_message",
        "timestamp_added",
        "timestamp_completed",
        "original_request_json",
        "last_status_obj_json",
        "service_used",
        "quality_profile",
        "convert_to",
        "bitrate",
        "parent_task_id",
        "track_status",
        "summary_json",
        "total_successful",
        "total_skipped",
        "total_failed",
    ]
    # Ensure all keys are present, filling with None if not
    for key in required_keys:
        history_data.setdefault(key, None)

    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO download_history (
                task_id, download_type, item_name, item_artist, item_album,
                item_url, spotify_id, status_final, error_message,
                timestamp_added, timestamp_completed, original_request_json,
                last_status_obj_json, service_used, quality_profile,
                convert_to, bitrate, parent_task_id, track_status,
                summary_json, total_successful, total_skipped, total_failed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                history_data["task_id"],
                history_data["download_type"],
                history_data["item_name"],
                history_data["item_artist"],
                history_data["item_album"],
                history_data["item_url"],
                history_data["spotify_id"],
                history_data["status_final"],
                history_data["error_message"],
                history_data["timestamp_added"],
                history_data["timestamp_completed"],
                history_data["original_request_json"],
                history_data["last_status_obj_json"],
                history_data["service_used"],
                history_data["quality_profile"],
                history_data["convert_to"],
                history_data["bitrate"],
                history_data["parent_task_id"],
                history_data["track_status"],
                history_data["summary_json"],
                history_data["total_successful"],
                history_data["total_skipped"],
                history_data["total_failed"],
            ),
        )
        conn.commit()
        logger.info(
            f"Added/Updated history for task_id: {history_data['task_id']}, status: {history_data['status_final']}"
        )
    except sqlite3.Error as e:
        logger.error(
            f"Error adding entry to download history for task_id {history_data.get('task_id')}: {e}",
            exc_info=True,
        )
    except Exception as e:
        logger.error(
            f"Unexpected error adding to history for task_id {history_data.get('task_id')}: {e}",
            exc_info=True,
        )
    finally:
        if conn:
            conn.close()


def get_history_entries(
    limit=25, offset=0, sort_by="timestamp_completed", sort_order="DESC", filters=None
):
    """Retrieves entries from the download_history table with pagination, sorting, and filtering.

    Args:
        limit (int): Maximum number of entries to return.
        offset (int): Number of entries to skip (for pagination).
        sort_by (str): Column name to sort by.
        sort_order (str): 'ASC' or 'DESC'.
        filters (dict, optional): A dictionary of column_name: value to filter by.
                                  Currently supports exact matches.

    Returns:
        tuple: (list of history entries as dicts, total_count of matching entries)
    """
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        conn.row_factory = sqlite3.Row  # Access columns by name
        cursor = conn.cursor()

        base_query = "FROM download_history"
        count_query = "SELECT COUNT(*) " + base_query
        select_query = "SELECT * " + base_query

        where_clauses = []
        params = []

        if filters:
            for column, value in filters.items():
                # Basic security: ensure column is a valid one (alphanumeric + underscore)
                if column.replace("_", "").isalnum():
                    # Special case for 'NOT_NULL' value for parent_task_id
                    if column == "parent_task_id" and value == "NOT_NULL":
                        where_clauses.append(f"{column} IS NOT NULL")
                    # Regular case for NULL value
                    elif value is None:
                        where_clauses.append(f"{column} IS NULL")
                    # Regular case for exact match
                    else:
                        where_clauses.append(f"{column} = ?")
                        params.append(value)

        if where_clauses:
            where_sql = " WHERE " + " AND ".join(where_clauses)
            count_query += where_sql
            select_query += where_sql

        # Get total count for pagination
        cursor.execute(count_query, params)
        total_count = cursor.fetchone()[0]

        # Validate sort_by and sort_order to prevent SQL injection
        valid_sort_columns = [
            "task_id",
            "download_type",
            "item_name",
            "item_artist",
            "item_album",
            "item_url",
            "status_final",
            "timestamp_added",
            "timestamp_completed",
            "service_used",
            "quality_profile",
            "convert_to",
            "bitrate",
            "parent_task_id",
            "track_status",
            "total_successful",
            "total_skipped",
            "total_failed",
        ]
        if sort_by not in valid_sort_columns:
            sort_by = "timestamp_completed"  # Default sort

        sort_order_upper = sort_order.upper()
        if sort_order_upper not in ["ASC", "DESC"]:
            sort_order_upper = "DESC"

        select_query += f" ORDER BY {sort_by} {sort_order_upper} LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(select_query, params)
        rows = cursor.fetchall()

        # Convert rows to list of dicts
        entries = [dict(row) for row in rows]
        return entries, total_count

    except sqlite3.Error as e:
        logger.error(f"Error retrieving history entries: {e}", exc_info=True)
        return [], 0
    finally:
        if conn:
            conn.close()


def add_track_entry_to_history(track_name, artist_name, parent_task_id, track_status, parent_history_data=None):
    """Adds a track-specific entry to the history database.
    
    Args:
        track_name (str): The name of the track
        artist_name (str): The artist name
        parent_task_id (str): The ID of the parent task (album or playlist)
        track_status (str): The status of the track ('SUCCESSFUL', 'SKIPPED', 'FAILED')
        parent_history_data (dict, optional): The history data of the parent task
    
    Returns:
        str: The task_id of the created track entry
    """
    # Generate a unique ID for this track entry
    track_task_id = f"{parent_task_id}_track_{uuid.uuid4().hex[:8]}"
    
    # Create a copy of parent data or initialize empty dict
    track_history_data = {}
    if parent_history_data:
        # Copy relevant fields from parent
        for key in EXPECTED_COLUMNS:
            if key in parent_history_data and key not in ['task_id', 'item_name', 'item_artist']:
                track_history_data[key] = parent_history_data[key]
    
    # Set track-specific fields
    track_history_data.update({
        "task_id": track_task_id,
        "download_type": "track",
        "item_name": track_name,
        "item_artist": artist_name,
        "parent_task_id": parent_task_id,
        "track_status": track_status,
        "status_final": "COMPLETED" if track_status == "SUCCESSFUL" else 
                        "SKIPPED" if track_status == "SKIPPED" else "ERROR",
        "timestamp_completed": time.time()
    })
    
    # Extract track URL if possible (from last_status_obj_json)
    if parent_history_data and parent_history_data.get("last_status_obj_json"):
        try:
            last_status = json.loads(parent_history_data["last_status_obj_json"])
            
            # Try to match track name in the tracks lists to find URL
            track_key = f"{track_name} - {artist_name}"
            if "raw_callback" in last_status and last_status["raw_callback"].get("url"):
                track_history_data["item_url"] = last_status["raw_callback"].get("url")
                
                # Extract Spotify ID from URL if possible
                url = last_status["raw_callback"].get("url", "")
                if url and "spotify.com" in url:
                    try:
                        spotify_id = url.split("/")[-1]
                        if spotify_id and len(spotify_id) == 22 and spotify_id.isalnum():
                            track_history_data["spotify_id"] = spotify_id
                    except Exception:
                        pass
        except (json.JSONDecodeError, KeyError, AttributeError) as e:
            logger.warning(f"Could not extract track URL for {track_name}: {e}")
    
    # Add entry to history
    add_entry_to_history(track_history_data)
    
    return track_task_id

def add_tracks_from_summary(summary_data, parent_task_id, parent_history_data=None):
    """Processes a summary object from a completed task and adds individual track entries.
    
    Args:
        summary_data (dict): The summary data containing track lists
        parent_task_id (str): The ID of the parent task
        parent_history_data (dict, optional): The history data of the parent task
    
    Returns:
        dict: Summary of processed tracks
    """
    processed = {
        "successful": 0,
        "skipped": 0,
        "failed": 0
    }
    
    if not summary_data:
        logger.warning(f"No summary data provided for task {parent_task_id}")
        return processed
    
    # Process successful tracks
    for track_entry in summary_data.get("successful_tracks", []):
        try:
            # Parse "track_name - artist_name" format
            parts = track_entry.split(" - ", 1)
            if len(parts) == 2:
                track_name, artist_name = parts
                add_track_entry_to_history(
                    track_name=track_name,
                    artist_name=artist_name, 
                    parent_task_id=parent_task_id,
                    track_status="SUCCESSFUL",
                    parent_history_data=parent_history_data
                )
                processed["successful"] += 1
            else:
                logger.warning(f"Could not parse track entry: {track_entry}")
        except Exception as e:
            logger.error(f"Error processing successful track {track_entry}: {e}", exc_info=True)
    
    # Process skipped tracks
    for track_entry in summary_data.get("skipped_tracks", []):
        try:
            parts = track_entry.split(" - ", 1)
            if len(parts) == 2:
                track_name, artist_name = parts
                add_track_entry_to_history(
                    track_name=track_name,
                    artist_name=artist_name,
                    parent_task_id=parent_task_id,
                    track_status="SKIPPED",
                    parent_history_data=parent_history_data
                )
                processed["skipped"] += 1
            else:
                logger.warning(f"Could not parse skipped track entry: {track_entry}")
        except Exception as e:
            logger.error(f"Error processing skipped track {track_entry}: {e}", exc_info=True)
    
    # Process failed tracks
    for track_entry in summary_data.get("failed_tracks", []):
        try:
            parts = track_entry.split(" - ", 1)
            if len(parts) == 2:
                track_name, artist_name = parts
                add_track_entry_to_history(
                    track_name=track_name,
                    artist_name=artist_name,
                    parent_task_id=parent_task_id,
                    track_status="FAILED",
                    parent_history_data=parent_history_data
                )
                processed["failed"] += 1
            else:
                logger.warning(f"Could not parse failed track entry: {track_entry}")
        except Exception as e:
            logger.error(f"Error processing failed track {track_entry}: {e}", exc_info=True)
    
    logger.info(
        f"Added {processed['successful']} successful, {processed['skipped']} skipped, "
        f"and {processed['failed']} failed track entries for task {parent_task_id}"
    )
    
    return processed


if __name__ == "__main__":
    # For testing purposes
    logging.basicConfig(level=logging.INFO)
    init_history_db()

    sample_data_complete = {
        "task_id": "test_task_123",
        "download_type": "track",
        "item_name": "Test Song",
        "item_artist": "Test Artist",
        "item_album": "Test Album",
        "item_url": "http://spotify.com/track/123",
        "spotify_id": "123",
        "status_final": "COMPLETED",
        "error_message": None,
        "timestamp_added": time.time() - 3600,
        "timestamp_completed": time.time(),
        "original_request_json": json.dumps({"param1": "value1"}),
        "last_status_obj_json": json.dumps(
            {"status": "complete", "message": "Finished!"}
        ),
        "service_used": "Spotify (Primary)",
        "quality_profile": "NORMAL",
        "convert_to": None,
        "bitrate": None,
    }
    add_entry_to_history(sample_data_complete)

    sample_data_error = {
        "task_id": "test_task_456",
        "download_type": "album",
        "item_name": "Another Album",
        "item_artist": "Another Artist",
        "item_album": "Another Album",  # For albums, item_name and item_album are often the same
        "item_url": "http://spotify.com/album/456",
        "spotify_id": "456",
        "status_final": "ERROR",
        "error_message": "Download failed due to network issue.",
        "timestamp_added": time.time() - 7200,
        "timestamp_completed": time.time() - 60,
        "original_request_json": json.dumps({"param2": "value2"}),
        "last_status_obj_json": json.dumps(
            {"status": "error", "error": "Network issue"}
        ),
        "service_used": "Deezer",
        "quality_profile": "MP3_320",
        "convert_to": "mp3",
        "bitrate": "320",
    }
    add_entry_to_history(sample_data_error)

    # Test updating an entry
    updated_data_complete = {
        "task_id": "test_task_123",
        "download_type": "track",
        "item_name": "Test Song (Updated)",
        "item_artist": "Test Artist",
        "item_album": "Test Album II",
        "item_url": "http://spotify.com/track/123",
        "spotify_id": "123",
        "status_final": "COMPLETED",
        "error_message": None,
        "timestamp_added": time.time() - 3600,
        "timestamp_completed": time.time() + 100,  # Updated completion time
        "original_request_json": json.dumps({"param1": "value1", "new_param": "added"}),
        "last_status_obj_json": json.dumps(
            {"status": "complete", "message": "Finished! With update."}
        ),
        "service_used": "Spotify (Deezer Fallback)",
        "quality_profile": "HIGH",
        "convert_to": "flac",
        "bitrate": None,
    }
    add_entry_to_history(updated_data_complete)

    print(f"Test entries added/updated in {HISTORY_DB_FILE}")

    print("\nFetching all history entries (default sort):")
    entries, total = get_history_entries(limit=5)
    print(f"Total entries: {total}")
    for entry in entries:
        print(entry)

    print("\nFetching history entries (sorted by item_name ASC, limit 2, offset 1):")
    entries_sorted, total_sorted = get_history_entries(
        limit=2, offset=1, sort_by="item_name", sort_order="ASC"
    )
    print(f"Total entries (should be same as above): {total_sorted}")
    for entry in entries_sorted:
        print(entry)

    print("\nFetching history entries with filter (status_final = COMPLETED):")
    entries_filtered, total_filtered = get_history_entries(
        filters={"status_final": "COMPLETED"}
    )
    print(f"Total COMPLETED entries: {total_filtered}")
    for entry in entries_filtered:
        print(entry)
