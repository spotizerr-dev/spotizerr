#!/bin/bash
set -e

# Set umask if UMASK variable is provided
if [ -n "${UMASK}" ]; then
    umask "${UMASK}"
fi

# Redis is now in a separate container so we don't need to start it locally
echo "Using Redis at ${REDIS_URL}"

# Check if both PUID and PGID are not set
if [ -z "${PUID}" ] && [ -z "${PGID}" ]; then
    # Run as root directly
    echo "Running as root user (no PUID/PGID specified)"
    exec python app.py
else
    # Verify both PUID and PGID are set
    if [ -z "${PUID}" ] || [ -z "${PGID}" ]; then
        echo "ERROR: Must supply both PUID and PGID or neither"
        exit 1
    fi

    # Check for root user request
    if [ "${PUID}" -eq 0 ] && [ "${PGID}" -eq 0 ]; then
        echo "Running as root user (PUID/PGID=0)"
        exec python app.py
    else
        # Check if the group with the specified GID already exists
        if getent group "${PGID}" >/dev/null; then
            # If the group exists, use its name instead of creating a new one
            GROUP_NAME=$(getent group "${PGID}" | cut -d: -f1)
            echo "Using existing group: ${GROUP_NAME} (GID: ${PGID})"
        else
            # If the group doesn't exist, create it
            GROUP_NAME="appgroup"
            groupadd -g "${PGID}" "${GROUP_NAME}"
            echo "Created group: ${GROUP_NAME} (GID: ${PGID})"
        fi

        # Check if the user with the specified UID already exists
        if getent passwd "${PUID}" >/dev/null; then
            # If the user exists, use its name instead of creating a new one
            USER_NAME=$(getent passwd "${PUID}" | cut -d: -f1)
            echo "Using existing user: ${USER_NAME} (UID: ${PUID})"
        else
            # If the user doesn't exist, create it
            USER_NAME="appuser"
            useradd -u "${PUID}" -g "${GROUP_NAME}" -d /app "${USER_NAME}"
            echo "Created user: ${USER_NAME} (UID: ${PUID})"
        fi

        # Ensure proper permissions for all app directories
        echo "Setting permissions for /app directories..."
        chown -R "${USER_NAME}:${GROUP_NAME}" /app/downloads /app/config /app/creds /app/logs || true

        # Run as specified user
        echo "Starting application as ${USER_NAME}..."
        exec gosu "${USER_NAME}" python app.py
    fi
fi