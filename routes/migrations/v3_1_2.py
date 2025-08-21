import sqlite3
import logging


logger = logging.getLogger(__name__)


class MigrationV3_1_2:
    """
    Migration for version 3.1.2.
    Ensure history children tables (album_*/playlist_*) include service and quality columns.
    """

    CHILDREN_EXTRA_COLUMNS: dict[str, str] = {
        "service": "TEXT",
        "quality_format": "TEXT",
        "quality_bitrate": "TEXT",
    }

    def _table_columns(self, conn: sqlite3.Connection, table: str) -> set[str]:
        try:
            cur = conn.execute(f"PRAGMA table_info({table})")
            return {row[1] for row in cur.fetchall()}
        except sqlite3.OperationalError:
            return set()

    def _list_children_tables(self, conn: sqlite3.Connection) -> list[str]:
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

    def check_history(self, conn: sqlite3.Connection) -> bool:
        tables = self._list_children_tables(conn)
        if not tables:
            # Nothing to migrate
            return True
        # If any table is missing any of the extra columns, migration is needed
        for t in tables:
            cols = self._table_columns(conn, t)
            if not set(self.CHILDREN_EXTRA_COLUMNS.keys()).issubset(cols):
                return False
        return True

    def update_history(self, conn: sqlite3.Connection) -> None:
        tables = self._list_children_tables(conn)
        for t in tables:
            existing = self._table_columns(conn, t)
            for col_name, col_type in self.CHILDREN_EXTRA_COLUMNS.items():
                if col_name in existing:
                    continue
                try:
                    conn.execute(f"ALTER TABLE {t} ADD COLUMN {col_name} {col_type}")
                    logger.info(
                        f"Added column '{col_name} {col_type}' to history children table '{t}'."
                    )
                except sqlite3.OperationalError as e:
                    logger.warning(
                        f"Could not add column '{col_name}' to history children table '{t}': {e}"
                    )

    def check_watch_artists(self, conn: sqlite3.Connection) -> bool:
        # No changes for watch artists in 3.1.2
        return True

    def update_watch_artists(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass

    def check_watch_playlists(self, conn: sqlite3.Connection) -> bool:
        # No changes for watch playlists in 3.1.2
        return True

    def update_watch_playlists(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass

    def check_accounts(self, conn: sqlite3.Connection) -> bool:
        # No changes for accounts in 3.1.2
        return True

    def update_accounts(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass
