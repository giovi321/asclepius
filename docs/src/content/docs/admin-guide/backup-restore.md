---
title: "Backup and restore"
---

## What to back up

Two things make up the entire Asclepius state:

1. **`vault/` directory** — all documents, organized files, imaging studies, and the SQLite database
2. **`config/settings.yaml`** — your configuration file

Back up both regularly.

## Backup methods

### Web UI backup (database only)

Download a SQLite backup directly from the web UI:

1. Go to **Settings → Backup**
2. Click **Download Backup**
3. A timestamped `.sqlite` file is downloaded (e.g., `asclepius_backup_20250115_143022.sqlite`)

This uses SQLite's online backup API, which creates a consistent snapshot even while the application is running. The backup includes all structured data (documents, patients, lab results, etc.) but **not** the actual document files on disk.

### Scheduled backups (built-in)

Asclepius can run one configurable backup job on a schedule, write the file to a directory you choose, and prune old files automatically. No cron required.

Configure it under **Settings → Backup → Scheduled backups**:

| Setting | Values | Notes |
|---------|--------|-------|
| **Enabled** | on / off | Master switch |
| **Directory** | path | Defaults to `/vault/backups` (kept inside the volume so a host-level vault backup picks it up) |
| **Include database** | yes / no | Adds the SQLite snapshot to the run |
| **Include vault** | yes / no | Adds the document files; gzipped tarball |
| **Schedule** | hourly / daily / weekly | Runs once per interval since the last successful backup |
| **Retention** | keep last N / keep newer than N days | One policy at a time, applied after every successful run |

The scheduler picks the artifact format from your scope flags:

- **database only** → `asclepius_db_YYYYMMDD_HHMMSS.sqlite` (SQLite online backup; safe while the app runs)
- **vault only** → `asclepius_vault_YYYYMMDD_HHMMSS.tar.gz`
- **database + vault** → `asclepius_full_YYYYMMDD_HHMMSS.tar.gz` (a snapshot of the SQLite file is taken first, then added to the tarball alongside the vault tree)

The vault archive walks `vault/` and skips three things automatically: the backup directory itself (no recursion), the live `asclepius.sqlite` file, and the WAL/SHM/journal sidecars. Inside a `*_full_*` archive the consistent SQLite snapshot is written as `asclepius.sqlite` at the root, with the vault tree under `vault/`.

#### Run, list, download, delete

The same Settings page lets you:

- **Run now** — triggers the configured job immediately, no waiting for the next tick
- **List existing backups** — newest first, with size and timestamp
- **Download** any backup file
- **Delete** any backup file (admin only — emits a `backup.delete` audit-log entry)

You can also drive the same actions via the API:

```
POST   /api/settings/backup/run         # admin · runs the configured job
GET    /api/settings/backup/files       # list, newest first
GET    /api/settings/backup/files/{name} # download
DELETE /api/settings/backup/files/{name} # admin · delete one file
```

#### Retention

Retention runs after every successful backup. Two modes:

- **count** (default `7`) — keep the N most recent files across all kinds, delete the rest
- **days** (e.g. `30`) — keep everything newer than N days, delete the rest

Both modes operate across the whole backup directory, so mixing scopes (e.g. switching from `db` to `full`) still results in a clean directory. Pruning a file logs a single `Pruned backup ...` line.

:::caution[The schedule fires once per interval since the last backup]
"Daily" means *24 hours since the most recent file in the backup directory*, not "at midnight". If you enable a daily job for the first time, the next run happens immediately; subsequent runs space themselves out by 24 hours. Restarting the container does not reset the clock — the scheduler reads the most recent file's mtime on startup.
:::

#### Settings file equivalent

If you prefer editing `settings.yaml` directly:

```yaml
backup:
  directory: /vault/backups
  enabled: true
  include_database: true
  include_vault: true
  schedule: daily          # hourly | daily | weekly
  retention_mode: count    # count | days
  retention_value: 7
```

Settings are live — changes are written back to YAML and the in-memory scheduler is cancelled and restarted with the new config. No container restart needed.

### Full backup (recommended)

For a complete backup, copy the entire `vault/` directory and `config/settings.yaml`:

```bash
# Stop the container for a consistent backup
docker compose stop

# Copy the vault and config
cp -r vault/ /backup/asclepius/vault/
cp config/settings.yaml /backup/asclepius/settings.yaml

# Restart
docker compose up -d
```

### Live backup (no downtime)

SQLite with WAL mode supports live backups. You can copy the database while the application is running:

```bash
# Use sqlite3 backup command for a consistent copy
sqlite3 vault/asclepius.sqlite ".backup /backup/asclepius.sqlite"

# Copy document files (rsync for incremental)
rsync -av vault/patients/ /backup/patients/
rsync -av vault/unclassified/ /backup/unclassified/
```

:::caution[Do not simply copy the SQLite file]
Do not use `cp` to copy the SQLite database while the application is running. WAL mode uses additional files (`-wal` and `-shm`) that must be consistent. Use the `sqlite3 .backup` command or the web UI backup instead.

:::

## Restore

### From web UI backup

1. Stop the application: `docker compose stop`
2. Replace the database file: `cp backup.sqlite vault/asclepius.sqlite`
3. Start the application: `docker compose up -d`

:::note
A database-only restore will restore all metadata but the actual document files must be present in the `vault/` directory for file serving to work.

:::

### From full backup

1. Stop the application: `docker compose stop`
2. Restore the vault: `cp -r /backup/asclepius/vault/ vault/`
3. Restore the config: `cp /backup/asclepius/settings.yaml config/settings.yaml`
4. Start the application: `docker compose up -d`

## Automated backups

Set up a cron job for automated backups:

```bash
# Daily backup at 2 AM
0 2 * * * sqlite3 /path/to/vault/asclepius.sqlite ".backup /backup/asclepius_$(date +\%Y\%m\%d).sqlite" && rsync -av /path/to/vault/patients/ /backup/patients/
```

## Migration

To move Asclepius to a new server:

1. Create a full backup on the old server
2. Install Asclepius on the new server
3. Copy the `vault/` directory and `config/settings.yaml` to the new server
4. Start the application
