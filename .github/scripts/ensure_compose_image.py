#!/usr/bin/env python3
import sys
from pathlib import Path

try:
    import yaml
except Exception:
    sys.stderr.write("PyYAML is required to run this check.\n")
    sys.exit(2)

EXPECTED_IMAGE = "cooldockerizer93/spotizerr"


def validate_compose_image(path: Path) -> int:
    if not path.exists():
        sys.stderr.write(f"File not found: {path}\n")
        return 1

    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception as e:
        sys.stderr.write(f"Failed to parse YAML from {path}: {e}\n")
        return 1

    image = (data or {}).get("services", {}).get("spotizerr", {}).get("image")

    if image != EXPECTED_IMAGE:
        sys.stderr.write(
            f"services.spotizerr.image must be '{EXPECTED_IMAGE}' (found '{image}')\n"
        )
        return 1

    print(f"OK: docker-compose image is '{EXPECTED_IMAGE}'")
    return 0


def main(argv: list[str]) -> int:
    compose_path = Path(argv[1]) if len(argv) > 1 else Path("docker-compose.yaml")
    return validate_compose_image(compose_path)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
