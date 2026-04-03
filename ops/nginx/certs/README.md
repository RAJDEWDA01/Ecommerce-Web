# TLS Certificate Placement

For `docker-compose.prod.tls.yml`, place your cert files in this directory:

- `fullchain.pem`
- `privkey.pem`

Default container paths used by Nginx:

- `TLS_CERT_PATH=/etc/nginx/certs/fullchain.pem`
- `TLS_KEY_PATH=/etc/nginx/certs/privkey.pem`

If your filenames differ, override `TLS_CERT_PATH` and `TLS_KEY_PATH` in `.env.production.compose`.
