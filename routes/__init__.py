import logging
import atexit

# Configure basic logging for the application if not already configured
# This is a good place for it if routes are a central part of your app structure.
logging.basicConfig(
    level=logging.INFO, format="%(message)s"
)

logger = logging.getLogger(__name__)

# Run DB migrations early so other modules see expected schemas
try:
    from routes.migrations import run_migrations_if_needed
    run_migrations_if_needed()
    logger.info("Database migrations executed (if needed).")
except Exception as e:
    logger.error(f"Database migration step failed: {e}", exc_info=True)

try:
    from routes.utils.watch.manager import start_watch_manager, stop_watch_manager

    # Start the playlist watch manager when the application/blueprint is initialized
    start_watch_manager()
    # Register the stop function to be called on application exit
    atexit.register(stop_watch_manager)
    logger.info("Playlist Watch Manager initialized and registered for shutdown.")
except ImportError as e:
    logger.error(
        f"Could not import or start Playlist Watch Manager: {e}. Playlist watching will be disabled."
    )
except Exception as e:
    logger.error(
        f"An unexpected error occurred during Playlist Watch Manager setup: {e}",
        exc_info=True,
    )
