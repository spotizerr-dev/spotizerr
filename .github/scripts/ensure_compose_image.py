#!/usr/bin/env python3
import sys
import subprocess
from pathlib import Path
from typing import Tuple

try:
    import yaml
except Exception:
    sys.stderr.write("PyYAML is required to run this check.\n")
    sys.exit(2)

EXPECTED_IMAGE = "cooldockerizer93/spotizerr"


def load_compose(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_compose(path: Path, data) -> None:
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)


def ensure_image_unversioned(data) -> Tuple[bool, str, str]:
    """
    Returns (changed, old_image, new_image)
    """
    services = (data or {}).get("services", {})
    svc = services.get("spotizerr", {})
    image = svc.get("image")
    if image == EXPECTED_IMAGE:
        return False, image, image

    # Normalize to expected image if it has a tag/digest or is different
    svc["image"] = EXPECTED_IMAGE
    services["spotizerr"] = svc
    data["services"] = services
    return True, image, EXPECTED_IMAGE


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], check=False, text=True, capture_output=True)


def autocommit(file_path: str) -> None:
    # Configure git identity if missing
    git("config", "user.name").stdout
    if git("config", "user.name").stdout.strip() == "":
        git("config", "user.name", "github-actions[bot]")
    if git("config", "user.email").stdout.strip() == "":
        git("config", "user.email", "github-actions[bot]@users.noreply.github.com")
    # Stage and commit
    git("add", file_path)
    status = git("status", "--porcelain").stdout.strip()
    if status:
        msg = "chore: normalize docker-compose image to cooldockerizer93/spotizerr"
        commit_res = git("commit", "-m", msg)
        if commit_res.returncode != 0:
            sys.stderr.write(f"Git commit failed: {commit_res.stderr}\n")
            sys.exit(1)
        push_res = git("push")
        if push_res.returncode != 0:
            sys.stderr.write(f"Git push failed: {push_res.stderr}\n")
            sys.exit(1)
        print("Pushed normalization commit")
    else:
        print("No changes to commit")


def main(argv: list[str]) -> int:
    # Usage: ensure_compose_image.py [docker-compose.yaml] [--autocommit]
    compose_path = (
        Path(argv[1])
        if len(argv) > 1 and not argv[1].startswith("-")
        else Path("docker-compose.yaml")
    )
    do_autocommit = any(arg == "--autocommit" for arg in argv[1:])

    if not compose_path.exists():
        sys.stderr.write(f"File not found: {compose_path}\n")
        return 1

    try:
        data = load_compose(compose_path)
    except Exception as e:
        sys.stderr.write(f"Failed to parse YAML from {compose_path}: {e}\n")
        return 1

    changed, old_image, new_image = ensure_image_unversioned(data)

    if changed:
        save_compose(compose_path, data)
        sys.stderr.write(
            f"Normalized services.spotizerr.image from '{old_image}' to '{new_image}'\n"
        )
        # For pre-commit: exit non-zero to force user to re-stage
        if do_autocommit:
            autocommit(str(compose_path))
            return 0
        return 1

    print(f"OK: docker-compose image is '{EXPECTED_IMAGE}'")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
