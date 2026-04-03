# Rolling Deploy Scripts

Scripts in this directory perform service-by-service production deploys with health checks:

- `rolling-deploy.sh` (Linux/macOS)
- `rolling-deploy.ps1` (Windows PowerShell)

## Default behavior

- Uses `.env.production.compose`
- Uses `docker-compose.prod.yml`
- Deploy order: `backend` -> `frontend` -> `nginx`
- Waits for each service to become healthy before moving to the next

## Usage

### Linux/macOS

```bash
chmod +x ops/deploy/rolling-deploy.sh
./ops/deploy/rolling-deploy.sh
```

With HTTPS overlay:

```bash
COMPOSE_FILES=docker-compose.prod.yml,docker-compose.prod.tls.yml ./ops/deploy/rolling-deploy.sh
```

### PowerShell

```powershell
.\ops\deploy\rolling-deploy.ps1
```

With HTTPS overlay:

```powershell
.\ops\deploy\rolling-deploy.ps1 -ComposeFiles "docker-compose.prod.yml,docker-compose.prod.tls.yml"
```
