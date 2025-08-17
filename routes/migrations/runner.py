import logging
import sqlite3
from pathlib import Path
from typing import Optional

from .v3_0_6 import MigrationV3_0_6
from .v3_1_0 import MigrationV3_1_0

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

# 3.1.2 expected schemas for Watch DBs (kept here to avoid importing modules with side-effects)
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

m306 = MigrationV3_0_6()
m310 = MigrationV3_1_0()


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
				col_type.replace("PRIMARY KEY", "").replace("AUTOINCREMENT", "").replace("NOT NULL", "").strip()
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
	_ensure_table_schema(conn, table_name, CHILDREN_EXPECTED_COLUMNS, "children history")


def _update_children_tables_for_history(conn: sqlite3.Connection) -> None:
	try:
		try:
			cur = conn.execute(
				"SELECT DISTINCT children_table FROM download_history WHERE children_table IS NOT NULL AND TRIM(children_table) != ''"
			)
			for row in cur.fetchall():
				table_name = row[0]
				if not table_name:
					continue
				_create_or_update_children_table(conn, table_name)
		except sqlite3.Error as e:
			logger.warning(f"Failed to scan referenced children tables from main history: {e}")

		try:
			cur = conn.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'album_%' OR name LIKE 'playlist_%') AND name != 'download_history'"
			)
			for row in cur.fetchall():
				table_name = row[0]
				_create_or_update_children_table(conn, table_name)
		except sqlite3.Error as e:
			logger.warning(f"Failed to scan legacy children tables in history DB: {e}")
		logger.info("Children history tables migration ensured")
	except Exception:
		logger.error("Failed migrating children history tables", exc_info=True)


def _ensure_creds_filesystem() -> None:
	try:
		BLOBS_DIR.mkdir(parents=True, exist_ok=True)
		if not SEARCH_JSON.exists():
			SEARCH_JSON.write_text('{ "client_id": "", "client_secret": "" }\n', encoding="utf-8")
			logger.info(f"Created default global Spotify creds file at {SEARCH_JSON}")
	except Exception:
		logger.error("Failed to ensure credentials filesystem (blobs/search.json)", exc_info=True)


def _apply_versioned_updates(conn: sqlite3.Connection, c_base, u_base, post_update=None) -> None:
	if not c_base(conn):
		u_base(conn)
	if post_update:
		post_update(conn)


# --- 3.1.2 upgrade helpers for Watch DBs ---

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
		_ensure_table_schema(conn, "watched_playlists", EXPECTED_WATCHED_PLAYLISTS_COLUMNS, "watched playlists")

		# Upgrade all dynamic playlist_ tables
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'playlist_%'")
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
			_ensure_table_schema(conn, table_name, EXPECTED_PLAYLIST_TRACKS_COLUMNS, f"playlist tracks ({table_name})")
		logger.info("Upgraded watch playlists DB to 3.1.2 schema")
	except Exception:
		logger.error("Failed to upgrade watch playlists DB to 3.1.2 schema", exc_info=True)


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
		_ensure_table_schema(conn, "watched_artists", EXPECTED_WATCHED_ARTISTS_COLUMNS, "watched artists")

		# Upgrade all dynamic artist_ tables
		cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'artist_%'")
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
			_ensure_table_schema(conn, table_name, EXPECTED_ARTIST_ALBUMS_COLUMNS, f"artist albums ({table_name})")
		logger.info("Upgraded watch artists DB to 3.1.2 schema")
	except Exception:
		logger.error("Failed to upgrade watch artists DB to 3.1.2 schema", exc_info=True)


def run_migrations_if_needed() -> None:
	try:
		# History DB
		h_conn = _safe_connect(HISTORY_DB)
		if h_conn:
			try:
				_apply_versioned_updates(
					h_conn,
					m306.check_history,
					m306.update_history,
					post_update=_update_children_tables_for_history,
				)
				h_conn.commit()
			finally:
				h_conn.close()

		# Watch playlists DB
		p_conn = _safe_connect(PLAYLISTS_DB)
		if p_conn:
			try:
				_apply_versioned_updates(
					p_conn,
					m306.check_watch_playlists,
					m306.update_watch_playlists,
				)
				_update_watch_playlists_db(p_conn)
				p_conn.commit()
			finally:
				p_conn.close()

		# Watch artists DB
		if ARTISTS_DB.exists():
			with _safe_connect(ARTISTS_DB) as conn:
				if conn:
					_apply_versioned_updates(
						conn, m306.check_watch_artists, m306.update_watch_artists
					)
					_apply_versioned_updates(
						conn, m310.check_watch_artists, m310.update_watch_artists
					)
					_update_watch_artists_db(conn)
					conn.commit()

		# Accounts DB
		c_conn = _safe_connect(ACCOUNTS_DB)
		if c_conn:
			try:
				_apply_versioned_updates(
					c_conn,
					m306.check_accounts,
					m306.update_accounts,
				)
				c_conn.commit()
			finally:
				c_conn.close()
		_ensure_creds_filesystem()

		logger.info("Database migrations check completed")
	except Exception:
		logger.error("Database migration failed", exc_info=True) 