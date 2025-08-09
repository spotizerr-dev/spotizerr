import sqlite3
import json
import uuid
import time
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
from contextlib import contextmanager

logger = logging.getLogger(__name__)

class HistoryManager:
    """
    Manages download history storage using SQLite database.
    Stores hierarchical download data from deezspot callback objects.
    """
    
    def __init__(self, db_path: str = "data/history/download_history.db"):
        """
        Initialize the history manager with database path.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_database_exists()
    
    def _ensure_database_exists(self):
        """Create database and main table if they don't exist and migrate schema safely."""
        expected_download_history_columns: Dict[str, str] = {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "download_type": "TEXT NOT NULL",
            "title": "TEXT NOT NULL",
            "artists": "TEXT",
            "timestamp": "REAL NOT NULL",
            "status": "TEXT NOT NULL",
            "service": "TEXT",
            "quality_format": "TEXT",
            "quality_bitrate": "TEXT",
            "total_tracks": "INTEGER",
            "successful_tracks": "INTEGER",
            "failed_tracks": "INTEGER",
            "skipped_tracks": "INTEGER",
            "children_table": "TEXT",
            "task_id": "TEXT",
            "external_ids": "TEXT",
            "metadata": "TEXT",
            "release_date": "TEXT",
            "genres": "TEXT",
            "images": "TEXT",
            "owner": "TEXT",
            "album_type": "TEXT",
            "duration_total_ms": "INTEGER",
            "explicit": "BOOLEAN"
        }

        with self._get_connection() as conn:
            cursor = conn.cursor()
            # 1) Create table if missing with minimal schema
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS download_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    download_type TEXT NOT NULL,
                    title TEXT NOT NULL
                )
            """)

            # 2) Ensure/upgrade schema columns idempotently
            self._ensure_table_schema(cursor, "download_history", expected_download_history_columns, "download history")

            # 3) Migrate legacy columns to new ones (best-effort, non-fatal)
            try:
                cursor.execute("PRAGMA table_info(download_history)")
                cols = {row[1] for row in cursor.fetchall()}

                # Legacy timestamp columns → timestamp
                if "timestamp" not in cols:
                    # Add column first
                    cursor.execute("ALTER TABLE download_history ADD COLUMN timestamp REAL")
                    # Backfill from legacy columns if present
                    legacy_time_cols = [c for c in ["time", "created_at", "date"] if c in cols]
                    if legacy_time_cols:
                        # Pick the first legacy column to backfill
                        legacy_col = legacy_time_cols[0]
                        try:
                            cursor.execute(f"UPDATE download_history SET timestamp = CASE WHEN {legacy_col} IS NOT NULL THEN {legacy_col} ELSE strftime('%s','now') END")
                        except sqlite3.Error:
                            # Fallback: just set to now
                            cursor.execute("UPDATE download_history SET timestamp = strftime('%s','now')")
                    else:
                        # Default all to now if nothing to migrate
                        cursor.execute("UPDATE download_history SET timestamp = strftime('%s','now')")
                
                # quality → quality_format, bitrate → quality_bitrate
                # Handle common legacy pairs non-fataly
                cursor.execute("PRAGMA table_info(download_history)")
                cols = {row[1] for row in cursor.fetchall()}
                if "quality_format" not in cols and "quality" in cols:
                    cursor.execute("ALTER TABLE download_history ADD COLUMN quality_format TEXT")
                    try:
                        cursor.execute("UPDATE download_history SET quality_format = quality WHERE quality_format IS NULL")
                    except sqlite3.Error:
                        pass
                if "quality_bitrate" not in cols and "bitrate" in cols:
                    cursor.execute("ALTER TABLE download_history ADD COLUMN quality_bitrate TEXT")
                    try:
                        cursor.execute("UPDATE download_history SET quality_bitrate = bitrate WHERE quality_bitrate IS NULL")
                    except sqlite3.Error:
                        pass
            except Exception as e:
                logger.warning(f"Non-fatal: failed legacy column migration for download_history: {e}")

            # 4) Create indexes only if columns exist (avoid startup failures)
            try:
                cursor.execute("PRAGMA table_info(download_history)")
                cols = {row[1] for row in cursor.fetchall()}

                if "timestamp" in cols:
                    cursor.execute("""
                        CREATE INDEX IF NOT EXISTS idx_download_history_timestamp
                        ON download_history(timestamp)
                    """)
                if {"download_type", "status"}.issubset(cols):
                    cursor.execute("""
                        CREATE INDEX IF NOT EXISTS idx_download_history_type_status
                        ON download_history(download_type, status)
                    """)
                if "task_id" in cols:
                    cursor.execute("""
                        CREATE INDEX IF NOT EXISTS idx_download_history_task_id
                        ON download_history(task_id)
                    """)
                # Preserve uniqueness from previous schema using a unique index (safer than table constraint for migrations)
                if {"task_id", "download_type", "external_ids"}.issubset(cols):
                    cursor.execute(
                        """
                        CREATE UNIQUE INDEX IF NOT EXISTS uq_download_history_task_type_ids
                        ON download_history(task_id, download_type, external_ids)
                        """
                    )
            except Exception as e:
                logger.warning(f"Non-fatal: failed to create indexes for download_history: {e}")

            # 5) Best-effort upgrade of existing children tables (album_*, playlist_*)
            try:
                self._migrate_existing_children_tables(cursor)
            except Exception as e:
                logger.warning(f"Non-fatal: failed to migrate children tables: {e}")
            
    @contextmanager
    def _get_connection(self):
        """Get database connection with proper error handling."""
        conn = None
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row  # Enable dict-like row access
            yield conn
            conn.commit()
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            if conn:
                conn.close()
    
    def _ensure_table_schema(self, cursor: sqlite3.Cursor, table_name: str, expected_columns: Dict[str, str], table_description: str) -> None:
        """Ensure all expected columns exist in the given table, adding any missing columns."""
        try:
            cursor.execute(f"PRAGMA table_info({table_name})")
            existing_info = cursor.fetchall()
            existing_names = {row[1] for row in existing_info}

            for col_name, col_type in expected_columns.items():
                if col_name not in existing_names:
                    # Avoid adding PRIMARY KEY on existing tables; strip it for ALTER
                    col_type_for_add = col_type.replace("PRIMARY KEY", "").replace("AUTOINCREMENT", "").strip()
                    try:
                        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type_for_add}")
                        logger.info(f"Added missing column '{col_name} {col_type_for_add}' to {table_description} table '{table_name}'.")
                    except sqlite3.Error as e:
                        logger.warning(f"Could not add column '{col_name}' to {table_description} table '{table_name}': {e}")
        except sqlite3.Error as e:
            logger.error(f"Error ensuring schema for {table_description} table '{table_name}': {e}")

    def _create_children_table(self, table_name: str):
        """
        Create a children table for storing individual tracks of an album/playlist.
        Ensures schema upgrades for existing tables.
        
        Args:
            table_name: Name of the children table (e.g., 'album_abc123')
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    artists TEXT,
                    album_title TEXT,
                    duration_ms INTEGER,
                    track_number INTEGER,
                    disc_number INTEGER,
                    explicit BOOLEAN,
                    status TEXT NOT NULL,
                    external_ids TEXT,
                    genres TEXT,
                    isrc TEXT,
                    timestamp REAL NOT NULL,
                    position INTEGER,
                    metadata TEXT
                )
            """)
            expected_children_columns = {
                "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
                "title": "TEXT NOT NULL",
                "artists": "TEXT",
                "album_title": "TEXT",
                "duration_ms": "INTEGER",
                "track_number": "INTEGER",
                "disc_number": "INTEGER",
                "explicit": "BOOLEAN",
                "status": "TEXT NOT NULL",
                "external_ids": "TEXT",
                "genres": "TEXT",
                "isrc": "TEXT",
                "timestamp": "REAL NOT NULL",
                "position": "INTEGER",
                "metadata": "TEXT",
            }
            self._ensure_table_schema(cursor, table_name, expected_children_columns, "children history")

    def _migrate_existing_children_tables(self, cursor: sqlite3.Cursor) -> None:
        """Find album_* and playlist_* children tables and ensure they have the expected schema."""
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'album_%' OR name LIKE 'playlist_%')")
        tables = [row[0] for row in cursor.fetchall() if row[0] != "download_history"]
        for t in tables:
            try:
                # Ensure existence + schema upgrades
                cursor.execute(f"CREATE TABLE IF NOT EXISTS {t} (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)")
                self._create_children_table(t)
            except Exception as e:
                logger.warning(f"Non-fatal: failed to migrate children table {t}: {e}")
    
    def _extract_artists(self, obj: Dict) -> List[str]:
        """Extract artist names from various object types."""
        artists = obj.get("artists", [])
        if not artists:
            return []
        
        artist_names = []
        for artist in artists:
            if isinstance(artist, dict):
                name = artist.get("name", "")
                if name:
                    artist_names.append(name)
            elif isinstance(artist, str):
                artist_names.append(artist)
        
        return artist_names
    
    def _extract_external_ids(self, obj: Dict) -> Dict:
        """Extract external service IDs from object."""
        return obj.get("ids", {})
    
    def _extract_images(self, obj: Dict) -> List[Dict]:
        """Extract image information from object."""
        return obj.get("images", [])
    
    def _extract_release_date(self, obj: Dict) -> Dict:
        """Extract release date information from object."""
        return obj.get("release_date", {})
    
    def _calculate_total_duration(self, tracks: List[Dict]) -> int:
        """Calculate total duration from tracks list."""
        total = 0
        for track in tracks:
            duration = track.get("duration_ms", 0)
            if duration:
                total += duration
        return total
    
    def _get_primary_service(self, external_ids: Dict) -> str:
        """Determine primary service from external IDs."""
        if "spotify" in external_ids:
            return "spotify"
        elif "deezer" in external_ids:
            return "deezer"
        else:
            return "unknown"
    
    def create_children_table_for_album(self, callback_data: Dict, task_id: str) -> str:
        """
        Create children table for album download at the start and return table name.
        
        Args:
            callback_data: Album callback object from deezspot  
            task_id: Celery task ID
            
        Returns:
            Children table name
        """
        # Generate children table name
        album_uuid = str(uuid.uuid4()).replace("-", "")[:10]
        children_table = f"album_{album_uuid}"
        
        # Create the children table
        self._create_children_table(children_table)
        
        logger.info(f"Created album children table {children_table} for task {task_id}")
        return children_table
    
    def create_children_table_for_playlist(self, callback_data: Dict, task_id: str) -> str:
        """
        Create children table for playlist download at the start and return table name.
        
        Args:
            callback_data: Playlist callback object from deezspot
            task_id: Celery task ID
            
        Returns:
            Children table name
        """
        # Generate children table name
        playlist_uuid = str(uuid.uuid4()).replace("-", "")[:10]
        children_table = f"playlist_{playlist_uuid}"
        
        # Create the children table
        self._create_children_table(children_table)
        
        logger.info(f"Created playlist children table {children_table} for task {task_id}")
        return children_table
    
    def store_track_history(self, callback_data: Dict, task_id: str, status: str = "completed", table: str = "download_history"):
        """
        Store individual track download history.
        
        Args:
            callback_data: Track callback object from deezspot
            task_id: Celery task ID
            status: Download status ('completed', 'failed', 'skipped')
            table: Target table name (defaults to 'download_history', can be a children table name)
        """
        try:
            track = callback_data.get("track", {})
            status_info = callback_data.get("status_info", {})
            
            if not track:
                logger.warning(f"No track data in callback for task {task_id}")
                return
            
            artists = self._extract_artists(track)
            external_ids = self._extract_external_ids(track)
            
            album = track.get("album", {})
            album_title = album.get("title", "")
            
            # Prepare metadata
            metadata = {
                "callback_type": "track",
                "parent": callback_data.get("parent"),
                "current_track": callback_data.get("current_track"),
                "total_tracks": callback_data.get("total_tracks"),
                "album": album,
                "status_info": status_info
            }
            
            with self._get_connection() as conn:
                if table == "download_history":
                    # Store in main download_history table
                    logger.info(f"Storing track '{track.get('title', 'Unknown')}' in MAIN table for task {task_id}")
                    conn.execute("""
                        INSERT OR REPLACE INTO download_history (
                            download_type, title, artists, timestamp, status, service,
                            quality_format, quality_bitrate, task_id, external_ids,
                            metadata, release_date, genres, explicit, album_type,
                            duration_total_ms
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        "track",
                        track.get("title", "Unknown"),
                        json.dumps(artists),
                        callback_data.get("timestamp", time.time()),
                        status,
                        self._get_primary_service(external_ids),
                        status_info.get("convert_to"),
                        status_info.get("bitrate"),
                        task_id,
                        json.dumps(external_ids),
                        json.dumps(metadata),
                        json.dumps(self._extract_release_date(album)),
                        json.dumps(track.get("genres", [])),
                        track.get("explicit", False),
                        album.get("album_type"),
                        track.get("duration_ms", 0)
                    ))
                else:
                    # Ensure target children table exists before write
                    self._create_children_table(table)
                    # Store in children table (for album/playlist tracks)
                    logger.info(f"Storing track '{track.get('title', 'Unknown')}' in CHILDREN table '{table}' for task {task_id}")
                    # Extract ISRC
                    isrc = external_ids.get("isrc", "")
                    
                    # Prepare children table metadata
                    children_metadata = {
                        "album": album,
                        "type": track.get("type", ""),
                        "callback_type": "track",
                        "parent": callback_data.get("parent"),
                        "current_track": callback_data.get("current_track"),
                        "total_tracks": callback_data.get("total_tracks"),
                        "status_info": status_info
                    }
                    
                    conn.execute(f"""
                        INSERT INTO {table} (
                            title, artists, album_title, duration_ms, track_number,
                            disc_number, explicit, status, external_ids, genres,
                            isrc, timestamp, position, metadata
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        track.get("title", "Unknown"),
                        json.dumps(artists),
                        album_title,
                        track.get("duration_ms", 0),
                        track.get("track_number", 0),
                        track.get("disc_number", 1),
                        track.get("explicit", False),
                        status,
                        json.dumps(external_ids),
                        json.dumps(track.get("genres", [])),
                        isrc,
                        callback_data.get("timestamp", time.time()),
                        track.get("position", 0),  # For playlist tracks
                        json.dumps(children_metadata)
                    ))
            
            logger.info(f"Successfully stored track '{track.get('title')}' in table '{table}' (task: {task_id})")
            
        except Exception as e:
            logger.error(f"Failed to store track history for task {task_id}: {e}")
    
    def store_album_history(self, callback_data: Dict, task_id: str, status: str = "completed"):
        """
        Store album download history with children table for individual tracks.
        
        Args:
            callback_data: Album callback object from deezspot  
            task_id: Celery task ID
            status: Download status ('completed', 'failed', 'in_progress')
            
        Returns:
            Children table name when status is 'in_progress', None otherwise
        """
        try:
            album = callback_data.get("album", {})
            status_info = callback_data.get("status_info", {})
            
            if not album:
                logger.warning(f"No album data in callback for task {task_id}")
                return None
            
            if status == "in_progress":
                # Phase 1: Create children table at start, don't store album entry yet
                children_table = self.create_children_table_for_album(callback_data, task_id)
                logger.info(f"Album download started for task {task_id}, children table: {children_table}")
                return children_table
            
            # Phase 2: Store album entry in main table (for completed/failed status)
            artists = self._extract_artists(album)
            external_ids = self._extract_external_ids(album)
            
            # For completed/failed, we need to find the existing children table
            # This should be stored in task info by the celery task
            from routes.utils.celery_tasks import get_task_info
            task_info = get_task_info(task_id)
            children_table = task_info.get("children_table")
            
            if not children_table:
                # Fallback: generate new children table name (shouldn't happen in normal flow)
                album_uuid = str(uuid.uuid4()).replace("-", "")[:10]
                children_table = f"album_{album_uuid}"
                logger.warning(f"No children table found for album task {task_id}, generating new: {children_table}")
            
            # Extract summary data if available (from 'done' status)
            summary = status_info.get("summary", {})
            successful_tracks = summary.get("total_successful", 0)
            failed_tracks = summary.get("total_failed", 0) 
            skipped_tracks = summary.get("total_skipped", 0)
            total_tracks = album.get("total_tracks", 0)
            
            # Calculate total duration
            tracks = album.get("tracks", [])
            total_duration = self._calculate_total_duration(tracks)
            
            # Prepare metadata
            metadata = {
                "callback_type": "album",
                "status_info": status_info,
                "copyrights": album.get("copyrights", []),
                "tracks": tracks  # Store track list in metadata
            }
            
            with self._get_connection() as conn:
                # Store main album entry
                conn.execute("""
                    INSERT OR REPLACE INTO download_history (
                        download_type, title, artists, timestamp, status, service,
                        quality_format, quality_bitrate, total_tracks, successful_tracks,
                        failed_tracks, skipped_tracks, children_table, task_id,
                        external_ids, metadata, release_date, genres, images,
                        album_type, duration_total_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    "album",
                    album.get("title", "Unknown"),
                    json.dumps(artists),
                    callback_data.get("timestamp", time.time()),
                    status,
                    self._get_primary_service(external_ids),
                    status_info.get("convert_to"),
                    status_info.get("bitrate"),
                    total_tracks,
                    successful_tracks,
                    failed_tracks,
                    skipped_tracks,
                    children_table,
                    task_id,
                    json.dumps(external_ids),
                    json.dumps(metadata),
                    json.dumps(self._extract_release_date(album)),
                    json.dumps(album.get("genres", [])),
                    json.dumps(self._extract_images(album)),
                    album.get("album_type"),
                    total_duration
                ))
            
            # Children table is populated progressively during track processing, not from summary
            
            logger.info(f"Stored album history for '{album.get('title')}' (task: {task_id}, children: {children_table})")
            return None
            
        except Exception as e:
            logger.error(f"Failed to store album history for task {task_id}: {e}")
            return None
    
    def store_playlist_history(self, callback_data: Dict, task_id: str, status: str = "completed"):
        """
        Store playlist download history with children table for individual tracks.
        
        Args:
            callback_data: Playlist callback object from deezspot
            task_id: Celery task ID  
            status: Download status ('completed', 'failed', 'in_progress')
            
        Returns:
            Children table name when status is 'in_progress', None otherwise
        """
        try:
            playlist = callback_data.get("playlist", {})
            status_info = callback_data.get("status_info", {})
            
            if not playlist:
                logger.warning(f"No playlist data in callback for task {task_id}")
                return None
            
            if status == "in_progress":
                # Phase 1: Create children table at start, don't store playlist entry yet
                children_table = self.create_children_table_for_playlist(callback_data, task_id)
                logger.info(f"Playlist download started for task {task_id}, children table: {children_table}")
                return children_table
            
            # Phase 2: Store playlist entry in main table (for completed/failed status)
            external_ids = self._extract_external_ids(playlist)
            
            # For completed/failed, we need to find the existing children table
            # This should be stored in task info by the celery task
            from routes.utils.celery_tasks import get_task_info
            task_info = get_task_info(task_id)
            children_table = task_info.get("children_table")
            
            if not children_table:
                # Fallback: generate new children table name (shouldn't happen in normal flow)
                playlist_uuid = str(uuid.uuid4()).replace("-", "")[:10]
                children_table = f"playlist_{playlist_uuid}"
                logger.warning(f"No children table found for playlist task {task_id}, generating new: {children_table}")
            
            # Extract summary data if available
            summary = status_info.get("summary", {})
            successful_tracks = summary.get("total_successful", 0)
            failed_tracks = summary.get("total_failed", 0)
            skipped_tracks = summary.get("total_skipped", 0)
            
            tracks = playlist.get("tracks", [])
            total_tracks = len(tracks)
            total_duration = self._calculate_total_duration(tracks)
            
            # Extract owner information
            owner = playlist.get("owner", {})
            
            # Prepare metadata  
            metadata = {
                "callback_type": "playlist",
                "status_info": status_info,
                "description": playlist.get("description", ""),
                "tracks": tracks  # Store track list in metadata
            }
            
            with self._get_connection() as conn:
                # Store main playlist entry
                conn.execute("""
                    INSERT OR REPLACE INTO download_history (
                        download_type, title, artists, timestamp, status, service,
                        quality_format, quality_bitrate, total_tracks, successful_tracks,
                        failed_tracks, skipped_tracks, children_table, task_id,
                        external_ids, metadata, genres, images, owner,
                        duration_total_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    "playlist", 
                    playlist.get("title", "Unknown"),
                    json.dumps([owner.get("name", "Unknown")]),  # Use owner as "artist"
                    callback_data.get("timestamp", time.time()),
                    status,
                    self._get_primary_service(external_ids),
                    status_info.get("convert_to"),
                    status_info.get("bitrate"),
                    total_tracks,
                    successful_tracks,
                    failed_tracks,
                    skipped_tracks,
                    children_table,
                    task_id,
                    json.dumps(external_ids),
                    json.dumps(metadata),
                    json.dumps([]),  # Playlists don't have genres typically
                    json.dumps(self._extract_images(playlist)),
                    json.dumps(owner),
                    total_duration
                ))
            
            # Children table is populated progressively during track processing, not from summary
            
            logger.info(f"Stored playlist history for '{playlist.get('title')}' (task: {task_id}, children: {children_table})")
            return None
            
        except Exception as e:
            logger.error(f"Failed to store playlist history for task {task_id}: {e}")
            return None
    
    def _populate_album_children_table(self, table_name: str, summary: Dict, album_title: str):
        """Populate children table with individual track records from album summary."""
        try:
            # Ensure table exists before population
            self._create_children_table(table_name)
            all_tracks = []
            
            # Add successful tracks
            for track in summary.get("successful_tracks", []):
                track_data = self._prepare_child_track_data(track, album_title, "completed")
                all_tracks.append(track_data)
            
            # Add failed tracks  
            for failed_item in summary.get("failed_tracks", []):
                track = failed_item.get("track", {})
                track_data = self._prepare_child_track_data(track, album_title, "failed")
                track_data["metadata"]["failure_reason"] = failed_item.get("reason", "Unknown error")
                all_tracks.append(track_data)
            
            # Add skipped tracks
            for track in summary.get("skipped_tracks", []):
                track_data = self._prepare_child_track_data(track, album_title, "skipped")
                all_tracks.append(track_data)
            
            # Insert all tracks
            with self._get_connection() as conn:
                for track_data in all_tracks:
                    conn.execute(f"""
                        INSERT INTO {table_name} (
                            title, artists, album_title, duration_ms, track_number,
                            disc_number, explicit, status, external_ids, genres,
                            isrc, timestamp, position, metadata
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, track_data["values"])
            
            logger.info(f"Populated {len(all_tracks)} tracks in children table {table_name}")
            
        except Exception as e:
            logger.error(f"Failed to populate album children table {table_name}: {e}")
    
    def _populate_playlist_children_table(self, table_name: str, summary: Dict):
        """Populate children table with individual track records from playlist summary."""
        try:
            # Ensure table exists before population
            self._create_children_table(table_name)
            all_tracks = []
            
            # Add successful tracks
            for track in summary.get("successful_tracks", []):
                track_data = self._prepare_child_track_data(track, "", "completed")
                all_tracks.append(track_data)
            
            # Add failed tracks
            for failed_item in summary.get("failed_tracks", []):
                track = failed_item.get("track", {})
                track_data = self._prepare_child_track_data(track, "", "failed")
                track_data["metadata"]["failure_reason"] = failed_item.get("reason", "Unknown error")
                all_tracks.append(track_data)
            
            # Add skipped tracks  
            for track in summary.get("skipped_tracks", []):
                track_data = self._prepare_child_track_data(track, "", "skipped")
                all_tracks.append(track_data)
            
            # Insert all tracks
            with self._get_connection() as conn:
                for track_data in all_tracks:
                    conn.execute(f"""
                        INSERT INTO {table_name} (
                            title, artists, album_title, duration_ms, track_number,
                            disc_number, explicit, status, external_ids, genres,
                            isrc, timestamp, position, metadata
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, track_data["values"])
            
            logger.info(f"Populated {len(all_tracks)} tracks in children table {table_name}")
            
        except Exception as e:
            logger.error(f"Failed to populate playlist children table {table_name}: {e}")
    
    def _prepare_child_track_data(self, track: Dict, default_album: str, status: str) -> Dict:
        """Prepare track data for insertion into children table."""
        artists = self._extract_artists(track)
        external_ids = self._extract_external_ids(track)
        
        # Get album info
        album = track.get("album", {})
        album_title = album.get("title", default_album)
        
        # Extract ISRC
        isrc = external_ids.get("isrc", "")
        
        # Prepare metadata
        metadata = {
            "album": album,
            "type": track.get("type", "")
        }
        
        values = (
            track.get("title", "Unknown"),
            json.dumps(artists),
            album_title,
            track.get("duration_ms", 0),
            track.get("track_number", 0),
            track.get("disc_number", 1),
            track.get("explicit", False),
            status,
            json.dumps(external_ids),
            json.dumps(track.get("genres", [])),
            isrc,
            time.time(),
            track.get("position", 0),  # For playlist tracks
            json.dumps(metadata)
        )
        
        return {"values": values, "metadata": metadata}
    
    def update_download_status(self, task_id: str, status: str):
        """Update download status for existing history entry."""
        try:
            with self._get_connection() as conn:
                conn.execute("""
                    UPDATE download_history 
                    SET status = ? 
                    WHERE task_id = ?
                """, (status, task_id))
            
            logger.info(f"Updated download status to '{status}' for task {task_id}")
            
        except Exception as e:
            logger.error(f"Failed to update download status for task {task_id}: {e}")
    
    def get_download_history(self, limit: int = 100, offset: int = 0, 
                           download_type: Optional[str] = None,
                           status: Optional[str] = None) -> List[Dict]:
        """
        Retrieve download history with optional filtering.
        
        Args:
            limit: Maximum number of records to return
            offset: Number of records to skip
            download_type: Filter by download type ('track', 'album', 'playlist')
            status: Filter by status ('completed', 'failed', 'skipped', 'in_progress')
            
        Returns:
            List of download history records
        """
        try:
            query = "SELECT * FROM download_history"
            params = []
            conditions = []
            
            if download_type:
                conditions.append("download_type = ?")
                params.append(download_type)
            
            if status:
                conditions.append("status = ?")
                params.append(status)
            
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            
            query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            with self._get_connection() as conn:
                cursor = conn.execute(query, params)
                rows = cursor.fetchall()
                
                # Convert to list of dicts
                result = []
                for row in rows:
                    record = dict(row)
                    # Parse JSON fields
                    for field in ['artists', 'external_ids', 'metadata', 'release_date', 
                                'genres', 'images', 'owner']:
                        if record.get(field):
                            try:
                                record[field] = json.loads(record[field])
                            except (json.JSONDecodeError, TypeError):
                                pass
                    result.append(record)
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to retrieve download history: {e}")
            return []
    
    def get_children_history(self, children_table: str) -> List[Dict]:
        """
        Retrieve track history from a children table.
        
        Args:
            children_table: Name of the children table
            
        Returns:
            List of track records
        """
        try:
            # Ensure table exists before reading
            self._create_children_table(children_table)
            with self._get_connection() as conn:
                cursor = conn.execute(f"""
                    SELECT * FROM {children_table} 
                    ORDER BY track_number, position
                """)
                rows = cursor.fetchall()
                
                # Convert to list of dicts
                result = []
                for row in rows:
                    record = dict(row)
                    # Parse JSON fields
                    for field in ['artists', 'external_ids', 'genres', 'metadata']:
                        if record.get(field):
                            try:
                                record[field] = json.loads(record[field])
                            except (json.JSONDecodeError, TypeError):
                                pass
                    result.append(record)
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to retrieve children history from {children_table}: {e}")
            return []
    
    def get_download_stats(self) -> Dict:
        """Get download statistics."""
        try:
            with self._get_connection() as conn:
                # Total downloads by type
                cursor = conn.execute("""
                    SELECT download_type, status, COUNT(*) as count
                    FROM download_history
                    GROUP BY download_type, status
                """)
                type_stats = {}
                for row in cursor.fetchall():
                    download_type = row['download_type']
                    status = row['status']
                    count = row['count']
                    
                    if download_type not in type_stats:
                        type_stats[download_type] = {}
                    type_stats[download_type][status] = count
                
                # Total tracks downloaded (including from albums/playlists)
                cursor = conn.execute("""
                    SELECT SUM(
                        CASE 
                            WHEN download_type = 'track' AND status = 'completed' THEN 1
                            ELSE COALESCE(successful_tracks, 0)
                        END
                    ) as total_successful_tracks
                    FROM download_history
                """)
                total_tracks = cursor.fetchone()['total_successful_tracks'] or 0
                
                # Recent downloads (last 7 days)
                week_ago = time.time() - (7 * 24 * 60 * 60)
                cursor = conn.execute("""
                    SELECT COUNT(*) as count
                    FROM download_history
                    WHERE timestamp > ?
                """, (week_ago,))
                recent_downloads = cursor.fetchone()['count']
                
                return {
                    "by_type_and_status": type_stats,
                    "total_successful_tracks": total_tracks,
                    "recent_downloads_7d": recent_downloads
                }
                
        except Exception as e:
            logger.error(f"Failed to get download stats: {e}")
            return {}
    
    def search_history(self, query: str, limit: int = 50) -> List[Dict]:
        """
        Search download history by title or artist.
        
        Args:
            query: Search query for title or artist
            limit: Maximum number of results
            
        Returns:
            List of matching download records
        """
        try:
            search_pattern = f"%{query}%"
            
            with self._get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM download_history
                    WHERE title LIKE ? OR artists LIKE ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                """, (search_pattern, search_pattern, limit))
                
                rows = cursor.fetchall()
                
                # Convert to list of dicts
                result = []
                for row in rows:
                    record = dict(row)
                    # Parse JSON fields
                    for field in ['artists', 'external_ids', 'metadata', 'release_date', 
                                'genres', 'images', 'owner']:
                        if record.get(field):
                            try:
                                record[field] = json.loads(record[field])
                            except (json.JSONDecodeError, TypeError):
                                pass
                    result.append(record)
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to search download history: {e}")
            return []
    
    def get_download_by_task_id(self, task_id: str) -> Optional[Dict]:
        """
        Get download history entry by task ID.
        
        Args:
            task_id: Celery task ID
            
        Returns:
            Download record or None if not found
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.execute("""
                    SELECT * FROM download_history
                    WHERE task_id = ?
                    LIMIT 1
                """, (task_id,))
                
                row = cursor.fetchone()
                if not row:
                    return None
                
                record = dict(row)
                # Parse JSON fields
                for field in ['artists', 'external_ids', 'metadata', 'release_date', 
                            'genres', 'images', 'owner']:
                    if record.get(field):
                        try:
                            record[field] = json.loads(record[field])
                        except (json.JSONDecodeError, TypeError):
                            pass
                
                return record
                
        except Exception as e:
            logger.error(f"Failed to get download by task ID {task_id}: {e}")
            return None
    
    def get_recent_downloads(self, limit: int = 20) -> List[Dict]:
        """Get most recent downloads."""
        return self.get_download_history(limit=limit, offset=0)
    
    def get_failed_downloads(self, limit: int = 50) -> List[Dict]:
        """Get failed downloads."""
        return self.get_download_history(limit=limit, status="failed")
    
    def clear_old_history(self, days_old: int = 30) -> int:
        """
        Clear download history older than specified days.
        
        Args:
            days_old: Number of days old to keep (default 30)
            
        Returns:
            Number of records deleted
        """
        try:
            cutoff_time = time.time() - (days_old * 24 * 60 * 60)
            
            with self._get_connection() as conn:
                # Get list of children tables to delete
                cursor = conn.execute("""
                    SELECT children_table FROM download_history
                    WHERE timestamp < ? AND children_table IS NOT NULL
                """, (cutoff_time,))
                
                children_tables = [row['children_table'] for row in cursor.fetchall()]
                
                # Delete main history records
                cursor = conn.execute("""
                    DELETE FROM download_history
                    WHERE timestamp < ?
                """, (cutoff_time,))
                
                deleted_count = cursor.rowcount
                
                # Drop children tables
                for table_name in children_tables:
                    try:
                        conn.execute(f"DROP TABLE IF EXISTS {table_name}")
                    except Exception as e:
                        logger.warning(f"Failed to drop children table {table_name}: {e}")
                
                logger.info(f"Cleared {deleted_count} old history records and {len(children_tables)} children tables")
                return deleted_count
                
        except Exception as e:
            logger.error(f"Failed to clear old history: {e}")
            return 0


# Global history manager instance
history_manager = HistoryManager() 