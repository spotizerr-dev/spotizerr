#!/bin/bash
set -e

# Check if both PUID and PGID are not set
if [ -z "${PUID}" ] && [ -z "${PGID}" ]; then
    # Run as root directly
    exec "$@"
else
    # Verify both PUID and PGID are set
    if [ -z "${PUID}" ] || [ -z "${PGID}" ]; then
        echo "ERROR: Must supply both PUID and PGID or neither"
        exit 1
    fi

    # Check for root user request
    if [ "${PUID}" -eq 0 ] && [ "${PGID}" -eq 0 ]; then
        exec "$@"
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
        chown -R "${USER_NAME}:${GROUP_NAME}" /app

        # Run as specified user
        exec gosu "${USER_NAME}" "$@"
    fi
fi