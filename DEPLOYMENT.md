# Deployment Checklist

## Gateway Server

Install Docker:

```bash
sudo apt update
sudo apt install docker.io docker-compose-plugin -y
sudo systemctl enable docker
sudo systemctl start docker
```

Copy this `sso-gateway-framework` directory to the gateway server.

## DNS

Point your real domain, or an `sslip.io` hostname, to the public IP of the gateway server.

## TLS

Place certificates here:

```text
sso-gateway-framework/certs/fullchain.pem
sso-gateway-framework/certs/privkey.pem
```

## Environment

Create `.env`:

```bash
cp .env.example .env
```

Update the secrets and domain values.

Important: update `keycloak/realm-platform.json` so the client secret and redirect URLs match your real domain and `.env` values.

## Start

```bash
docker compose up -d --build
docker compose ps
```

## Verify

```text
https://platform.com/health
https://platform.com/auth/
https://platform.com/admin/
https://platform.com/app/academy
```

This framework exposes HTTPS. By default it binds host port `443`. If public `443` is rerouted to local `7846`, set this in `.env`:

```text
HTTPS_HOST_PORT=7846
```

If using Let's Encrypt, use TLS-ALPN validation with `acme.sh`:

```bash
sudo /root/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 443
```

If public `443` is rerouted to local `7846`, use:

```bash
sudo /root/.acme.sh/acme.sh --issue -d your-domain.example --alpn --tlsport 7846
```

## App Server

Run the existing applications on `172.16.3.99` using the ports configured in the admin panel. Keep app databases untouched.

Default route examples:

```text
Incognitrix Academy -> 172.16.3.99:3000
Lab Info            -> 172.16.3.99:5000
Tom CTF             -> 172.16.3.99:8080
```

If your real app ports differ, update them in the admin panel instead of changing Nginx.
