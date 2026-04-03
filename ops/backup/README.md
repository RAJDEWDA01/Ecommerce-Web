# Mongo Backup and Restore Runbook

## Prerequisites
- MongoDB Database Tools installed (`mongodump`, `mongorestore`)
- Access to production Mongo URI via secret manager

## Create Backup
### PowerShell
```powershell
./ops/backup/backup-mongo.ps1 -MongoUri "<mongo-uri>"
```

### Bash
```bash
./ops/backup/backup-mongo.sh "<mongo-uri>"
```

## Restore Backup
### PowerShell
```powershell
./ops/backup/restore-mongo.ps1 -MongoUri "<mongo-uri>" -ArchivePath ".\artifacts\mongo-backups\gaumaya-backup-YYYYMMDD-HHMMSS.archive.gz" -Drop
```

### Bash
```bash
./ops/backup/restore-mongo.sh "<mongo-uri>" "./artifacts/mongo-backups/gaumaya-backup-YYYYMMDD-HHMMSS.archive.gz" --drop
```

## Restore Drill (Non-Production Validation)
Use these commands to restore a backup into a drill database without overwriting the source database.

### PowerShell
```powershell
./ops/backup/drill-restore.ps1 -MongoUri "<mongo-uri>" -ArchivePath ".\artifacts\mongo-backups\gaumaya-backup-YYYYMMDD-HHMMSS.archive.gz"
```

### Bash
```bash
./ops/backup/drill-restore.sh "<mongo-uri>" "./artifacts/mongo-backups/gaumaya-backup-YYYYMMDD-HHMMSS.archive.gz"
```

## Recommended Schedule
- Backup frequency: every 6 hours (minimum daily)
- Restore drill frequency: monthly
- Retain daily backups for 30 days and weekly backups for 90 days
