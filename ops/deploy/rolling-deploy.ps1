param(
  [string]$EnvFile = ".env.production.compose",
  [string]$ComposeFiles = "docker-compose.prod.yml",
  [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "docker is not installed or not available in PATH."
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Missing env file: $EnvFile"
}

$composeArgs = @("compose", "--env-file", $EnvFile)
$composeFileList = $ComposeFiles.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
foreach ($composeFile in $composeFileList) {
  if (-not (Test-Path -LiteralPath $composeFile)) {
    throw "Missing compose file: $composeFile"
  }
  $composeArgs += @("-f", $composeFile)
}

function Invoke-Compose {
  param([string[]]$Args)
  & docker @composeArgs @Args
}

function Get-ServiceContainerId {
  param([string]$Service)
  $id = Invoke-Compose @("ps", "-q", $Service)
  return ($id | Out-String).Trim()
}

function Wait-ServiceHealthy {
  param(
    [string]$Service,
    [int]$TimeoutSeconds
  )

  $startedAt = Get-Date
  while ($true) {
    $containerId = Get-ServiceContainerId -Service $Service
    if ([string]::IsNullOrWhiteSpace($containerId)) {
      Write-Host "Service $Service has no running container yet, waiting..."
      Start-Sleep -Seconds 3
      continue
    }

    $status = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $containerId | Out-String).Trim()
    if ($status -eq "healthy" -or $status -eq "running") {
      Write-Host "Service $Service is $status."
      return
    }
    if ($status -eq "unhealthy" -or $status -eq "exited" -or $status -eq "dead") {
      throw "Service $Service became $status."
    }

    $elapsed = ((Get-Date) - $startedAt).TotalSeconds
    if ($elapsed -ge $TimeoutSeconds) {
      throw "Timed out waiting for $Service to become healthy (>$TimeoutSeconds s)."
    }
    Start-Sleep -Seconds 3
  }
}

Write-Host "Validating compose configuration..."
Invoke-Compose @("config") | Out-Null

Write-Host "Pulling latest base images where available..."
try {
  Invoke-Compose @("pull")
} catch {
  Write-Warning "docker compose pull failed, continuing with local cache."
}

Write-Host "Deploying backend..."
Invoke-Compose @("up", "-d", "--build", "--no-deps", "backend") | Out-Null
Wait-ServiceHealthy -Service "backend" -TimeoutSeconds $HealthTimeoutSeconds

Write-Host "Deploying frontend..."
Invoke-Compose @("up", "-d", "--build", "--no-deps", "frontend") | Out-Null
Wait-ServiceHealthy -Service "frontend" -TimeoutSeconds $HealthTimeoutSeconds

Write-Host "Reloading edge proxy..."
Invoke-Compose @("up", "-d", "--build", "--no-deps", "nginx") | Out-Null
Wait-ServiceHealthy -Service "nginx" -TimeoutSeconds $HealthTimeoutSeconds

Write-Host "Deployment complete. Current status:"
Invoke-Compose @("ps")
