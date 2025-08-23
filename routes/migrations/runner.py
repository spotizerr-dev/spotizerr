import logging
import sqlite3
from pathlib import Path
from typing import Optional

from .v3_2_0 import MigrationV3_2_0
from .v3_2_1 import log_noop_migration_detected

logger = logging.getLogger(__name__)

DATA_DIR = Path("./data")
HISTORY_DB = DATA_DIR / "history" / "download_history.db"
WATCH_DIR = DATA_DIR / "watch"
PLAYLISTS_DB = WATCH_DIR / "playlists.db"
ARTISTS_DB = WATCH_DIR / "artists.db"

# Credentials
CREDS_DIR = DATA_DIR / "creds"
ACCOUNTS_DB = CREDS_DIR / "accounts.db"
BLOBS_DIR = CREDS_DIR / "blobs"
SEARCH_JSON = CREDS_DIR / "search.json"

# Expected children table columns for history (album_/playlist_)
CHILDREN_EXPECTED_COLUMNS: dict[str, str] = {
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

# 3.2.0 expected schemas for Watch DBs (kept here to avoid importing modules with side-effects)
EXPECTED_WATCHED_PLAYLISTS_COLUMNS: dict[str, str] = {
    "spotify_id": "TEXT PRIMARY KEY",
    "name": "TEXT",
    "owner_id": "TEXT",
    "owner_name": "TEXT",
    "total_tracks": "INTEGER",
    "link": "TEXT",
    "snapshot_id": "TEXT",
    "last_checked": "INTEGER",
    "added_at": "INTEGER",
    "is_active": "INTEGER DEFAULT 1",
}

EXPECTED_PLAYLIST_TRACKS_COLUMNS: dict[str, str] = {
    "spotify_track_id": "TEXT PRIMARY KEY",
    "title": "TEXT",
    "artist_names": "TEXT",
    "album_name": "TEXT",
    "album_artist_names": "TEXT",
    "track_number": "INTEGER",
    "album_spotify_id": "TEXT",
    "duration_ms": "INTEGER",
    "added_at_playlist": "TEXT",
    "added_to_db": "INTEGER",
    "is_present_in_spotify": "INTEGER DEFAULT 1",
    "last_seen_in_spotify": "INTEGER",
    "snapshot_id": "TEXT",
    "final_path": "TEXT",
}

EXPECTED_WATCHED_ARTISTS_COLUMNS: dict[str, str] = {
    "spotify_id": "TEXT PRIMARY KEY",
    "name": "TEXT",
    "link": "TEXT",
    "total_albums_on_spotify": "INTEGER",
    "last_checked": "INTEGER",
    "added_at": "INTEGER",
    "is_active": "INTEGER DEFAULT 1",
    "genres": "TEXT",
    "popularity": "INTEGER",
    "image_url": "TEXT",
}

EXPECTED_ARTIST_ALBUMS_COLUMNS: dict[str, str] = {
    "album_spotify_id": "TEXT PRIMARY KEY",
    "artist_spotify_id": "TEXT",
    "name": "TEXT",
    "album_group": "TEXT",
    "album_type": "TEXT",
    "release_date": "TEXT",
    "release_date_precision": "TEXT",
    "total_tracks": "INTEGER",
    "link": "TEXT",
    "image_url": "TEXT",
    "added_to_db": "INTEGER",
    "last_seen_on_spotify": "INTEGER",
    "download_task_id": "TEXT",
    "download_status": "INTEGER DEFAULT 0",
    "is_fully_downloaded_managed_by_app": "INTEGER DEFAULT 0",
}

m320 = MigrationV3_2_0()


def _safe_connect(path: Path) -> Optional[sqlite3.Connection]:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        logger.error(f"Failed to open SQLite DB {path}: {e}")
        return None


def _ensure_table_schema(
    conn: sqlite3.Connection,
    table_name: str,
    expected_columns: dict[str, str],
    table_description: str,
) -> None:
    try:
        cur = conn.execute(f"PRAGMA table_info({table_name})")
        existing_info = cur.fetchall()
        existing_names = {row[1] for row in existing_info}
        for col_name, col_type in expected_columns.items():
            if col_name in existing_names:
                continue
            col_type_for_add = (
                col_type.replace("PRIMARY KEY", "")
                .replace("AUTOINCREMENT", "")
                .replace("NOT NULL", "")
                .strip()
            )
            try:
                conn.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type_for_add}"
                )
                logger.info(
                    f"Added missing column '{col_name} {col_type_for_add}' to {table_description} table '{table_name}'."
                )
            except sqlite3.OperationalError as e:
                logger.warning(
                    f"Could not add column '{col_name}' to {table_description} table '{table_name}': {e}"
                )
    except Exception as e:
        logger.error(
            f"Error ensuring schema for {table_description} table '{table_name}': {e}",
            exc_info=True,
        )


def _create_or_update_children_table(conn: sqlite3.Connection, table_name: str) -> None:
    conn.execute(
        f"""
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
	"""
    )
    _ensure_table_schema(
        conn, table_name, CHILDREN_EXPECTED_COLUMNS, "children history"
    )


# --- Helper to validate instance is at least 3.1.2 on history DB ---


def _history_children_tables(conn: sqlite3.Connection) -> list[str]:
    tables: set[str] = set()
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'album_%' OR name LIKE 'playlist_%') AND name != 'download_history'"
        )
        for row in cur.fetchall():
            if row and row[0]:
                tables.add(row[0])
    except sqlite3.Error as e:
        logger.warning(f"Failed to scan sqlite_master for children tables: {e}")

    try:
        cur = conn.execute(
            "SELECT DISTINCT children_table FROM download_history WHERE children_table IS NOT NULL AND TRIM(children_table) != ''"
        )
        for row in cur.fetchall():
            t = row[0]
            if t:
                tables.add(t)
    except sqlite3.Error as e:
        logger.warning(f"Failed to scan download_history for children tables: {e}")

    return sorted(tables)


def _is_history_at_least_3_2_0(conn: sqlite3.Connection) -> bool:
    required_cols = {"service", "quality_format", "quality_bitrate"}
    tables = _history_children_tables(conn)
    if not tables:
        # Nothing to migrate implies OK
        return True
    for t in tables:
        try:
            cur = conn.execute(f"PRAGMA table_info({t})")
            cols = {row[1] for row in cur.fetchall()}
            if not required_cols.issubset(cols):
                return False
        except sqlite3.OperationalError:
            return False
    return True


# --- 3.2.0 verification helpers for Watch DBs ---


def _update_watch_playlists_db(conn: sqlite3.Connection) -> None:
    try:
        # Ensure core watched_playlists table exists and has expected schema
        conn.execute(
            """
			CREATE TABLE IF NOT EXISTS watched_playlists (
				spotify_id TEXT PRIMARY KEY,
				name TEXT,
				owner_id TEXT,
				owner_name TEXT,
				total_tracks INTEGER,
				link TEXT,
				snapshot_id TEXT,
				last_checked INTEGER,
				added_at INTEGER,
				is_active INTEGER DEFAULT 1
			)
			"""
        )
        _ensure_table_schema(
            conn,
            "watched_playlists",
            EXPECTED_WATCHED_PLAYLISTS_COLUMNS,
            "watched playlists",
        )

        # Upgrade all dynamic playlist_ tables
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'playlist_%'"
        )
        for row in cur.fetchall():
            table_name = row[0]
            conn.execute(
                f"""
				CREATE TABLE IF NOT EXISTS {table_name} (
					spotify_track_id TEXT PRIMARY KEY,
					title TEXT,
					artist_names TEXT,
					album_name TEXT,
					album_artist_names TEXT,
					track_number INTEGER,
					album_spotify_id TEXT,
					duration_ms INTEGER,
					added_at_playlist TEXT,
					added_to_db INTEGER,
					is_present_in_spotify INTEGER DEFAULT 1,
					last_seen_in_spotify INTEGER,
					snapshot_id TEXT,
					final_path TEXT
				)
				"""
            )
            _ensure_table_schema(
                conn,
                table_name,
                EXPECTED_PLAYLIST_TRACKS_COLUMNS,
                f"playlist tracks ({table_name})",
            )
        logger.info("Upgraded watch playlists DB to 3.2.0 base schema")
    except Exception:
        logger.error(
            "Failed to upgrade watch playlists DB to 3.2.0 base schema", exc_info=True
        )


def _update_watch_artists_db(conn: sqlite3.Connection) -> None:
    try:
        # Ensure core watched_artists table exists and has expected schema
        conn.execute(
            """
			CREATE TABLE IF NOT EXISTS watched_artists (
				spotify_id TEXT PRIMARY KEY,
				name TEXT,
				link TEXT,
				total_albums_on_spotify INTEGER,
				last_checked INTEGER,
				added_at INTEGER,
				is_active INTEGER DEFAULT 1,
				genres TEXT,
				popularity INTEGER,
				image_url TEXT
			)
			"""
        )
        _ensure_table_schema(
            conn, "watched_artists", EXPECTED_WATCHED_ARTISTS_COLUMNS, "watched artists"
        )

        # Upgrade all dynamic artist_ tables
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'artist_%'"
        )
        for row in cur.fetchall():
            table_name = row[0]
            conn.execute(
                f"""
				CREATE TABLE IF NOT EXISTS {table_name} (
					album_spotify_id TEXT PRIMARY KEY,
					artist_spotify_id TEXT,
					name TEXT,
					album_group TEXT,
					album_type TEXT,
					release_date TEXT,
					release_date_precision TEXT,
					total_tracks INTEGER,
					link TEXT,
					image_url TEXT,
					added_to_db INTEGER,
					last_seen_on_spotify INTEGER,
					download_task_id TEXT,
					download_status INTEGER DEFAULT 0,
					is_fully_downloaded_managed_by_app INTEGER DEFAULT 0
				)
				"""
            )
            _ensure_table_schema(
                conn,
                table_name,
                EXPECTED_ARTIST_ALBUMS_COLUMNS,
                f"artist albums ({table_name})",
            )
        logger.info("Upgraded watch artists DB to 3.2.0 base schema")
    except Exception:
        logger.error(
            "Failed to upgrade watch artists DB to 3.2.0 base schema", exc_info=True
        )


def _ensure_creds_filesystem() -> None:
    try:
        BLOBS_DIR.mkdir(parents=True, exist_ok=True)
        if not SEARCH_JSON.exists():
            SEARCH_JSON.write_text(
                '{ "client_id": "", "client_secret": "" }\n', encoding="utf-8"
            )
            logger.info(f"Created default global Spotify creds file at {SEARCH_JSON}")
    except Exception:
        logger.error(
            "Failed to ensure credentials filesystem (blobs/search.json)", exc_info=True
        )


def run_migrations_if_needed():
    # Check if data directory exists
    if not DATA_DIR.exists():
        return

    try:
        # Require instance to be at least 3.2.0 on history DB; otherwise abort
        with _safe_connect(HISTORY_DB) as history_conn:
            if history_conn and not _is_history_at_least_3_2_0(history_conn):
                logger.error(
                    "Instance is not at schema version 3.2.0. Please upgrade to 3.2.0 before applying 3.2.2."
                )
                raise RuntimeError(
                    "Instance is not at schema version 3.2.0. Please upgrade to 3.2.0 before applying 3.2.2."
                )

        # Watch playlists DB
        with _safe_connect(PLAYLISTS_DB) as conn:
            if conn:
                _update_watch_playlists_db(conn)
                # Apply 3.2.0 additions (batch progress columns)
                if not m320.check_watch_playlists(conn):
                    m320.update_watch_playlists(conn)
                conn.commit()

        # Watch artists DB (if exists)
        if ARTISTS_DB.exists():
            with _safe_connect(ARTISTS_DB) as conn:
                if conn:
                    _update_watch_artists_db(conn)
                    if not m320.check_watch_artists(conn):
                        m320.update_watch_artists(conn)
                    conn.commit()

        # Accounts DB (no changes for this migration path)
        with _safe_connect(ACCOUNTS_DB) as conn:
            if conn:
                conn.commit()

    except Exception as e:
        logger.error("Error during migration: %s", e, exc_info=True)
        raise
    else:
        _ensure_creds_filesystem()
        log_noop_migration_detected()
        logger.info("Database migrations check completed (3.2.0 -> 3.2.2 path)")
