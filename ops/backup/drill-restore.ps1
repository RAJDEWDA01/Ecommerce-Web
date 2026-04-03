param(
  [Parameter(Mandatory = $true)]
  [string]$MongoUri,

  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [Parameter(Mandatory = $false)]
  [string]$SourceDatabase = "",

  [Parameter(Mandatory = $false)]
  [string]$TargetDatabase = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command mongorestore -ErrorAction SilentlyContinue)) {
  throw "mongorestore not found. Install MongoDB Database Tools and ensure mongorestore is in PATH."
}

$resolvedArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)

if (-not (Test-Path -LiteralPath $resolvedArchivePath)) {
  throw "Archive file not found: $resolvedArchivePath"
}

if (-not $SourceDatabase) {
  $uriPath = ([uri]$MongoUri).AbsolutePath.Trim("/")

  if (-not $uriPath) {
    throw "Unable to infer source database from MongoUri. Pass -SourceDatabase explicitly."
  }

  $SourceDatabase = $uriPath.Split("?")[0]
}

if (-not $TargetDatabase) {
  $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $TargetDatabase = "${SourceDatabase}_restore_drill_$timestamp"
}

Write-Host "Running restore drill from '$SourceDatabase' to '$TargetDatabase'"

& mongorestore `
  "--uri=$MongoUri" `
  "--archive=$resolvedArchivePath" `
  "--gzip" `
  "--nsFrom=$SourceDatabase.*" `
  "--nsTo=$TargetDatabase.*" `
  "--drop"

if ($LASTEXITCODE -ne 0) {
  throw "Restore drill failed with exit code $LASTEXITCODE"
}

Write-Host "Restore drill completed successfully."
Write-Host "Target drill database: $TargetDatabase"
