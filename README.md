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

Only the gateway server should expose port `443` publicly in this setup. The application server ports should allow traffic only from the gateway server private IP.

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

This framework is configured for `443` only. Standard Certbot standalone HTTP validation uses port `80`, so use TLS-ALPN validation on port `443` instead:

```bash
sudo apt update
sudo apt install certbot -y
sudo certbot certonly --standalone --preferred-challenges tls-alpn-01 -d your-domain.example
```

After Certbot succeeds, copy the generated files into this framework:

```bash
sudo cp /etc/letsencrypt/live/your-domain.example/fullchain.pem ./certs/fullchain.pem
sudo cp /etc/letsencrypt/live/your-domain.example/privkey.pem ./certs/privkey.pem
sudo chown "$USER:$USER" ./certs/fullchain.pem ./certs/privkey.pem
```

If Nginx is already running on port `443`, stop it before using standalone TLS-ALPN mode:

```bash
docker compose stop nginx
sudo certbot certonly --standalone --preferred-challenges tls-alpn-01 -d your-domain.example
docker compose up -d nginx
```

If Certbot says port `443` is already in use, find the process:

```bash
sudo ss -ltnp | grep ':443'
```

Common fixes:

```bash
sudo systemctl stop nginx
sudo systemctl stop apache2
docker compose stop nginx
```

Then retry:

```bash
sudo certbot certonly --standalone --preferred-challenges tls-alpn-01 -d your-domain.example
```

If Certbot fails TLS-ALPN validation, check that your domain points to this gateway server and inbound `443` is open:

```bash
dig +short your-domain.example
curl -vkI https://your-domain.example/
```

The domain must point to the gateway server public IP, inbound port `443` must be allowed, and no Nginx/Apache/container should be serving HTTPS during the standalone challenge.

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
sudo certbot certonly --standalone --preferred-challenges tls-alpn-01 -d 199-46-34-76.sslip.io
sudo cp /etc/letsencrypt/live/199-46-34-76.sslip.io/fullchain.pem ./certs/fullchain.pem
sudo cp /etc/letsencrypt/live/199-46-34-76.sslip.io/privkey.pem ./certs/privkey.pem
sudo chown "$USER:$USER" ./certs/fullchain.pem ./certs/privkey.pem
```

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
