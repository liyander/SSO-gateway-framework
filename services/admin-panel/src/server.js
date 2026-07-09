import express from 'express';
import session from 'express-session';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
const allowedIps = new Set((process.env.ALLOWED_APP_IPS || '172.16.3.99').split(',').map((ip) => ip.trim()).filter(Boolean));
const minPort = Number(process.env.MIN_APP_PORT || 3000);
const maxPort = Number(process.env.MAX_APP_PORT || 9999);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    secret: process.env.ADMIN_SESSION_SECRET || 'change_me_admin_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }),
);

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 99);
}

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.redirect('/admin/login');
}

function parseRoles(req) {
  const groups = req.header('x-auth-request-groups') || '';
  const roles = req.header('x-auth-request-role') || '';
  const token = req.header('x-auth-request-access-token') || req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const tokenRoles = parseTokenRoles(token);
  return new Set(
    [...groups.split(','), ...roles.split(','), ...tokenRoles]
      .map((role) => role.trim().replace(/^\//, ''))
      .filter(Boolean),
  );
}

function parseTokenRoles(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return [];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    return [
      ...(decoded.groups || []),
      ...(decoded.realm_access?.roles || []),
      ...Object.values(decoded.resource_access || {}).flatMap((client) => client.roles || []),
    ];
  } catch {
    return [];
  }
}

function userCanSeeApp(req, appRow) {
  const roles = parseRoles(req);
  return roles.has('admin') || roles.has(appRow.allowed_role);
}

function validateApp(input) {
  const slug = slugify(input.slug || input.name);
  const portValue = Number(input.internal_port);
  const internalIp = String(input.internal_ip || '').trim();
  const errors = [];

  if (!input.name || input.name.trim().length < 2) errors.push('Application name is required.');
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(slug)) errors.push('Slug must contain lowercase letters, numbers, and hyphens.');
  if (!allowedIps.has(internalIp)) errors.push(`Internal IP must be one of: ${[...allowedIps].join(', ')}`);
  if (!Number.isInteger(portValue) || portValue < minPort || portValue > maxPort) errors.push(`Port must be between ${minPort} and ${maxPort}.`);
  if (!input.allowed_role || !/^[A-Za-z0-9_.:-]{2,100}$/.test(input.allowed_role)) errors.push('Allowed role is required.');

  return {
    errors,
    value: {
      name: input.name?.trim(),
      slug,
      description: input.description?.trim() || '',
      internal_ip: internalIp,
      internal_port: portValue,
      public_path: `/app/${slug}`,
      allowed_role: input.allowed_role?.trim(),
      is_enabled: input.is_enabled === 'on' || input.is_enabled === true || input.is_enabled === 'true',
    },
  };
}

async function logAudit(actor, action, applicationId, details = {}) {
  await pool.query(
    'INSERT INTO audit_logs (actor, action, application_id, details) VALUES ($1, $2, $3, $4)',
    [actor, action, applicationId || null, details],
  );
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Platform Admin</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, Segoe UI, Arial, sans-serif; background: #0b1020; color: #eef2ff; }
    body { margin: 0; background: #0b1020; }
    a { color: #8bd3ff; text-decoration: none; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 18px 28px; border-bottom: 1px solid #26314f; background: #11182b; }
    nav a { margin-right: 16px; color: #c7d2fe; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    h1 { font-size: 26px; margin: 0 0 18px; }
    h2 { font-size: 18px; margin-top: 28px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
    .card, table, form { background: #141d33; border: 1px solid #273455; border-radius: 8px; }
    .card { padding: 18px; }
    .metric { font-size: 30px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #273455; vertical-align: top; }
    th { color: #aab7d8; font-weight: 600; background: #18223b; }
    form { padding: 18px; display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: #c7d2fe; font-size: 14px; }
    input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid #33415f; background: #0c1324; color: #eef2ff; border-radius: 6px; padding: 10px 12px; }
    button { border: 0; border-radius: 6px; padding: 10px 14px; color: #07111f; background: #75e6a7; font-weight: 700; cursor: pointer; }
    .row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
    .danger { background: #ff8a8a; }
    .muted { color: #9aa7c7; }
    .error { padding: 12px; border: 1px solid #7f1d1d; color: #fecaca; background: #2b1118; border-radius: 8px; }
    .pill { display: inline-block; padding: 4px 8px; border-radius: 999px; background: #21304f; color: #dbeafe; }
  </style>
</head>
<body>
  <header>
    <strong>Platform Admin</strong>
    <nav>
      <a href="/admin/">Dashboard</a>
      <a href="/admin/apps">Applications</a>
      <a href="/admin/audit">Audit Logs</a>
      <a href="/auth/admin/master/console/" target="_blank">Keycloak</a>
      <a href="/admin/logout">Logout</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function portalLayout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Incognitrix</title>
  <link rel="stylesheet" href="/assets/portal.css">
</head>
<body class="portal-shell">
  <div class="scene" aria-hidden="true">
    <div class="sun"></div>
    <div class="branch branch-a"></div>
    <div class="branch branch-b"></div>
    <div class="gate"></div>
    <div class="street"></div>
  </div>
  <header class="portal-topbar">
    <a class="brand" href="/">
      <span class="brand-mark">I</span>
      <span>Incognitrix</span>
    </a>
    <nav>
      <a href="/">Apps</a>
      <a href="/oauth2/sign_out">Logout</a>
      <a href="/admin/">Admin</a>
    </nav>
  </header>
  <main class="portal-main">${body}</main>
</body>
</html>`;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/portal', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM applications WHERE is_enabled = true ORDER BY name');
  const visibleApps = rows.filter((row) => userCanSeeApp(req, row));
  const username = req.header('x-auth-request-user') || req.header('x-auth-request-email') || 'operator';
  const roleText = [...parseRoles(req)].join(', ') || 'authenticated';

  const appCards = visibleApps.map((row) => `
    <a class="app-card" href="${escapeHtml(row.public_path)}">
      <span class="app-kicker">${escapeHtml(row.allowed_role)}</span>
      <strong>${escapeHtml(row.name)}</strong>
      <span>${escapeHtml(row.description || 'Launch internal application')}</span>
      <em>${escapeHtml(row.internal_ip)}:${row.internal_port}</em>
    </a>
  `).join('');

  res.send(portalLayout('Applications', `
    <section class="hero-panel">
      <p class="eyebrow">Single sign-on gateway</p>
      <h1>Welcome, ${escapeHtml(username)}</h1>
      <p class="hero-copy">Your allowed labs and platforms are available below. The apps stay private on the internal server while this gateway handles access.</p>
      <div class="role-line">Active roles: ${escapeHtml(roleText)}</div>
    </section>
    <section class="apps-grid">
      ${appCards || '<div class="empty-state">No applications are assigned to your current role yet.</div>'}
    </section>
  `));
});

app.get('/login', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin/');
  res.send(layout('Login', `
    <h1>Admin Login</h1>
    <form method="post" action="/admin/login" style="max-width:420px">
      ${req.query.error ? '<div class="error">Invalid username or password.</div>' : ''}
      <label>Username <input name="username" autocomplete="username" required></label>
      <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
      <button type="submit">Sign in</button>
      <p class="muted">This is the temporary custom admin login. Keycloak SSO can replace it later.</p>
    </form>
  `));
});

app.post('/login', (req, res) => {
  if (req.body.username === adminUsername && req.body.password === adminPassword) {
    req.session.isAdmin = true;
    req.session.actor = req.body.username;
    return res.redirect('/admin/');
  }
  res.redirect('/admin/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/', requireAdmin, async (_req, res) => {
  const [{ rows: appRows }, { rows: auditRows }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_enabled)::int AS enabled FROM applications'),
    pool.query('SELECT COUNT(*)::int AS total FROM audit_logs'),
  ]);
  const stats = appRows[0];
  res.send(layout('Dashboard', `
    <h1>Dashboard</h1>
    <section class="grid">
      <div class="card"><div class="muted">Total Apps</div><div class="metric">${stats.total}</div></div>
      <div class="card"><div class="muted">Enabled Apps</div><div class="metric">${stats.enabled}</div></div>
      <div class="card"><div class="muted">Audit Events</div><div class="metric">${auditRows[0].total}</div></div>
      <div class="card"><div class="muted">Allowed IPs</div><div>${[...allowedIps].map(escapeHtml).join('<br>')}</div></div>
    </section>
    <h2>Access Pattern</h2>
    <div class="card"><code>https://platform.com/app/&lt;slug&gt;</code> routes internally to <code>172.16.3.99:&lt;port&gt;</code>.</div>
  `));
});

app.get('/apps', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM applications ORDER BY id');
  const tableRows = rows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.name)}</strong><br><span class="muted">${escapeHtml(row.description || '')}</span></td>
      <td><a href="${escapeHtml(row.public_path)}" target="_blank">${escapeHtml(row.public_path)}</a></td>
      <td><code>${escapeHtml(row.internal_ip)}:${row.internal_port}</code></td>
      <td><span class="pill">${escapeHtml(row.allowed_role)}</span></td>
      <td>${row.is_enabled ? 'Enabled' : 'Disabled'}</td>
      <td>
        <a href="/admin/apps/${row.id}/edit">Edit</a>
        <form method="post" action="/admin/apps/${row.id}/delete" style="display:inline; padding:0; border:0; background:transparent">
          <button class="danger" type="submit">Delete</button>
        </form>
      </td>
    </tr>
  `).join('');

  res.send(layout('Applications', `
    <h1>Applications</h1>
    <table>
      <thead><tr><th>Name</th><th>Public Path</th><th>Internal Target</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${tableRows || '<tr><td colspan="6">No applications configured.</td></tr>'}</tbody>
    </table>
    <h2>Add Application</h2>
    ${appForm()}
  `));
});

function appForm(appRow = {}) {
  return `
    <form method="post" action="${appRow.id ? `/admin/apps/${appRow.id}` : '/admin/apps'}">
      <div class="row">
        <label>Application Name <input name="name" value="${escapeHtml(appRow.name || '')}" required></label>
        <label>Slug <input name="slug" value="${escapeHtml(appRow.slug || '')}" placeholder="juice" required></label>
      </div>
      <label>Description <textarea name="description" rows="2">${escapeHtml(appRow.description || '')}</textarea></label>
      <div class="row">
        <label>Internal IP <input name="internal_ip" value="${escapeHtml(appRow.internal_ip || '172.16.3.99')}" required></label>
        <label>Internal Port <input type="number" name="internal_port" min="${minPort}" max="${maxPort}" value="${escapeHtml(appRow.internal_port || 3000)}" required></label>
        <label>Allowed Role <input name="allowed_role" value="${escapeHtml(appRow.allowed_role || 'student')}" required></label>
      </div>
      <label><span><input type="checkbox" name="is_enabled" ${appRow.is_enabled === false ? '' : 'checked'} style="width:auto"> Enabled</span></label>
      <button type="submit">${appRow.id ? 'Update Application' : 'Add Application'}</button>
    </form>`;
}

app.post('/apps', requireAdmin, async (req, res) => {
  const { errors, value } = validateApp(req.body);
  if (errors.length) return res.status(400).send(layout('Invalid Application', `<div class="error">${errors.map(escapeHtml).join('<br>')}</div><p><a href="/admin/apps">Back</a></p>`));
  const { rows } = await pool.query(
    `INSERT INTO applications (name, slug, description, internal_ip, internal_port, public_path, allowed_role, is_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [value.name, value.slug, value.description, value.internal_ip, value.internal_port, value.public_path, value.allowed_role, value.is_enabled],
  );
  await logAudit(req.session.actor, 'application.created', rows[0].id, value);
  res.redirect('/admin/apps');
});

app.get('/apps/:id/edit', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).send(layout('Not Found', '<h1>Application not found</h1>'));
  res.send(layout('Edit Application', `<h1>Edit Application</h1>${appForm(rows[0])}`));
});

app.post('/apps/:id', requireAdmin, async (req, res) => {
  const { errors, value } = validateApp(req.body);
  if (errors.length) return res.status(400).send(layout('Invalid Application', `<div class="error">${errors.map(escapeHtml).join('<br>')}</div><p><a href="/admin/apps">Back</a></p>`));
  await pool.query(
    `UPDATE applications
     SET name = $1, slug = $2, description = $3, internal_ip = $4, internal_port = $5,
         public_path = $6, allowed_role = $7, is_enabled = $8, updated_at = CURRENT_TIMESTAMP
     WHERE id = $9`,
    [value.name, value.slug, value.description, value.internal_ip, value.internal_port, value.public_path, value.allowed_role, value.is_enabled, req.params.id],
  );
  await logAudit(req.session.actor, 'application.updated', req.params.id, value);
  res.redirect('/admin/apps');
});

app.post('/apps/:id/delete', requireAdmin, async (req, res) => {
  await logAudit(req.session.actor, 'application.deleted', req.params.id, {});
  await pool.query('DELETE FROM applications WHERE id = $1', [req.params.id]);
  res.redirect('/admin/apps');
});

app.get('/audit', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.created_at.toISOString())}</td>
      <td>${escapeHtml(row.actor)}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(JSON.stringify(row.details))}</td>
    </tr>
  `).join('');
  res.send(layout('Audit Logs', `
    <h1>Audit Logs</h1>
    <table>
      <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${tableRows || '<tr><td colspan="4">No audit logs yet.</td></tr>'}</tbody>
    </table>
  `));
});

app.listen(port, () => {
  console.log(`Platform admin panel listening on ${port}`);
});
