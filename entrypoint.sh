#!/bin/bash
set -e

# Set umask if UMASK variable is provided
if [ -n "${UMASK}" ]; then
    umask "${UMASK}"
fi

# Check if Redis should be started locally
if [[ -z "${REDIS_URL}" || "${REDIS_URL}" == *"localhost"* || "${REDIS_URL}" == *"127.0.0.1"* ]]; then
    echo "Starting local Redis server..."
    redis-server --daemonize yes
    # Wait for Redis to be ready
    until redis-cli ping &>/dev/null; do
        echo "Waiting for Redis to start..."
        sleep 1
    done
    echo "Redis server is running."
    
    # If REDIS_URL is not set, set it to localhost
    if [ -z "${REDIS_URL}" ]; then
        export REDIS_URL="redis://localhost:6379/0"
        echo "Set REDIS_URL to ${REDIS_URL}"
    fi
    
    # If REDIS_BACKEND is not set, set it to the same as REDIS_URL
    if [ -z "${REDIS_BACKEND}" ]; then
        export REDIS_BACKEND="${REDIS_URL}"
        echo "Set REDIS_BACKEND to ${REDIS_BACKEND}"
    fi
else
    echo "Using external Redis server at ${REDIS_URL}"
fi

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