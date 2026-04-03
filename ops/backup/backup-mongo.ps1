param(
  [Parameter(Mandatory = $true)]
  [string]$MongoUri,

  [Parameter(Mandatory = $false)]
  [string]$OutputDirectory = ".\artifacts\mongo-backups"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command mongodump -ErrorAction SilentlyContinue)) {
  throw "mongodump not found. Install MongoDB Database Tools and ensure mongodump is in PATH."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$resolvedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null

$archivePath = Join-Path $resolvedOutputDirectory "gaumaya-backup-$timestamp.archive.gz"
$checksumPath = "$archivePath.sha256"

Write-Host "Creating backup archive: $archivePath"

& mongodump --uri="$MongoUri" --archive="$archivePath" --gzip

if ($LASTEXITCODE -ne 0) {
  throw "mongodump failed with exit code $LASTEXITCODE"
}

$hash = Get-FileHash -Algorithm SHA256 -Path $archivePath
"$($hash.Hash)  $(Split-Path -Leaf $archivePath)" | Set-Content -Path $checksumPath

Write-Host "Backup completed."
Write-Host "Archive : $archivePath"
Write-Host "SHA256  : $checksumPath"
