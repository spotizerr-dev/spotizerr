import sqlite3
import json
import time
import logging
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from datetime import datetime

logger = logging.getLogger(__name__)

HISTORY_DIR = Path("./data/history")
HISTORY_DB_FILE = HISTORY_DIR / "download_history.db"

# Main tasks table schema
MAIN_TASKS_SCHEMA = {
    "task_id": "TEXT PRIMARY KEY",
    "task_type": "TEXT NOT NULL",  # 'track', 'album', 'playlist'
    "title": "TEXT",
    "artists": "TEXT",  # JSON array of artist objects
    "ids": "TEXT",  # JSON object with spotify, deezer, isrc, upc
    "status_current": "TEXT",  # Current status: initializing, retrying, real-time, skipped, error, done
    "status_final": "TEXT",  # Final result: COMPLETED, ERROR, CANCELLED, SKIPPED
    "timestamp_created": "REAL",
    "timestamp_updated": "REAL",
    "timestamp_completed": "REAL",
    "children_table": "TEXT",  # Table name for nested items (album_uuid, playlist_uuid)
    "metadata": "TEXT",  # JSON - Complete object data (albumObject, playlistObject, trackObject)
    "config": "TEXT",  # JSON - Download config (quality, convert_to, bitrate, service)
    "error_info": "TEXT",  # JSON - Error details
    "progress": "TEXT",  # JSON - Progress info (current/total, time_elapsed, etc.)
    "summary": "TEXT",  # JSON - Final summary for albums/playlists
    "parent_task_id": "TEXT",  # Reference to parent task for individual tracks
    "position": "INTEGER",  # Position in parent (for playlist tracks)
    "original_request": "TEXT"  # JSON - Original request data
}

# Status history table for tracking all status changes
STATUS_HISTORY_SCHEMA = {
    "status_id": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "task_id": "TEXT NOT NULL",
    "status_type": "TEXT NOT NULL",  # initializing, retrying, real-time, skipped, error, done
    "status_data": "TEXT",  # JSON - Complete status object
    "timestamp": "REAL NOT NULL"
}

# Schema for individual track tables within albums/playlists
CHILD_TRACK_SCHEMA = {
    "track_id": "TEXT PRIMARY KEY",
    "parent_task_id": "TEXT NOT NULL",
    "position": "INTEGER",
    "disc_number": "INTEGER",
    "track_number": "INTEGER", 
    "title": "TEXT",
    "duration_ms": "INTEGER",
    "explicit": "BOOLEAN",
    "track_data": "TEXT",  # JSON - Complete trackObject (trackAlbumObject/trackPlaylistObject)
    "artists_data": "TEXT",  # JSON - Array of artist objects
    "album_data": "TEXT",  # JSON - Album context data (for playlist tracks)
    "ids_data": "TEXT",  # JSON - IDs object (spotify, deezer, isrc, etc.)
    "status_current": "TEXT",  # Current status: initializing, retrying, real-time, skipped, error, done
    "status_final": "TEXT",   # Final result: COMPLETED, ERROR, CANCELLED, SKIPPED
    "status_history": "TEXT", # JSON - Array of all status updates for this track
    "timestamp_created": "REAL",
    "timestamp_started": "REAL",  # When download actually started
    "timestamp_completed": "REAL",
    "time_elapsed": "REAL",   # Total processing time in seconds
    "retry_count": "INTEGER", # Number of retries attempted
    "error_info": "TEXT",     # JSON - Error details and reason
    "progress_info": "TEXT",  # JSON - Progress data during download
    "config": "TEXT",         # JSON - Download config inherited from parent
    "download_path": "TEXT",  # Final download path/filename
    "file_size": "INTEGER",   # File size in bytes
    "quality_achieved": "TEXT" # Actual quality/bitrate achieved
}


def init_history_db():
    """Initialize the improved history database with new schema."""
    conn = None
    try:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()

        # Create main tasks table
        _create_table_from_schema(cursor, "download_tasks", MAIN_TASKS_SCHEMA)
        
        # Create status history table
        _create_table_from_schema(cursor, "status_history", STATUS_HISTORY_SCHEMA)

        # Check if we need to migrate from old schema
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'")
        old_table_exists = cursor.fetchone() is not None
        
        if old_table_exists:
            logger.info("Old schema detected. Starting migration...")
            _migrate_from_old_schema(conn)
        
        conn.commit()
        logger.info(f"History database initialized successfully at {HISTORY_DB_FILE}")
        
    except sqlite3.Error as e:
        logger.error(f"Error initializing history database: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()


def _create_table_from_schema(cursor, table_name: str, schema: Dict[str, str]):
    """Create a table from a schema dictionary."""
    columns = []
    
    for col_name, col_def in schema.items():
        columns.append(f"{col_name} {col_def}")
    
    create_sql = f"CREATE TABLE IF NOT EXISTS {table_name} ({', '.join(columns)})"
    
    cursor.execute(create_sql)
    logger.info(f"Created/verified table: {table_name}")


def _migrate_from_old_schema(conn):
    """Migrate data from the old download_history table to the new schema."""
    cursor = conn.cursor()
    
    try:
        # Get all data from old table
        cursor.execute("SELECT * FROM download_history")
        old_records = cursor.fetchall()
        
        # Get column names
        cursor.execute("PRAGMA table_info(download_history)")
        old_columns = [col[1] for col in cursor.fetchall()]
        
        logger.info(f"Migrating {len(old_records)} records from old schema...")
        
        # Create backup of old table
        backup_table = f"download_history_backup_{int(time.time())}"
        cursor.execute(f"CREATE TABLE {backup_table} AS SELECT * FROM download_history")
        
        migrated_count = 0
        for record in old_records:
            old_data = dict(zip(old_columns, record))
            
            # Convert old record to new format
            new_task = _convert_old_record_to_new(old_data)
            if new_task:
                add_task_to_history(new_task)
                migrated_count += 1
        
        logger.info(f"Successfully migrated {migrated_count} records. Old table backed up as {backup_table}")
        
    except Exception as e:
        logger.error(f"Error during migration: {e}", exc_info=True)


def _convert_old_record_to_new(old_data: Dict) -> Optional[Dict]:
    """Convert an old history record to the new format."""
    try:
        # Create basic task structure
        task_data = {
            "task_id": old_data.get("task_id"),
            "task_type": old_data.get("download_type", "track"),
            "title": old_data.get("item_name", ""),
            "timestamp_created": old_data.get("timestamp_added"),
            "timestamp_completed": old_data.get("timestamp_completed"),
            "status_final": old_data.get("status_final"),
            "parent_task_id": old_data.get("parent_task_id"),
            "original_request": old_data.get("original_request_json")
        }
        
        # Build artists array
        if old_data.get("item_artist"):
            task_data["artists"] = json.dumps([{"name": old_data["item_artist"]}])
        
        # Build IDs object
        ids = {}
        if old_data.get("spotify_id"):
            ids["spotify"] = old_data["spotify_id"]
        if ids:
            task_data["ids"] = json.dumps(ids)
        
        # Build config object
        config = {}
        if old_data.get("service_used"):
            config["service_used"] = old_data["service_used"]
        if old_data.get("quality_profile"):
            config["quality_profile"] = old_data["quality_profile"]
        if old_data.get("convert_to"):
            config["convert_to"] = old_data["convert_to"]
        if old_data.get("bitrate"):
            config["bitrate"] = old_data["bitrate"]
        if config:
            task_data["config"] = json.dumps(config)
        
        # Handle error information
        if old_data.get("error_message"):
            task_data["error_info"] = json.dumps({"message": old_data["error_message"]})
        
        # Build basic metadata object
        metadata = {
            "type": task_data["task_type"],
            "title": task_data["title"],
            "url": old_data.get("item_url")
        }
        
        if old_data.get("item_album"):
            metadata["album"] = {"title": old_data["item_album"]}
        
        task_data["metadata"] = json.dumps(metadata)
        
        return task_data
        
    except Exception as e:
        logger.warning(f"Failed to convert old record {old_data.get('task_id')}: {e}")
        return None


def create_child_table(parent_task_id: str, task_type: str) -> str:
    """Create a child table for album or playlist tracks using UUID-based naming."""
    # Generate a shorter UUID for the table name to avoid database identifier length limits
    import uuid as uuid_mod
    table_uuid = uuid_mod.uuid4().hex[:12]  # Use first 12 characters of UUID
    table_name = f"{task_type}_{table_uuid}"
    
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        
        # Create the child table
        _create_table_from_schema(cursor, table_name, CHILD_TRACK_SCHEMA)
        
        # Create an index on parent_task_id for faster queries
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_parent ON {table_name}(parent_task_id)")
        
        # Create an index on position for proper ordering
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_position ON {table_name}(position)")
        
        conn.commit()
        
        logger.info(f"Created child table: {table_name} for parent task: {parent_task_id}")
        return table_name
        
    except sqlite3.Error as e:
        logger.error(f"Error creating child table {table_name}: {e}")
        return ""
    finally:
        if conn:
            conn.close()


def add_task_to_history(task_data: Dict):
    """Add or update a main task in the history."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        
        # Ensure required fields are present
        required_fields = ["task_id", "task_type"]
        for field in required_fields:
            if field not in task_data:
                raise ValueError(f"Missing required field: {field}")
        
        # Set default timestamps
        current_time = time.time()
        task_data.setdefault("timestamp_created", current_time)
        task_data.setdefault("timestamp_updated", current_time)
        
        # Convert all values to appropriate types
        processed_data = {}
        for col_name in MAIN_TASKS_SCHEMA.keys():
            if col_name in task_data:
                value = task_data[col_name]
                # Convert objects to JSON strings
                if isinstance(value, (dict, list)):
                    processed_data[col_name] = json.dumps(value)
                else:
                    processed_data[col_name] = value
            else:
                processed_data[col_name] = None
        
        # Create INSERT OR REPLACE query
        columns = list(processed_data.keys())
        placeholders = ["?" for _ in columns]
        values = [processed_data[col] for col in columns]
        
        query = f"""
            INSERT OR REPLACE INTO download_tasks ({', '.join(columns)})
            VALUES ({', '.join(placeholders)})
        """
        
        cursor.execute(query, values)
        conn.commit()
        
        logger.info(f"Added/updated task: {task_data['task_id']} ({task_data['task_type']})")
        
    except Exception as e:
        logger.error(f"Error adding task to history: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()


def add_status_update(task_id: str, status_type: str, status_data: Dict):
    """Add a status update to the status history."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO status_history (task_id, status_type, status_data, timestamp)
            VALUES (?, ?, ?, ?)
        """, (task_id, status_type, json.dumps(status_data), time.time()))
        
        # Also update the current status in main table
        cursor.execute("""
            UPDATE download_tasks 
            SET status_current = ?, timestamp_updated = ?
            WHERE task_id = ?
        """, (status_type, time.time(), task_id))
        
        conn.commit()
        logger.debug(f"Added status update for {task_id}: {status_type}")
        
    except Exception as e:
        logger.error(f"Error adding status update: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()


def add_child_track(parent_task_id: str, track_data: Dict):
    """Add a track to a child table (album or playlist) with comprehensive data extraction."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        
        # Find the parent task to get the children table name
        cursor.execute("SELECT children_table FROM download_tasks WHERE task_id = ?", (parent_task_id,))
        result = cursor.fetchone()
        
        if not result or not result[0]:
            logger.error(f"No children table found for parent task: {parent_task_id}")
            return
        
        table_name = result[0]
        
        # Generate track ID if not provided
        track_id = track_data.get("track_id", f"{parent_task_id}_track_{uuid.uuid4().hex[:8]}")
        
        # Extract track object data if provided
        track_obj = track_data.get("track_data", {})
        if isinstance(track_obj, str):
            try:
                track_obj = json.loads(track_obj)
            except json.JSONDecodeError:
                track_obj = {}
        
        # Prepare comprehensive track record
        track_record = {
            "track_id": track_id,
            "parent_task_id": parent_task_id,
            "position": track_data.get("position") or track_obj.get("position", 0),
            "disc_number": track_obj.get("disc_number", 1),
            "track_number": track_obj.get("track_number", 0),
            "title": track_obj.get("title", "Unknown Track"),
            "duration_ms": track_obj.get("duration_ms", 0),
            "explicit": track_obj.get("explicit", False),
            "track_data": json.dumps(track_obj) if track_obj else None,
            "artists_data": json.dumps(track_obj.get("artists", [])),
            "album_data": json.dumps(track_obj.get("album", {})) if track_obj.get("album") else None,
            "ids_data": json.dumps(track_obj.get("ids", {})),
            "status_current": track_data.get("status_current", "initializing"),
            "status_final": track_data.get("status_final"),
            "status_history": json.dumps(track_data.get("status_history", [])),
            "timestamp_created": track_data.get("timestamp_created", time.time()),
            "timestamp_started": track_data.get("timestamp_started"),
            "timestamp_completed": track_data.get("timestamp_completed"),
            "time_elapsed": track_data.get("time_elapsed"),
            "retry_count": track_data.get("retry_count", 0),
            "error_info": json.dumps(track_data.get("error_info", {})) if track_data.get("error_info") else None,
            "progress_info": json.dumps(track_data.get("progress_info", {})) if track_data.get("progress_info") else None,
            "config": json.dumps(track_data.get("config", {})) if track_data.get("config") else None,
            "download_path": track_data.get("download_path"),
            "file_size": track_data.get("file_size"),
            "quality_achieved": track_data.get("quality_achieved")
        }
        
        # Filter out None values to avoid issues
        track_record = {k: v for k, v in track_record.items() if v is not None}
        
        # Insert into child table
        columns = list(track_record.keys())
        placeholders = ["?" for _ in columns]
        values = [track_record[col] for col in columns]
        
        query = f"""
            INSERT OR REPLACE INTO {table_name} ({', '.join(columns)})
            VALUES ({', '.join(placeholders)})
        """
        
        cursor.execute(query, values)
        conn.commit()
        
        logger.info(f"Added track to {table_name}: {track_id} - {track_record.get('title', 'Unknown')}")
        
        return track_id
        
    except Exception as e:
        logger.error(f"Error adding child track: {e}", exc_info=True)
        return None
    finally:
        if conn:
            conn.close()


def get_task_history(
    limit: int = 25,
    offset: int = 0,
    sort_by: str = "timestamp_updated",
    sort_order: str = "DESC",
    filters: Optional[Dict] = None,
    include_children: bool = False
) -> tuple[List[Dict], int]:
    """Get task history with enhanced filtering and optional child data."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Build query
        base_query = "FROM download_tasks"
        where_clauses = []
        params = []
        
        if filters:
            for column, value in filters.items():
                if column in MAIN_TASKS_SCHEMA:
                    if value is None:
                        where_clauses.append(f"{column} IS NULL")
                    else:
                        where_clauses.append(f"{column} = ?")
                        params.append(value)
        
        if where_clauses:
            base_query += " WHERE " + " AND ".join(where_clauses)
        
        # Get total count
        cursor.execute(f"SELECT COUNT(*) {base_query}", params)
        total_count = cursor.fetchone()[0]
        
        # Validate sort parameters
        if sort_by not in MAIN_TASKS_SCHEMA:
            sort_by = "timestamp_updated"
        if sort_order.upper() not in ["ASC", "DESC"]:
            sort_order = "DESC"
        
        # Get paginated results
        query = f"SELECT * {base_query} ORDER BY {sort_by} {sort_order} LIMIT ? OFFSET ?"
        cursor.execute(query, params + [limit, offset])
        
        tasks = []
        for row in cursor.fetchall():
            task = dict(row)
            
            # Parse JSON fields
            json_fields = ["artists", "ids", "metadata", "config", "error_info", "progress", "summary"]
            for field in json_fields:
                if task[field]:
                    try:
                        task[field] = json.loads(task[field])
                    except json.JSONDecodeError:
                        pass
            
            # Include child tracks if requested
            if include_children and task["children_table"]:
                task["child_tracks"] = get_child_tracks(task["children_table"])
            
            tasks.append(task)
        
        return tasks, total_count
        
    except Exception as e:
        logger.error(f"Error getting task history: {e}", exc_info=True)
        return [], 0
    finally:
        if conn:
            conn.close()


def add_track_status_update(track_id: str, table_name: str, status_type: str, status_data: Dict, 
                           progress_info: Dict = None, error_info: Dict = None):
    """Add a status update to a track's mini-history."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        
        # Get current status history
        cursor.execute(f"SELECT status_history, retry_count FROM {table_name} WHERE track_id = ?", (track_id,))
        result = cursor.fetchone()
        
        if not result:
            logger.warning(f"Track {track_id} not found in table {table_name}")
            return
        
        current_history = []
        retry_count = result[1] or 0
        
        if result[0]:
            try:
                current_history = json.loads(result[0])
            except json.JSONDecodeError:
                current_history = []
        
        # Add new status update
        status_update = {
            "timestamp": time.time(),
            "status_type": status_type,
            "status_data": status_data
        }
        
        if progress_info:
            status_update["progress_info"] = progress_info
        if error_info:
            status_update["error_info"] = error_info
            
        current_history.append(status_update)
        
        # Update fields based on status
        update_fields = {
            "status_current": status_type,
            "status_history": json.dumps(current_history),
            "timestamp_updated": time.time()
        }
        
        # Handle specific status transitions
        if status_type == "real-time":
            if not result or not cursor.execute(f"SELECT timestamp_started FROM {table_name} WHERE track_id = ?", (track_id,)).fetchone()[0]:
                update_fields["timestamp_started"] = time.time()
            if progress_info:
                update_fields["progress_info"] = json.dumps(progress_info)
                
        elif status_type == "retrying":
            update_fields["retry_count"] = retry_count + 1
            if error_info:
                update_fields["error_info"] = json.dumps(error_info)
                
        elif status_type in ["done", "error", "skipped"]:
            update_fields["timestamp_completed"] = time.time()
            update_fields["status_final"] = {
                "done": "COMPLETED",
                "error": "ERROR", 
                "skipped": "SKIPPED"
            }[status_type]
            
            if error_info:
                update_fields["error_info"] = json.dumps(error_info)
                
            # Calculate time elapsed if we have start time
            cursor.execute(f"SELECT timestamp_started FROM {table_name} WHERE track_id = ?", (track_id,))
            start_result = cursor.fetchone()
            if start_result and start_result[0]:
                update_fields["time_elapsed"] = time.time() - start_result[0]
        
        # Update the track record
        set_clauses = [f"{key} = ?" for key in update_fields.keys()]
        values = list(update_fields.values()) + [track_id]
        
        query = f"UPDATE {table_name} SET {', '.join(set_clauses)} WHERE track_id = ?"
        cursor.execute(query, values)
        conn.commit()
        
        logger.debug(f"Updated track {track_id} status to {status_type}")
        
    except Exception as e:
        logger.error(f"Error updating track status: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()


def get_child_tracks(table_name: str) -> List[Dict]:
    """Get all tracks from a child table with parsed JSON fields."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute(f"SELECT * FROM {table_name} ORDER BY disc_number, track_number, position")
        tracks = []
        
        for row in cursor.fetchall():
            track = dict(row)
            
            # Parse JSON fields
            json_fields = ["track_data", "artists_data", "album_data", "ids_data", 
                          "status_history", "error_info", "progress_info", "config"]
            
            for field in json_fields:
                if track.get(field):
                    try:
                        track[field] = json.loads(track[field])
                    except json.JSONDecodeError:
                        pass
            
            tracks.append(track)
        
        return tracks
        
    except Exception as e:
        logger.error(f"Error getting child tracks from {table_name}: {e}")
        return []
    finally:
        if conn:
            conn.close()


def get_status_history(task_id: str) -> List[Dict]:
    """Get complete status history for a task."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM status_history 
            WHERE task_id = ? 
            ORDER BY timestamp ASC
        """, (task_id,))
        
        history = []
        for row in cursor.fetchall():
            entry = dict(row)
            if entry["status_data"]:
                try:
                    entry["status_data"] = json.loads(entry["status_data"])
                except json.JSONDecodeError:
                    pass
            history.append(entry)
        
        return history
        
    except Exception as e:
        logger.error(f"Error getting status history for {task_id}: {e}")
        return []
    finally:
        if conn:
            conn.close()


def process_callback_object(callback_obj: Dict, task_id: str = None):
    """Process a callback object and update history accordingly."""
    try:
        if not task_id:
            task_id = str(uuid.uuid4())
        
        # Determine callback type and extract data
        if "track" in callback_obj:
            _process_track_callback(callback_obj, task_id)
        elif "album" in callback_obj:
            _process_album_callback(callback_obj, task_id)
        elif "playlist" in callback_obj:
            _process_playlist_callback(callback_obj, task_id)
        else:
            logger.warning(f"Unknown callback object type for task {task_id}")
    
    except Exception as e:
        logger.error(f"Error processing callback object: {e}", exc_info=True)


def _process_track_callback(callback_obj: Dict, task_id: str):
    """Process a trackCallbackObject with comprehensive status tracking."""
    track_data = callback_obj.get("track", {})
    status_info = callback_obj.get("status_info", {})
    parent_info = callback_obj.get("parent")
    
    # Check if this is a child track (part of album/playlist)
    if parent_info and parent_info.get("task_id"):
        parent_task_id = parent_info["task_id"]
        
        # Find parent task's children table
        conn = None
        try:
            conn = sqlite3.connect(HISTORY_DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT children_table FROM download_tasks WHERE task_id = ?", (parent_task_id,))
            result = cursor.fetchone()
            
            if result and result[0]:
                table_name = result[0]
                
                # Extract progress and error info
                progress_info = None
                error_info = None
                
                if status_info.get("status") == "real-time":
                    progress_info = {
                        "time_elapsed": status_info.get("time_elapsed", 0),
                        "progress": status_info.get("progress", 0)
                    }
                elif status_info.get("status") == "retrying":
                    error_info = {
                        "retry_count": status_info.get("retry_count", 0),
                        "seconds_left": status_info.get("seconds_left", 0),
                        "error": status_info.get("error", "")
                    }
                elif status_info.get("status") == "error":
                    error_info = {
                        "message": status_info.get("error", "Unknown error")
                    }
                elif status_info.get("status") == "skipped":
                    error_info = {
                        "reason": status_info.get("reason", "Unknown reason")
                    }
                
                # Update track status in child table
                add_track_status_update(
                    track_id=task_id,
                    table_name=table_name,
                    status_type=status_info.get("status", "initializing"),
                    status_data=status_info,
                    progress_info=progress_info,
                    error_info=error_info
                )
                
        except Exception as e:
            logger.error(f"Error processing child track callback: {e}", exc_info=True)
        finally:
            if conn:
                conn.close()
    else:
        # Handle standalone track
        task_entry = {
            "task_id": task_id,
            "task_type": "track",
            "title": track_data.get("title", ""),
            "artists": [{"name": artist.get("name", "")} for artist in track_data.get("artists", [])],
            "ids": track_data.get("ids", {}),
            "metadata": track_data,
            "status_current": status_info.get("status", "initializing"),
            "position": callback_obj.get("current_track")
        }
        
        # Set final status based on status_info
        if status_info.get("status") == "done":
            task_entry["status_final"] = "COMPLETED"
            task_entry["timestamp_completed"] = time.time()
        elif status_info.get("status") == "error":
            task_entry["status_final"] = "ERROR"
            task_entry["error_info"] = {"message": status_info.get("error", "")}
        elif status_info.get("status") == "skipped":
            task_entry["status_final"] = "SKIPPED"
        
        add_task_to_history(task_entry)
        add_status_update(task_id, status_info.get("status", "initializing"), status_info)


def _process_album_callback(callback_obj: Dict, task_id: str):
    """Process an albumCallbackObject with comprehensive track management."""
    album_data = callback_obj.get("album", {})
    status_info = callback_obj.get("status_info", {})
    
    # Create children table for tracks
    children_table = create_child_table(task_id, "album")
    
    # Create main task entry
    task_entry = {
        "task_id": task_id,
        "task_type": "album",
        "title": album_data.get("title", ""),
        "artists": [{"name": artist.get("name", "")} for artist in album_data.get("artists", [])],
        "ids": album_data.get("ids", {}),
        "metadata": album_data,
        "children_table": children_table,
        "status_current": status_info.get("status", "initializing")
    }
    
    # Initialize tracks in child table when album processing starts
    if status_info.get("status") == "initializing" and album_data.get("tracks"):
        for i, track in enumerate(album_data["tracks"]):
            track_data = {
                "track_data": track,
                "position": i + 1,
                "status_current": "initializing",
                "timestamp_created": time.time()
            }
            add_child_track(task_id, track_data)
    
    # Handle completion with summary
    if status_info.get("status") == "done" and status_info.get("summary"):
        task_entry["status_final"] = "COMPLETED"
        task_entry["timestamp_completed"] = time.time()
        task_entry["summary"] = status_info["summary"]
        
        # Update individual tracks in child table based on summary
        summary = status_info["summary"]
        
        # Process successful tracks
        for track in summary.get("successful_tracks", []):
            if isinstance(track, dict):
                # Find matching track in child table and update status
                conn = None
                try:
                    conn = sqlite3.connect(HISTORY_DB_FILE)
                    cursor = conn.cursor()
                    
                    # Try to match by title and artist
                    track_title = track.get("title", "")
                    cursor.execute(
                        f"SELECT track_id FROM {children_table} WHERE title = ? AND parent_task_id = ?",
                        (track_title, task_id)
                    )
                    result = cursor.fetchone()
                    
                    if result:
                        add_track_status_update(
                            track_id=result[0],
                            table_name=children_table,
                            status_type="done",
                            status_data={"status": "done"},
                            progress_info={"progress": 100}
                        )
                except Exception as e:
                    logger.error(f"Error updating successful track: {e}")
                finally:
                    if conn:
                        conn.close()
        
        # Process skipped tracks
        for track in summary.get("skipped_tracks", []):
            if isinstance(track, dict):
                # Similar matching and update logic
                conn = None
                try:
                    conn = sqlite3.connect(HISTORY_DB_FILE)
                    cursor = conn.cursor()
                    
                    track_title = track.get("title", "")
                    cursor.execute(
                        f"SELECT track_id FROM {children_table} WHERE title = ? AND parent_task_id = ?",
                        (track_title, task_id)
                    )
                    result = cursor.fetchone()
                    
                    if result:
                        add_track_status_update(
                            track_id=result[0],
                            table_name=children_table,
                            status_type="skipped",
                            status_data={"status": "skipped"},
                            error_info={"reason": "Skipped during processing"}
                        )
                except Exception as e:
                    logger.error(f"Error updating skipped track: {e}")
                finally:
                    if conn:
                        conn.close()
        
        # Process failed tracks
        for failed_track in summary.get("failed_tracks", []):
            track = failed_track.get("track", {}) if isinstance(failed_track, dict) else failed_track
            reason = failed_track.get("reason", "Unknown error") if isinstance(failed_track, dict) else "Download failed"
            
            if isinstance(track, dict):
                conn = None
                try:
                    conn = sqlite3.connect(HISTORY_DB_FILE)
                    cursor = conn.cursor()
                    
                    track_title = track.get("title", "")
                    cursor.execute(
                        f"SELECT track_id FROM {children_table} WHERE title = ? AND parent_task_id = ?",
                        (track_title, task_id)
                    )
                    result = cursor.fetchone()
                    
                    if result:
                        add_track_status_update(
                            track_id=result[0],
                            table_name=children_table,
                            status_type="error",
                            status_data={"status": "error"},
                            error_info={"message": reason}
                        )
                except Exception as e:
                    logger.error(f"Error updating failed track: {e}")
                finally:
                    if conn:
                        conn.close()
    
    add_task_to_history(task_entry)
    add_status_update(task_id, status_info.get("status", "initializing"), status_info)


def _process_playlist_callback(callback_obj: Dict, task_id: str):
    """Process a playlistCallbackObject with comprehensive track management."""
    playlist_data = callback_obj.get("playlist", {})
    status_info = callback_obj.get("status_info", {})
    
    # Create children table for tracks
    children_table = create_child_table(task_id, "playlist")
    
    # Create main task entry  
    task_entry = {
        "task_id": task_id,
        "task_type": "playlist",
        "title": playlist_data.get("title", ""),
        "metadata": playlist_data,
        "children_table": children_table,
        "status_current": status_info.get("status", "initializing")
    }
    
    # Add playlist owner info to metadata if available
    if playlist_data.get("owner"):
        task_entry["metadata"]["owner_info"] = playlist_data["owner"]
    
    # Initialize tracks in child table when playlist processing starts
    if status_info.get("status") == "initializing" and playlist_data.get("tracks"):
        for track in playlist_data["tracks"]:
            track_data = {
                "track_data": track,
                "position": track.get("position", 0),
                "status_current": "initializing",
                "timestamp_created": time.time()
            }
            add_child_track(task_id, track_data)
    
    # Handle completion with summary
    if status_info.get("status") == "done" and status_info.get("summary"):
        task_entry["status_final"] = "COMPLETED"
        task_entry["timestamp_completed"] = time.time()
        task_entry["summary"] = status_info["summary"]
        
        # Update individual tracks in child table based on summary
        summary = status_info["summary"]
        
        # Process successful tracks
        for track in summary.get("successful_tracks", []):
            if isinstance(track, dict):
                # Find matching track in child table and update status
                conn = None
                try:
                    conn = sqlite3.connect(HISTORY_DB_FILE)
                    cursor = conn.cursor()
                    
                    # Try to match by title and position
                    track_title = track.get("title", "")
                    track_position = track.get("position", 0)
                    cursor.execute(
                        f"SELECT track_id FROM {children_table} WHERE title = ? AND position = ? AND parent_task_id = ?",
                        (track_title, track_position, task_id)
                    )
                    result = cursor.fetchone()
                    
                    if result:
                        add_track_status_update(
                            track_id=result[0],
                            table_name=children_table,
                            status_type="done",
                            status_data={"status": "done"},
                            progress_info={"progress": 100}
                        )
                except Exception as e:
                    logger.error(f"Error updating successful playlist track: {e}")
                finally:
                    if conn:
                        conn.close()
        
        # Process skipped tracks
        for track in summary.get("skipped_tracks", []):
            if isinstance(track, dict):
                conn = None
                try:
                    conn = sqlite3.connect(HISTORY_DB_FILE)  
                    cursor = conn.cursor()
                    
                    track_title = track.get("title", "")
                    track_position = track.get("position", 0)
                    cursor.execute(
                        f"SELECT track_id FROM {children_table} WHERE title = ? AND position = ? AND parent_task_id = ?",
                        (track_title, track_position, task_id)
                    )
                    result = cursor.fetchone()
                    
                    if result:
                        add_track_status_update(
                            track_id=result[0],
                            table_name=children_table,
                            status_type="skipped",
                            status_data={"status": "skipped"},
                            error_info={"reason": "Skipped during processing"}
                        )
                except Exception as e:
                    logger.error(f"Error updating skipped playlist track: {e}")
                finally:
                    if conn:
                        conn.close()
        
        # Process failed tracks
        for failed_track in summary.get("failed_tracks", []):
            track = failed_track.get("track", {}) if isinstance(failed_track, dict) else failed_track
            reason = failed_track.get("reason", "Unknown error") if isinstance(failed_track, dict) else "Download failed"
            
            if isinstance(track, dict):
                conn = None
                try:
                    conn = sqlite3.connect(HISTORY_DB_FILE)
                    cursor = conn.cursor()
                    
                    track_title = track.get("title", "")
                    track_position = track.get("position", 0)
                    cursor.execute(
                        f"SELECT track_id FROM {children_table} WHERE title = ? AND position = ? AND parent_task_id = ?",
                        (track_title, track_position, task_id)
                    )
                    result = cursor.fetchone()
                    
                    if result:
                        add_track_status_update(
                            track_id=result[0],
                            table_name=children_table,
                            status_type="error",
                            status_data={"status": "error"},
                            error_info={"message": reason}
                        )
                except Exception as e:
                    logger.error(f"Error updating failed playlist track: {e}")
                finally:
                    if conn:
                        conn.close()
    
    add_task_to_history(task_entry)
    add_status_update(task_id, status_info.get("status", "initializing"), status_info)


# Legacy compatibility functions
def add_entry_to_history(history_data: dict):
    """Legacy compatibility function - converts old format to new."""
    logger.warning("Using legacy add_entry_to_history - consider migrating to add_task_to_history")
    
    converted = _convert_old_record_to_new(history_data)
    if converted:
        add_task_to_history(converted)


def add_tracks_from_summary(summary_data, parent_task_id, parent_history_data=None):
    """Legacy compatibility function - processes a summary object from a completed task and adds individual track entries.
    
    Args:
        summary_data (dict): The summary data containing track lists
        parent_task_id (str): The ID of the parent task
        parent_history_data (dict, optional): The history data of the parent task
    
    Returns:
        dict: Summary of processed tracks
    """
    logger.warning("Using legacy add_tracks_from_summary - consider migrating to add_child_track and process_callback_object")
    
    processed = {
        "successful": 0,
        "skipped": 0,
        "failed": 0
    }
    
    if not summary_data:
        logger.warning(f"No summary data provided for task {parent_task_id}")
        return processed
    
    # Check if parent task has a children table, if not create one
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("SELECT children_table, task_type FROM download_tasks WHERE task_id = ?", (parent_task_id,))
        result = cursor.fetchone()
        
        children_table = None
        if result:
            children_table = result[0]
            task_type = result[1] or "album"
            
            # Create children table if it doesn't exist
            if not children_table:
                children_table = create_child_table(parent_task_id, task_type)
                cursor.execute("UPDATE download_tasks SET children_table = ? WHERE task_id = ?", 
                             (children_table, parent_task_id))
                conn.commit()
        else:
            # Parent task doesn't exist, create a basic one
            logger.warning(f"Parent task {parent_task_id} not found, creating basic entry...")
            task_data = {
                "task_id": parent_task_id,
                "task_type": "album",
                "title": "Unknown Album",
                "status_final": "COMPLETED",
                "children_table": create_child_table(parent_task_id, "album")
            }
            add_task_to_history(task_data)
            children_table = task_data["children_table"]
    
    except Exception as e:
        logger.error(f"Error setting up children table for {parent_task_id}: {e}")
    finally:
        if conn:
            conn.close()
    
    # Process successful tracks
    for track_entry in summary_data.get("successful_tracks", []):
        try:
            # Parse "track_name - artist_name" format or handle trackObject
            if isinstance(track_entry, dict):
                # Handle trackObject
                track_data = {
                    "track_data": track_entry,
                    "status_final": "COMPLETED",
                    "timestamp_completed": time.time()
                }
            else:
                # Handle string format "track_name - artist_name"
                parts = track_entry.split(" - ", 1)
                if len(parts) == 2:
                    track_name, artist_name = parts
                    track_data = {
                        "track_data": {
                            "title": track_name,
                            "artists": [{"name": artist_name}]
                        },
                        "status_final": "COMPLETED",
                        "timestamp_completed": time.time()
                    }
                else:
                    logger.warning(f"Could not parse track entry: {track_entry}")
                    continue
            
            add_child_track(parent_task_id, track_data)
            processed["successful"] += 1
            
        except Exception as e:
            logger.error(f"Error processing successful track {track_entry}: {e}", exc_info=True)
    
    # Process skipped tracks
    for track_entry in summary_data.get("skipped_tracks", []):
        try:
            if isinstance(track_entry, dict):
                # Handle trackObject
                track_data = {
                    "track_data": track_entry,
                    "status_final": "SKIPPED",
                    "timestamp_completed": time.time()
                }
            else:
                # Handle string format
                parts = track_entry.split(" - ", 1)
                if len(parts) == 2:
                    track_name, artist_name = parts
                    track_data = {
                        "track_data": {
                            "title": track_name,
                            "artists": [{"name": artist_name}]
                        },
                        "status_final": "SKIPPED",
                        "timestamp_completed": time.time()
                    }
                else:
                    logger.warning(f"Could not parse skipped track entry: {track_entry}")
                    continue
            
            add_child_track(parent_task_id, track_data)
            processed["skipped"] += 1
            
        except Exception as e:
            logger.error(f"Error processing skipped track {track_entry}: {e}", exc_info=True)
    
    # Process failed tracks  
    for track_entry in summary_data.get("failed_tracks", []):
        try:
            if isinstance(track_entry, dict):
                # Handle failedTrackObject or trackObject
                if "track" in track_entry:
                    # failedTrackObject format
                    track_obj = track_entry["track"]
                    error_reason = track_entry.get("reason", "Unknown error")
                    track_data = {
                        "track_data": track_obj,
                        "status_final": "ERROR",
                        "error_info": {"message": error_reason},
                        "timestamp_completed": time.time()
                    }
                else:
                    # Plain trackObject
                    track_data = {
                        "track_data": track_entry,
                        "status_final": "ERROR",
                        "timestamp_completed": time.time()
                    }
            else:
                # Handle string format
                parts = track_entry.split(" - ", 1)
                if len(parts) == 2:
                    track_name, artist_name = parts
                    track_data = {
                        "track_data": {
                            "title": track_name,
                            "artists": [{"name": artist_name}]
                        },
                        "status_final": "ERROR",
                        "timestamp_completed": time.time()
                    }
                else:
                    logger.warning(f"Could not parse failed track entry: {track_entry}")
                    continue
            
            add_child_track(parent_task_id, track_data)
            processed["failed"] += 1
            
        except Exception as e:
            logger.error(f"Error processing failed track {track_entry}: {e}", exc_info=True)
    
    logger.info(
        f"Added {processed['successful']} successful, {processed['skipped']} skipped, "
        f"and {processed['failed']} failed track entries for task {parent_task_id}"
    )
    
    return processed


def get_history_entries(limit=25, offset=0, sort_by="timestamp_completed", sort_order="DESC", filters=None):
    """Legacy compatibility function."""
    logger.warning("Using legacy get_history_entries - consider migrating to get_task_history")
    
    # Map old sort_by to new fields
    sort_mapping = {
        "timestamp_completed": "timestamp_completed",
        "timestamp_added": "timestamp_created",
        "item_name": "title"
    }
    
    new_sort_by = sort_mapping.get(sort_by, "timestamp_updated")
    return get_task_history(limit, offset, new_sort_by, sort_order, filters)


def get_track_mini_history(track_id: str, table_name: str) -> Dict:
    """Get comprehensive mini-history for a specific track."""
    conn = None
    try:
        conn = sqlite3.connect(HISTORY_DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute(f"SELECT * FROM {table_name} WHERE track_id = ?", (track_id,))
        result = cursor.fetchone()
        
        if not result:
            return {}
        
        track_info = dict(result)
        
        # Parse JSON fields
        json_fields = ["track_data", "artists_data", "album_data", "ids_data", 
                      "status_history", "error_info", "progress_info", "config"]
        
        for field in json_fields:
            if track_info.get(field):
                try:
                    track_info[field] = json.loads(track_info[field])
                except json.JSONDecodeError:
                    pass
        
        # Calculate duration statistics
        if track_info.get("timestamp_started") and track_info.get("timestamp_completed"):
            track_info["calculated_duration"] = track_info["timestamp_completed"] - track_info["timestamp_started"]
        
        # Add progress timeline
        if track_info.get("status_history"):
            track_info["timeline"] = []
            for entry in track_info["status_history"]:
                timeline_entry = {
                    "timestamp": entry.get("timestamp"),
                    "status": entry.get("status_type"),
                    "readable_time": datetime.fromtimestamp(entry.get("timestamp", 0)).isoformat() if entry.get("timestamp") else None
                }
                if entry.get("progress_info"):
                    timeline_entry["progress"] = entry["progress_info"]
                if entry.get("error_info"):
                    timeline_entry["error"] = entry["error_info"]
                track_info["timeline"].append(timeline_entry)
        
        return track_info
        
    except Exception as e:
        logger.error(f"Error getting track mini-history: {e}")
        return {}
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    # Test the enhanced system
    logging.basicConfig(level=logging.INFO)
    init_history_db()
    
    # Test track task
    track_task = {
        "task_id": "test_track_001",
        "task_type": "track",
        "title": "Test Song",
        "artists": [{"name": "Test Artist"}],
        "ids": {"spotify": "track123"},
        "status_final": "COMPLETED",
        "metadata": {
            "type": "track",
            "title": "Test Song",
            "duration_ms": 240000,
            "artists": [{"name": "Test Artist"}]
        },
        "config": {"quality_profile": "NORMAL", "service_used": "Spotify"}
    }
    
    add_task_to_history(track_task)
    
    # Test album task with comprehensive track management
    album_task = {
        "task_id": "test_album_001", 
        "task_type": "album",
        "title": "Test Album",
        "artists": [{"name": "Test Artist"}],
        "ids": {"spotify": "album123"},
        "children_table": create_child_table("test_album_001", "album")
    }
    
    add_task_to_history(album_task)
    
    # Add tracks with comprehensive data to the album
    for i in range(3):
        track_data = {
            "track_data": {
                "title": f"Track {i+1}",
                "track_number": i+1,
                "disc_number": 1,
                "duration_ms": 180000 + (i * 20000),
                "explicit": False,
                "artists": [{"name": "Test Artist", "ids": {"spotify": f"artist{i}"}}],
                "ids": {"spotify": f"track{i}", "isrc": f"TEST{i:03d}"}
            },
            "position": i+1,
            "status_current": "initializing",
            "status_history": [
                {
                    "timestamp": time.time() - 300,
                    "status_type": "initializing", 
                    "status_data": {"status": "initializing"}
                },
                {
                    "timestamp": time.time() - 200,
                    "status_type": "real-time",
                    "status_data": {"status": "real-time", "progress": 50},
                    "progress_info": {"progress": 50, "time_elapsed": 100}
                },
                {
                    "timestamp": time.time() - 100,
                    "status_type": "done",
                    "status_data": {"status": "done"},
                    "progress_info": {"progress": 100}
                }
            ],
            "timestamp_started": time.time() - 300,
            "timestamp_completed": time.time() - 100,
            "status_final": "COMPLETED",
            "time_elapsed": 200,
            "quality_achieved": "FLAC 1411kbps",
            "file_size": 45000000 + (i * 5000000),
            "download_path": f"/downloads/Test Album/Track {i+1}.flac"
        }
        track_id = add_child_track("test_album_001", track_data)
        print(f"Added track with comprehensive data: {track_id}")
    
    # Test retrieval
    tasks, total = get_task_history(limit=10, include_children=True)
    print(f"\nFound {total} tasks:")
    for task in tasks:
        print(f"- {task['title']} ({task['task_type']}) - {task.get('status_final', 'N/A')}")
        if task.get('child_tracks'):
            print(f"  {len(task['child_tracks'])} child tracks:")
            for child in task['child_tracks'][:2]:  # Show first 2 tracks
                print(f"    • {child.get('title', 'Unknown')} - {child.get('status_final', 'N/A')}")
                if child.get("status_history"):
                    print(f"      Status changes: {len(child['status_history'])}")
                if child.get("quality_achieved"):
                    print(f"      Quality: {child['quality_achieved']}")
    
    # Test track mini-history
    if tasks:
        for task in tasks:
            if task.get('child_tracks'):
                first_track = task['child_tracks'][0]
                mini_history = get_track_mini_history(first_track['track_id'], task['children_table'])
                if mini_history.get('timeline'):
                    print(f"\nMini-history for '{mini_history.get('title', 'Unknown')}':")
                    for event in mini_history['timeline']:
                        print(f"  {event['readable_time']}: {event['status']}")
                        if event.get('progress'):
                            print(f"    Progress: {event['progress']}")
                break
