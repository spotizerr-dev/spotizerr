#!/bin/bash
set -e

# Set umask if UMASK variable is provided
if [ -n "${UMASK}" ]; then
    umask "${UMASK}"
fi

# Function to start the application
start_application() {
    # Start Flask app in the background
    echo "Starting Flask application..."
    python app.py &

    # Wait a moment for Flask to initialize
    sleep 2

    # Start Celery worker
    echo "Starting Celery worker..."
    celery -A routes.utils.celery_tasks.celery_app worker --loglevel=info --concurrency=${MAX_CONCURRENT_DL:-3} -Q downloads &

    # Keep the script running
    wait
}

# Check if custom command was provided
if [ $# -gt 0 ]; then
    # Custom command provided, use it instead of default app startup
    RUN_COMMAND="$@"
else
    # No custom command, use our default application startup
    RUN_COMMAND="start_application"
fi

# Check if both PUID and PGID are not set
if [ -z "${PUID}" ] && [ -z "${PGID}" ]; then
    # Run as root directly
    if [ $# -gt 0 ]; then
        exec "$@"
    else
        start_application
    fi
else
    # Verify both PUID and PGID are set
    if [ -z "${PUID}" ] || [ -z "${PGID}" ]; then
        echo "ERROR: Must supply both PUID and PGID or neither"
        exit 1
    fi

    # Check for root user request
    if [ "${PUID}" -eq 0 ] && [ "${PGID}" -eq 0 ]; then
        if [ $# -gt 0 ]; then
            exec "$@"
        else
            start_application
        fi
    else
        # Check if the group with the specified GID already exists
        if getent group "${PGID}" >/dev/null; then
            # If the group exists, use its name instead of creating a new one
            GROUP_NAME=$(getent group "${PGID}" | cut -d: -f1)
        else
            # If the group doesn't exist, create it
            GROUP_NAME="appgroup"
            groupadd -g "${PGID}" "${GROUP_NAME}"
        fi

        # Check if the user with the specified UID already exists
        if getent passwd "${PUID}" >/dev/null; then
            # If the user exists, use its name instead of creating a new one
            USER_NAME=$(getent passwd "${PUID}" | cut -d: -f1)
        else
            # If the user doesn't exist, create it
            USER_NAME="appuser"
            useradd -u "${PUID}" -g "${GROUP_NAME}" -d /app "${USER_NAME}"
        fi

        # Ensure proper permissions
        chown -R "${USER_NAME}:${GROUP_NAME}" /app || true

        # Run as specified user
        if [ $# -gt 0 ]; then
            exec gosu "${USER_NAME}" "$@"
        else
            exec gosu "${USER_NAME}" bash -c "$(declare -f start_application); start_application"
        fi
    fi
fi
