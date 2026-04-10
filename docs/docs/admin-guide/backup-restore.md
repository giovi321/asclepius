# Backup & Restore

## What to Back Up

Two things make up the entire Asclepius state:

1. **`vault/`** — all document files and the SQLite database
2. **`config/settings.yaml`** — your configuration

That's it. Back up these two and you can restore everything.

## Backup Strategy

### Simple: Copy the vault

```bash
# Stop the application (ensures clean SQLite state)
docker compose down

# Copy the vault
cp -r vault/ /backup/vault-$(date +%Y%m%d)/

# Restart
docker compose up -d
```

### SQLite-Safe: Use `.backup`

For a backup without stopping the server:

```bash
sqlite3 vault/asclepius.sqlite ".backup /backup/asclepius-$(date +%Y%m%d).sqlite"
```

This creates a consistent snapshot even while the server is running (SQLite WAL mode handles this safely).

### Automated

Set up a cron job or use your existing backup solution (rsync, Syncthing, Nextcloud, etc.) to sync the vault directory.

## Restore

```bash
docker compose down

# Replace vault with backup
rm -rf vault/
cp -r /backup/vault-20240315/ vault/

# Replace config
cp /backup/settings.yaml config/settings.yaml

docker compose up -d
```

## Migration

To move Asclepius to a new server:

1. Back up `vault/` and `config/settings.yaml`
2. Install Asclepius on the new server
3. Copy the vault and config to the new location
4. Update paths in `config/settings.yaml` if needed
5. Start with `docker compose up -d`
