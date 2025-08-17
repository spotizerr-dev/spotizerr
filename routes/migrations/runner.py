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


def _apply_versioned_updates(conn: sqlite3.Connection, c306, u306, c310, u310, post_update=None) -> None:
	if not c306(conn):
		u306(conn)
	if not c310(conn):
		u310(conn)
	if post_update:
		post_update(conn)


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
					m310.check_history,
					m310.update_history,
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
					m310.check_watch_playlists,
					m310.update_watch_playlists,
				)
				p_conn.commit()
			finally:
				p_conn.close()

		# Watch artists DB
		a_conn = _safe_connect(ARTISTS_DB)
		if a_conn:
			try:
				_apply_versioned_updates(
					a_conn,
					m306.check_watch_artists,
					m306.update_watch_artists,
					m310.check_watch_artists,
					m310.update_watch_artists,
				)
				a_conn.commit()
			finally:
				a_conn.close()

		# Accounts DB
		c_conn = _safe_connect(ACCOUNTS_DB)
		if c_conn:
			try:
				_apply_versioned_updates(
					c_conn,
					m306.check_accounts,
					m306.update_accounts,
					m310.check_accounts,
					m310.update_accounts,
				)
				c_conn.commit()
			finally:
				c_conn.close()
		_ensure_creds_filesystem()

		logger.info("Database migrations check completed")
	except Exception:
		logger.error("Database migration failed", exc_info=True) 