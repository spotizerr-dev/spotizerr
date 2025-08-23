import sqlite3
import logging

logger = logging.getLogger(__name__)


class MigrationV3_2_0:
    """
    Migration for version 3.2.0 (upgrade path 3.2.0 -> 3.2.2).
    - Adds per-item batch progress columns to Watch DBs to support page-by-interval processing.
    - Enforces prerequisite: previous instance version must be 3.1.2 (validated by runner).
    """

    # New columns to add to watched tables
    PLAYLISTS_ADDED_COLUMNS: dict[str, str] = {
        "batch_next_offset": "INTEGER DEFAULT 0",
        "batch_processing_snapshot_id": "TEXT",
    }

    ARTISTS_ADDED_COLUMNS: dict[str, str] = {
        "batch_next_offset": "INTEGER DEFAULT 0",
    }

    # --- No-op for history/accounts in 3.2.2 ---

    def check_history(self, conn: sqlite3.Connection) -> bool:
        return True

    def update_history(self, conn: sqlite3.Connection) -> None:
        pass

    def check_accounts(self, conn: sqlite3.Connection) -> bool:
        return True

    def update_accounts(self, conn: sqlite3.Connection) -> None:
        pass

    # --- Watch: playlists ---

    def check_watch_playlists(self, conn: sqlite3.Connection) -> bool:
        try:
            cur = conn.execute("PRAGMA table_info(watched_playlists)")
            cols = {row[1] for row in cur.fetchall()}
            return set(self.PLAYLISTS_ADDED_COLUMNS.keys()).issubset(cols)
        except sqlite3.OperationalError:
            # Table missing means not ready
            return False

    def update_watch_playlists(self, conn: sqlite3.Connection) -> None:
        # Add new columns if missing
        try:
            cur = conn.execute("PRAGMA table_info(watched_playlists)")
            existing = {row[1] for row in cur.fetchall()}
            for col_name, col_type in self.PLAYLISTS_ADDED_COLUMNS.items():
                if col_name in existing:
                    continue
                try:
                    conn.execute(
                        f"ALTER TABLE watched_playlists ADD COLUMN {col_name} {col_type}"
                    )
                    logger.info(
                        f"Added column '{col_name} {col_type}' to watched_playlists for 3.2.2 batch progress."
                    )
                except sqlite3.OperationalError as e:
                    logger.warning(
                        f"Could not add column '{col_name}' to watched_playlists: {e}"
                    )
        except Exception:
            logger.error("Failed to update watched_playlists for 3.2.2", exc_info=True)

    # --- Watch: artists ---

    def check_watch_artists(self, conn: sqlite3.Connection) -> bool:
        try:
            cur = conn.execute("PRAGMA table_info(watched_artists)")
            cols = {row[1] for row in cur.fetchall()}
            return set(self.ARTISTS_ADDED_COLUMNS.keys()).issubset(cols)
        except sqlite3.OperationalError:
            return False

    def update_watch_artists(self, conn: sqlite3.Connection) -> None:
        try:
            cur = conn.execute("PRAGMA table_info(watched_artists)")
            existing = {row[1] for row in cur.fetchall()}
            for col_name, col_type in self.ARTISTS_ADDED_COLUMNS.items():
                if col_name in existing:
                    continue
                try:
                    conn.execute(
                        f"ALTER TABLE watched_artists ADD COLUMN {col_name} {col_type}"
                    )
                    logger.info(
                        f"Added column '{col_name} {col_type}' to watched_artists for 3.2.2 batch progress."
                    )
                except sqlite3.OperationalError as e:
                    logger.warning(
                        f"Could not add column '{col_name}' to watched_artists: {e}"
                    )
        except Exception:
            logger.error("Failed to update watched_artists for 3.2.2", exc_info=True)
