param(
  [Parameter(Mandatory = $true)]
  [string]$MongoUri,

  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [switch]$Drop
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command mongorestore -ErrorAction SilentlyContinue)) {
  throw "mongorestore not found. Install MongoDB Database Tools and ensure mongorestore is in PATH."
}

$resolvedArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)

if (-not (Test-Path -LiteralPath $resolvedArchivePath)) {
  throw "Archive file not found: $resolvedArchivePath"
}

$restoreArgs = @(
  "--uri=$MongoUri",
  "--archive=$resolvedArchivePath",
  "--gzip"
)

if ($Drop.IsPresent) {
  $restoreArgs += "--drop"
}

Write-Host "Restoring archive: $resolvedArchivePath"

& mongorestore @restoreArgs

if ($LASTEXITCODE -ne 0) {
  throw "mongorestore failed with exit code $LASTEXITCODE"
}

Write-Host "Restore completed successfully."
