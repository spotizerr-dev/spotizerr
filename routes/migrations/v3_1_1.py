import sqlite3


class MigrationV3_1_1:
    """
    Dummy migration for version 3.1.1 to 3.1.2.
    No database schema changes were made between these versions.
    This class serves as a placeholder to ensure the migration runner
    is aware of this version and can proceed without errors.
    """

    def check_history(self, conn: sqlite3.Connection) -> bool:
        # No changes, so migration is not needed.
        return True

    def update_history(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass

    def check_watch_artists(self, conn: sqlite3.Connection) -> bool:
        # No changes, so migration is not needed.
        return True

    def update_watch_artists(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass

    def check_watch_playlists(self, conn: sqlite3.Connection) -> bool:
        # No changes, so migration is not needed.
        return True

    def update_watch_playlists(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass

    def check_accounts(self, conn: sqlite3.Connection) -> bool:
        # No changes, so migration is not needed.
        return True

    def update_accounts(self, conn: sqlite3.Connection) -> None:
        # No-op
        pass
