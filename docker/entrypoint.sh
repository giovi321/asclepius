#!/usr/bin/env bash
# Asclepius container entrypoint.
#
# Goal: run the application as an unprivileged user (UID 1000 by default)
# while still being able to write to a bind-mounted ``/data`` directory
# whose ownership on the host is out of our control.
#
# Strategy:
#   1. Start as root.
#   2. Optionally rewrite the ``asclepius`` user's UID/GID to match the
#      host via ``PUID`` / ``PGID`` environment variables.
#   3. Chown the in-container ``/data`` tree so SQLite and the pipeline
#      can write. We only touch paths that are not already owned by the
#      target UID — the chown pass is idempotent and cheap even on large
#      vaults.
#   4. ``gosu`` down to the unprivileged user and exec the command.
#
# Skip the privileged prelude entirely if already running as non-root
# (e.g. when Kubernetes sets ``runAsUser`` in a SecurityContext).

set -euo pipefail

TARGET_USER="asclepius"
DEFAULT_UID=1000
DEFAULT_GID=1000

# Append bind address overrides to uvicorn's argv so the user can pick
# the interface and port via env without rewriting CMD. Only applied when
# the first positional arg is "uvicorn" and the caller hasn't already
# passed --host / --port (we won't clobber an explicit choice).
args=("$@")
if [ "${1:-}" = "uvicorn" ]; then
    has_host=0
    has_port=0
    for a in "$@"; do
        case "$a" in
            --host|--host=*) has_host=1 ;;
            --port|--port=*) has_port=1 ;;
        esac
    done
    if [ "$has_host" -eq 0 ]; then
        args+=("--host" "${ASCLEPIUS_BIND_HOST:-0.0.0.0}")
    fi
    if [ "$has_port" -eq 0 ]; then
        args+=("--port" "${ASCLEPIUS_BIND_PORT:-8000}")
    fi
fi

if [ "$(id -u)" -eq 0 ]; then
    PUID="${PUID:-$DEFAULT_UID}"
    PGID="${PGID:-$DEFAULT_GID}"

    # Align the in-container user with the host UID/GID so the bind-
    # mounted vault stays readable/writable on both sides.
    current_uid="$(id -u "$TARGET_USER")"
    current_gid="$(id -g "$TARGET_USER")"
    if [ "$current_gid" != "$PGID" ]; then
        groupmod -o -g "$PGID" "$TARGET_USER"
    fi
    if [ "$current_uid" != "$PUID" ]; then
        usermod  -o -u "$PUID" "$TARGET_USER"
    fi

    # Ensure the default subdirectories exist even when the host mounted
    # an empty folder, then hand ownership to the unprivileged user.
    mkdir -p /data/vault/inbox /data/vault/patients /data/vault/unclassified /data/config
    # Chown only if not already owned by the target — avoids an expensive
    # recursive operation on every container start once the vault is
    # populated.
    if [ "$(stat -c '%u' /data)" != "$PUID" ]; then
        chown "$PUID:$PGID" /data
    fi
    for sub in /data/config /data/vault /data/vault/inbox /data/vault/patients /data/vault/unclassified; do
        if [ -d "$sub" ] && [ "$(stat -c '%u' "$sub")" != "$PUID" ]; then
            chown -R "$PUID:$PGID" "$sub"
        fi
    done

    exec gosu "$TARGET_USER" "${args[@]}"
fi

# Already unprivileged — just run the command.
exec "${args[@]}"
