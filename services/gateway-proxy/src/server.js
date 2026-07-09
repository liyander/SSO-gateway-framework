import express from 'express';
import httpProxy from 'http-proxy';
import pg from 'pg';

const { Pool } = pg;

const app = express();
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  xfwd: true,
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 4000);
const allowedIps = new Set((process.env.ALLOWED_APP_IPS || '172.16.3.99').split(',').map((ip) => ip.trim()).filter(Boolean));
const minPort = Number(process.env.MIN_APP_PORT || 3000);
const maxPort = Number(process.env.MAX_APP_PORT || 9999);
const devTrustHeaders = process.env.DEV_TRUST_PROXY_HEADERS === 'true';

function parseRoles(req) {
  const groups = req.header('x-auth-request-groups') || '';
  const roleHeader = req.header('x-auth-request-role') || '';
  return new Set(
    [...groups.split(','), ...roleHeader.split(',')]
      .map((role) => role.trim().replace(/^\//, ''))
      .filter(Boolean),
  );
}

function canAccess(req, allowedRole) {
  if (devTrustHeaders && req.header('x-dev-admin') === 'true') return true;
  const roles = parseRoles(req);
  return roles.has('admin') || roles.has(allowedRole);
}

function validateTarget(row) {
  const portValue = Number(row.internal_port);
  return allowedIps.has(row.internal_ip) && Number.isInteger(portValue) && portValue >= minPort && portValue <= maxPort;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/app/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const { rows } = await pool.query(
      'SELECT * FROM applications WHERE slug = $1 AND is_enabled = true LIMIT 1',
      [slug],
    );
    const appConfig = rows[0];
    if (!appConfig) return res.status(404).send('Application not found');
    if (!validateTarget(appConfig)) return res.status(403).send('Application target is not allowed');
    if (!canAccess(req, appConfig.allowed_role)) return res.status(403).send('You do not have access to this application');

    const target = `http://${appConfig.internal_ip}:${appConfig.internal_port}`;
    const originalPrefix = `/app/${slug}`;
    req.url = req.originalUrl.startsWith(originalPrefix)
      ? req.originalUrl.slice(originalPrefix.length) || '/'
      : req.url;

    proxy.web(req, res, { target });
  } catch (error) {
    console.error('Gateway proxy error:', error);
    res.status(500).send('Gateway proxy error');
  }
});

proxy.on('proxyReq', (proxyReq, req) => {
  const user = req.header('x-auth-request-user') || '';
  const email = req.header('x-auth-request-email') || '';
  if (user) proxyReq.setHeader('X-Platform-User', user);
  if (email) proxyReq.setHeader('X-Platform-Email', email);
});

proxy.on('error', (error, _req, res) => {
  console.error('Upstream proxy error:', error.message);
  if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
  res.end('Upstream application is unavailable');
});

const server = app.listen(port, () => {
  console.log(`Platform gateway proxy listening on ${port}`);
});

server.on('upgrade', async (req, socket, head) => {
  const match = req.url.match(/^\/app\/([a-z0-9-]+)(\/.*)?$/);
  if (!match) return socket.destroy();
  const slug = match[1];
  const { rows } = await pool.query('SELECT * FROM applications WHERE slug = $1 AND is_enabled = true LIMIT 1', [slug]);
  const appConfig = rows[0];
  if (!appConfig || !validateTarget(appConfig)) return socket.destroy();
  req.url = match[2] || '/';
  proxy.ws(req, socket, head, { target: `http://${appConfig.internal_ip}:${appConfig.internal_port}` });
});
