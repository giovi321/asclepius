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
