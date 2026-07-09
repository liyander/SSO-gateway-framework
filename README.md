# Incognitrix SSO Gateway Framework

This directory contains the separate gateway framework for the architecture in the request. It does not modify the existing application directories or their databases.

## Architecture

```text
Public User
  |
  v
https://platform.com
  |
  v
Gateway Server
  - Nginx
  - Keycloak
  - oauth2-proxy
  - Admin Panel
  - Gateway Proxy
  - PostgreSQL
  |
  v
Internal Application Server
172.16.3.99
  - /app/academy  -> 172.16.3.99:3000
  - /app/lab-info -> 172.16.3.99:5000
  - /app/tom-ctf  -> 172.16.3.99:8080
```

Only the gateway server should expose HTTPS publicly in this setup. By default the framework binds host port `443`, but you can set `HTTPS_HOST_PORT=7846` if public `443` is forwarded/rerouted to local port `7846`. The application server ports should allow traffic only from the gateway server private IP.

## Directory Layout

```text
sso-gateway-framework/
  docker-compose.yml
  .env.example
  nginx/default.conf
  postgres/init/
  keycloak/realm-platform.json
  services/admin-panel/
  services/gateway-proxy/
  certs/
```

## Services

- `postgres`: stores platform routing data and Keycloak data.
- `keycloak`: central user, role, and login provider.
- `oauth2-proxy`: protects `/app/*` routes with Keycloak login.
- `admin-panel`: custom temporary admin UI for managing application routes.
- `gateway-proxy`: dynamic Node.js reverse proxy that reads app targets from PostgreSQL.
- `nginx`: public entry point.

## First-Time Setup

1. Copy environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and replace all `change_this...` values.

3. Make the Keycloak client secret match:

```text
.env:
OAUTH2_PROXY_CLIENT_SECRET=your_secret

keycloak/realm-platform.json:
"secret": "your_secret"
```

4. Put TLS files in `certs/`:

```text
certs/fullchain.pem
certs/privkey.pem
```

For temporary self-signed certificates, set `OAUTH2_PROXY_SSL_INSECURE_SKIP_VERIFY=true` in `.env` while testing. Keep it `false` for production.

### Generate TLS Certificates

Production option with Let's Encrypt:

Important: replace `platform.com` with a real domain or subdomain that you own and whose DNS `A` record points to the gateway server public IP. Certbot will fail if you use the placeholder `platform.com` or any domain that does not point to your server.

This framework is configured for `443` only. Standard Certbot standalone HTTP validation uses port `80`.

Some Certbot builds do not support TLS-ALPN with the standalone plugin and will fail with:

```text
None of the preferred challenges are supported by the selected plugin
```

For a 443-only server, use `acme.sh` with TLS-ALPN instead:

```bash
sudo apt update
sudo apt install socat curl -y
sudo su -
curl https://get.acme.sh | sh -s email=you@example.com
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
~/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 443
exit
```

If public `443` is forwarded to local port `7846`, issue the certificate on local port `7846` instead:

```bash
~/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 7846
```

After issuance succeeds, install the generated certificate into this framework:

```bash
sudo /root/.acme.sh/acme.sh --install-cert -d your-domain.example \
  --fullchain-file "$(pwd)/certs/fullchain.pem" \
  --key-file "$(pwd)/certs/privkey.pem"
sudo chown "$USER:$USER" ./certs/fullchain.pem ./certs/privkey.pem
```

If Nginx is already running on port `443`, stop it before using standalone TLS-ALPN mode:

```bash
docker compose stop nginx
sudo /root/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 443
docker compose up -d nginx
```

If your gateway receives public `443` on local port `7846`, use:

```bash
docker compose stop nginx
sudo /root/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 7846
docker compose up -d nginx
```

If the ACME client says port `443` or `7846` is already in use, find the process:

```bash
sudo ss -ltnp | grep ':443'
sudo ss -ltnp | grep ':7846'
```

Common fixes:

```bash
sudo systemctl stop nginx
sudo systemctl stop apache2
docker compose stop nginx
```

Then retry:

```bash
sudo /root/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 443
```

Use `--tlsport 7846` instead when public `443` is rerouted to local `7846`.

If Certbot fails TLS-ALPN validation, check that your domain points to this gateway server and inbound `443` is open:

```bash
dig +short your-domain.example
curl -vkI https://your-domain.example/
```

The domain must point to the gateway server public IP, inbound port `443` must be allowed, and no Nginx/Apache/container should be serving HTTPS during the standalone challenge.

If public `443` is rerouted to local `7846`, also allow local inbound `7846` and make sure the forwarding rule is:

```text
public 443 -> gateway-server 7846
```

If `acme.sh` reports `Connection refused`, Let's Encrypt reached the IP address but nothing accepted the challenge on port `443`. Check these items:

```bash
dig +short your-domain.example
sudo ss -ltnp | grep ':443'
sudo ss -ltnp | grep ':7846'
sudo ufw status
```

Make sure:

- The hostname resolves to this server's public IP.
- The server firewall allows inbound TCP `443`.
- If rerouted, the server firewall allows inbound TCP `7846`.
- Any cloud/router firewall forwards inbound TCP `443` to this server.
- Nginx is stopped while `acme.sh --alpn --tlsport 443` runs.
- `acme.sh` is run with permission to bind the selected TLS port.

If `acme.sh` was installed under your normal user, run it with `sudo` and the explicit home path:

```bash
docker compose stop nginx
sudo ufw allow 443/tcp
sudo ufw allow 7846/tcp
sudo /home/user/.acme.sh/acme.sh --home /home/user/.acme.sh --issue -d your-domain.example --alpn --tlsport 443 --force --debug 2
```

For public `443` rerouted to local `7846`, use:

```bash
docker compose stop nginx
sudo ufw allow 7846/tcp
sudo /home/user/.acme.sh/acme.sh --home /home/user/.acme.sh --issue -d your-domain.example --alpn --tlsport 7846 --force --debug 2
```

No custom domain yet:

For private/local testing, use a self-signed certificate and access the server by IP. Browsers will show a warning because the certificate is not publicly trusted.

```bash
openssl req -x509 -nodes -newkey rsa:4096 -days 365 \
  -keyout ./certs/privkey.pem \
  -out ./certs/fullchain.pem \
  -subj "/CN=localhost"
```

Then set this in `.env`:

```text
PLATFORM_HOST=YOUR_SERVER_IP
OAUTH2_PROXY_COOKIE_DOMAIN=
OAUTH2_PROXY_SSL_INSECURE_SKIP_VERIFY=true
```

For a free temporary domain, use a dynamic DNS provider such as DuckDNS, or an IP-based wildcard DNS service such as `sslip.io`.

Example with `sslip.io`, if your gateway public IP is `199.46.34.76`:

```text
PLATFORM_HOST=199-46-34-76.sslip.io
OAUTH2_PROXY_COOKIE_DOMAIN=199-46-34-76.sslip.io
```

Then request a certificate with TLS-ALPN on port `443`:

```bash
sudo /root/.acme.sh/acme.sh --issue -d 199-46-34-76.sslip.io --alpn --tlsport 443
sudo /root/.acme.sh/acme.sh --install-cert -d 199-46-34-76.sslip.io \
  --fullchain-file "$(pwd)/certs/fullchain.pem" \
  --key-file "$(pwd)/certs/privkey.pem"
sudo chown "$USER:$USER" ./certs/fullchain.pem ./certs/privkey.pem
```

If public `443` is rerouted to local `7846`, replace `--tlsport 443` with `--tlsport 7846`.

If you later get a real domain but cannot stop anything on `443`, use DNS-01 validation instead. DNS-01 does not require opening port `80` or `443`, but it requires control of the domain DNS records.

Local testing option with a self-signed certificate:

```bash
openssl req -x509 -nodes -newkey rsa:4096 -days 365 \
  -keyout ./certs/privkey.pem \
  -out ./certs/fullchain.pem \
  -subj "/CN=platform.com"
```

For self-signed testing, also set this in `.env`:

```text
OAUTH2_PROXY_SSL_INSECURE_SKIP_VERIFY=true
```

For production, keep it disabled:

```text
OAUTH2_PROXY_SSL_INSECURE_SKIP_VERIFY=false
```

5. Start the framework:

```bash
docker compose up -d --build
```

## Admin Panel

Open:

```text
https://platform.com/admin/
```

The admin panel currently uses the temporary custom login from `.env`:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

It manages only the platform routing database. It does not modify existing app databases.

## Application Routing

Default seeded apps:

```text
https://platform.com/app/academy  -> http://172.16.3.99:3000
https://platform.com/app/lab-info -> http://172.16.3.99:5000
https://platform.com/app/tom-ctf  -> http://172.16.3.99:8080
```

Add or edit apps from the admin panel. Nginx does not need to be changed for every new app because `/app/*` is routed to `gateway-proxy`, and the proxy looks up the target from PostgreSQL.

## Firewall

Gateway server:

```bash
sudo ufw allow 22
sudo ufw allow 443
sudo ufw enable
```

If public `443` is rerouted to local `7846`, use:

```bash
sudo ufw allow 22
sudo ufw allow 7846/tcp
sudo ufw enable
```

Set this in `.env`:

```text
HTTPS_HOST_PORT=7846
```

Application server `172.16.3.99`:

```bash
sudo ufw allow from GATEWAY_PRIVATE_IP to any port 3000
sudo ufw allow from GATEWAY_PRIVATE_IP to any port 5000
sudo ufw allow from GATEWAY_PRIVATE_IP to any port 8080
sudo ufw allow from GATEWAY_PRIVATE_IP to any port 9000
```

Do not expose those app ports directly to the internet.

## Security Controls Included

- Admin panel validates app IPs against `ALLOWED_APP_IPS`.
- Admin panel and proxy validate app ports against `MIN_APP_PORT` and `MAX_APP_PORT`.
- Every application create/update/delete writes an audit log.
- `/app/*` is protected by Keycloak through oauth2-proxy.
- The gateway proxy checks the user role header from oauth2-proxy before forwarding.

## Notes

Many existing apps still have their own login page. That is expected for this first version. This framework acts as an outer SSO access gate. Later, each app can be modified to support Keycloak OIDC directly if you want one login inside the app too.
