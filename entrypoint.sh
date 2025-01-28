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
        # Create group if it doesn't exist
        if ! getent group appgroup >/dev/null; then
            groupadd -g "${PGID}" appgroup
        fi

        # Create user if it doesn't exist
        if ! id appuser >/dev/null 2>&1; then
            useradd -u "${PUID}" -g appgroup -d /app appuser
        fi

        # Ensure proper permissions
        chown -R appuser:appgroup /app

        # Run as specified user
        exec gosu appuser "$@"
    fi
fi