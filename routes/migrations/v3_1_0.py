import sqlite3
import logging

logger = logging.getLogger(__name__)


class MigrationV3_1_0:
    ARTIST_ALBUMS_EXPECTED_COLUMNS: dict[str, str] = {
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

    def _table_columns(self, conn: sqlite3.Connection, table: str) -> set[str]:
        try:
            cur = conn.execute(f"PRAGMA table_info({table})")
            return {row[1] for row in cur.fetchall()}
        except sqlite3.OperationalError:
            return set()

    def check_watch_artists(self, conn: sqlite3.Connection) -> bool:
        """Checks if the artist-specific tables have the new columns."""
        try:
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'artist_%' LIMIT 1"
            )
            first_artist_table = cur.fetchone()

            if not first_artist_table:
                return True  # No artist tables, so no migration needed

            table_name = first_artist_table[0]
            existing_columns = self._table_columns(conn, table_name)
            required_columns = self.ARTIST_ALBUMS_EXPECTED_COLUMNS.keys()

            return set(required_columns).issubset(existing_columns)
        except Exception as e:
            logger.error(f"Error checking artist watch DB schema: {e}")
            return False

    def update_watch_artists(self, conn: sqlite3.Connection) -> None:
        """Updates all artist-specific tables with new columns."""
        try:
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'artist_%'"
            )
            artist_tables = cur.fetchall()

            for row in artist_tables:
                table_name = row[0]
                existing_columns = self._table_columns(conn, table_name)

                for col_name, col_type in self.ARTIST_ALBUMS_EXPECTED_COLUMNS.items():
                    if col_name in existing_columns:
                        continue

                    try:
                        # Remove constraints for ADD COLUMN
                        col_type_for_add = (
                            col_type.replace("PRIMARY KEY", "")
                            .replace("AUTOINCREMENT", "")
                            .replace("NOT NULL", "")
                            .strip()
                        )
                        conn.execute(
                            f'ALTER TABLE "{table_name}" ADD COLUMN {col_name} {col_type_for_add}'
                        )
                        logger.info(
                            f"Added column '{col_name}' to table '{table_name}' in artists.db."
                        )
                    except sqlite3.OperationalError as e:
                        logger.warning(
                            f"Could not add column '{col_name}' to table '{table_name}': {e}"
                        )
        except Exception as e:
            logger.error(f"Failed to update artist watch DB: {e}", exc_info=True)
