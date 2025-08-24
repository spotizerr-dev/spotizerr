import logging
import sqlite3

logger = logging.getLogger(__name__)


class MigrationV3_2_1:
    """
    No-op migration for version 3.2.1 (upgrade path 3.2.1 -> 3.3.0).
    No database schema changes are required.
    """

    def check_history(self, conn: sqlite3.Connection) -> bool:
        return True

    def update_history(self, conn: sqlite3.Connection) -> None:
        pass

    def check_accounts(self, conn: sqlite3.Connection) -> bool:
        return True

    def update_accounts(self, conn: sqlite3.Connection) -> None:
        pass

    def check_watch_playlists(self, conn: sqlite3.Connection) -> bool:
        return True

    def update_watch_playlists(self, conn: sqlite3.Connection) -> None:
        pass

    def check_watch_artists(self, conn: sqlite3.Connection) -> bool:
        return True

    def update_watch_artists(self, conn: sqlite3.Connection) -> None:
        pass


def log_noop_migration_detected() -> None:
    logger.info(
        "No migration performed: detected schema for 3.2.1; no changes needed for 3.2.1 -> 3.3.0."
    )
