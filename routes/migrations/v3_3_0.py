import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


CONFIG_PATH = Path("./data/config/main.json")
REQUIRED_VERSION = "3.3.0"
TARGET_VERSION = "3.3.1"


def _load_config(config_path: Path) -> Optional[dict]:
    try:
        if not config_path.exists():
            logger.error(f"Configuration file not found at {config_path}")
            return None
        content = config_path.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception:
        logger.error("Failed to read configuration file for migration", exc_info=True)
        return None


def _save_config(config_path: Path, cfg: dict) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(cfg, indent=4) + "\n", encoding="utf-8")


class MigrationV3_3_0:
    """
    3.3.0 migration gate. This migration verifies the configuration indicates
    version 3.3.0, then bumps it to 3.3.1.

    If the `version` key is missing or not equal to 3.3.0, execution aborts and
    prompts the user to update their instance to 3.3.0.
    """

    @staticmethod
    def assert_config_version_is_3_3_0() -> None:
        cfg = _load_config(CONFIG_PATH)
        if not cfg or "version" not in cfg:
            raise RuntimeError(
                "Missing 'version' in data/config/main.json. Please update your configuration to 3.3.0."
            )
        version = str(cfg.get("version", "")).strip()
        # Case 1: exactly 3.3.0 -> bump to 3.3.1
        if version == REQUIRED_VERSION:
            cfg["version"] = TARGET_VERSION
            try:
                _save_config(CONFIG_PATH, cfg)
                logger.info(
                    f"Configuration version bumped from {REQUIRED_VERSION} to {TARGET_VERSION}."
                )
            except Exception:
                logger.error(
                    "Failed to bump configuration version to 3.3.1", exc_info=True
                )
                raise
            return
        # Case 2: already 3.3.1 -> OK
        if version == TARGET_VERSION:
            logger.info("Configuration version 3.3.1 detected. Proceeding.")
            return
        # Case 3: anything else -> abort and instruct to update to 3.3.0 first
        raise RuntimeError(
            f"Unsupported configuration version '{version}'. Please update to {REQUIRED_VERSION}."
        )
