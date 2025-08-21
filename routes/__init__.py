import logging

# Configure basic logging for the application if not already configured
# This remains safe to execute on import
logging.basicConfig(level=logging.INFO, format="%(message)s")

logger = logging.getLogger(__name__)
