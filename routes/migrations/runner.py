import logging
import sqlite3
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path("./data")
HISTORY_DB = DATA_DIR / "history" / "download_history.db"
WATCH_DIR = DATA_DIR / "watch"
PLAYLISTS_DB = WATCH_DIR / "playlists.db"
ARTISTS_DB = WATCH_DIR / "artists.db"

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


def _safe_connect(path: Path) -> Optional[sqlite3.Connection]:
	try:
		path.parent.mkdir(parents=True, exist_ok=True)
		conn = sqlite3.connect(str(path))
		conn.row_factory = sqlite3.Row
		return conn
	except Exception as e:
		logger.error(f"Failed to open SQLite DB {path}: {e}")
		return None


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
	try:
		cur = conn.execute(f"PRAGMA table_info({table})")
		return {row[1] for row in cur.fetchall()}
	except Exception:
		return set()


def _ensure_table_schema(
	conn: sqlite3.Connection,
	table_name: str,
	expected_columns: dict[str, str],
	table_description: str,
) -> None:
	"""Ensure the given table has all expected columns, adding any missing columns safely."""
	try:
		cur = conn.execute(f"PRAGMA table_info({table_name})")
		existing_info = cur.fetchall()
		existing_names = {row[1] for row in existing_info}
		for col_name, col_type in expected_columns.items():
			if col_name in existing_names:
				continue
			# Strip PK/NOT NULL when altering existing table to avoid errors
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
	"""Create children table if missing and ensure it has all expected columns."""
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
	"""Ensure all existing children tables and referenced children tables conform to expected schema."""
	try:
		# Create or update any tables referenced by download_history.children_table
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

		# Find any legacy children tables by name pattern album_% or playlist_%
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


def _history_needs_306(conn: sqlite3.Connection) -> bool:
	"""Detect if history DB needs 3.0.6 schema (missing columns or tables)."""
	# If table missing entirely, we definitely need to create it
	cur = conn.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'"
	)
	row = cur.fetchone()
	if not row:
		return True
	cols = _table_columns(conn, "download_history")
	required = {
		"id",
		"download_type",
		"title",
		"artists",
		"timestamp",
		"status",
		"service",
		"quality_format",
		"quality_bitrate",
		"total_tracks",
		"successful_tracks",
		"failed_tracks",
		"skipped_tracks",
		"children_table",
		"task_id",
		"external_ids",
		"metadata",
		"release_date",
		"genres",
		"images",
		"owner",
		"album_type",
		"duration_total_ms",
		"explicit",
	}
	return not required.issubset(cols)


def _watch_playlists_needs_306(conn: sqlite3.Connection) -> bool:
	cur = conn.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='watched_playlists'"
	)
	row = cur.fetchone()
	if not row:
		return True
	cols = _table_columns(conn, "watched_playlists")
	required = {
		"spotify_id",
		"name",
		"owner_id",
		"owner_name",
		"total_tracks",
		"link",
		"snapshot_id",
		"last_checked",
		"added_at",
		"is_active",
	}
	return not required.issubset(cols)


def _watch_artists_needs_306(conn: sqlite3.Connection) -> bool:
	cur = conn.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='watched_artists'"
	)
	row = cur.fetchone()
	if not row:
		return True
	cols = _table_columns(conn, "watched_artists")
	required = {
		"spotify_id",
		"name",
		"link",
		"total_albums_on_spotify",
		"last_checked",
		"added_at",
		"is_active",
		"genres",
		"popularity",
		"image_url",
	}
	return not required.issubset(cols)


def _apply_history_306(conn: sqlite3.Connection) -> None:
	logger.info("Applying 3.0.6 migration for history DB")
	conn.executescript(
		"""
	CREATE TABLE IF NOT EXISTS download_history (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,
	  download_type TEXT NOT NULL,
	  title TEXT NOT NULL,
	  artists TEXT,
	  timestamp REAL NOT NULL,
	  status TEXT NOT NULL,
	  service TEXT,
	  quality_format TEXT,
	  quality_bitrate TEXT,
	  total_tracks INTEGER,
	  successful_tracks INTEGER,
	  failed_tracks INTEGER,
	  skipped_tracks INTEGER,
	  children_table TEXT,
	  task_id TEXT,
	  external_ids TEXT,
	  metadata TEXT,
	  release_date TEXT,
	  genres TEXT,
	  images TEXT,
	  owner TEXT,
	  album_type TEXT,
	  duration_total_ms INTEGER,
	  explicit BOOLEAN
	);
	CREATE INDEX IF NOT EXISTS idx_download_history_timestamp ON download_history(timestamp);
	CREATE INDEX IF NOT EXISTS idx_download_history_type_status ON download_history(download_type, status);
	CREATE INDEX IF NOT EXISTS idx_download_history_task_id ON download_history(task_id);
	CREATE UNIQUE INDEX IF NOT EXISTS uq_download_history_task_type_ids ON download_history(task_id, download_type, external_ids);
	"""
	)
	# After ensuring main table, also ensure children tables
	_update_children_tables_for_history(conn)


def _apply_watch_playlists_306(conn: sqlite3.Connection) -> None:
	logger.info("Applying 3.0.6 migration for watch playlists DB")
	conn.executescript(
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
	);
	"""
	)


def _apply_watch_artists_306(conn: sqlite3.Connection) -> None:
	logger.info("Applying 3.0.6 migration for watch artists DB")
	conn.executescript(
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
	);
	"""
	)


def run_migrations_if_needed() -> None:
	"""Detect and apply necessary migrations to align DB schema for v3.1.x.
	Currently implements 3.0.6 baseline creation for history and watch DBs.
	Idempotent by design.
	"""
	try:
		# History DB
		h_conn = _safe_connect(HISTORY_DB)
		if h_conn:
			try:
				if _history_needs_306(h_conn):
					_apply_history_306(h_conn)
				else:
					# Even if main table is OK, ensure children tables are up-to-date
					_update_children_tables_for_history(h_conn)
				h_conn.commit()
			finally:
				h_conn.close()

		# Watch DBs
		p_conn = _safe_connect(PLAYLISTS_DB)
		if p_conn:
			try:
				if _watch_playlists_needs_306(p_conn):
					_apply_watch_playlists_306(p_conn)
				p_conn.commit()
			finally:
				p_conn.close()

		a_conn = _safe_connect(ARTISTS_DB)
		if a_conn:
			try:
				if _watch_artists_needs_306(a_conn):
					_apply_watch_artists_306(a_conn)
				a_conn.commit()
			finally:
				a_conn.close()
		logger.info("Database migrations check completed")
	except Exception:
		logger.error("Database migration failed", exc_info=True) 