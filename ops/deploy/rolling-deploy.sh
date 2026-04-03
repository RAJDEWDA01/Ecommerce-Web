#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production.compose}"
COMPOSE_FILES_CSV="${COMPOSE_FILES:-docker-compose.prod.yml}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not available in PATH." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

compose_args=(--env-file "$ENV_FILE")
IFS=',' read -r -a compose_files <<< "$COMPOSE_FILES_CSV"
for compose_file in "${compose_files[@]}"; do
  trimmed="$(echo "$compose_file" | xargs)"
  if [[ -z "$trimmed" ]]; then
    continue
  fi
  if [[ ! -f "$trimmed" ]]; then
    echo "Missing compose file: $trimmed" >&2
    exit 1
  fi
  compose_args+=(-f "$trimmed")
done

compose() {
  docker compose "${compose_args[@]}" "$@"
}

service_container_id() {
  compose ps -q "$1"
}

wait_healthy() {
  local service="$1"
  local timeout="$2"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local container_id
    container_id="$(service_container_id "$service")"
    if [[ -z "$container_id" ]]; then
      echo "Service $service has no running container yet, waiting..."
      sleep 3
      continue
    fi

    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy|running)
        echo "Service $service is $status."
        return 0
        ;;
      unhealthy|exited|dead)
        echo "Service $service became $status." >&2
        return 1
        ;;
    esac

    local now
    now="$(date +%s)"
    local elapsed=$((now - started_at))
    if (( elapsed >= timeout )); then
      echo "Timed out waiting for $service to become healthy (>${timeout}s)." >&2
      return 1
    fi
    sleep 3
  done
}

echo "Validating compose configuration..."
compose config >/dev/null

echo "Pulling latest base images where available..."
compose pull || true

echo "Deploying backend..."
compose up -d --build --no-deps backend
wait_healthy backend "$HEALTH_TIMEOUT_SECONDS"

echo "Deploying frontend..."
compose up -d --build --no-deps frontend
wait_healthy frontend "$HEALTH_TIMEOUT_SECONDS"

echo "Reloading edge proxy..."
compose up -d --build --no-deps nginx
wait_healthy nginx "$HEALTH_TIMEOUT_SECONDS"

echo "Deployment complete. Current status:"
compose ps
