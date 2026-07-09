CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    internal_ip VARCHAR(50) NOT NULL,
    internal_port INTEGER NOT NULL,
    public_path VARCHAR(100) UNIQUE NOT NULL,
    allowed_role VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT applications_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,98}$'),
    CONSTRAINT applications_public_path_format CHECK (public_path ~ '^/app/[a-z0-9][a-z0-9-]{0,98}$'),
    CONSTRAINT applications_port_range CHECK (internal_port BETWEEN 3000 AND 9999)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    actor VARCHAR(150) NOT NULL DEFAULT 'system',
    action VARCHAR(100) NOT NULL,
    application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_applications_slug_enabled ON applications(slug, is_enabled);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

INSERT INTO applications (name, slug, description, internal_ip, internal_port, public_path, allowed_role, is_enabled)
VALUES
  ('Incognitrix Academy', 'academy', 'Main learning platform', '172.16.3.99', 3000, '/app/academy', 'student', true),
  ('Lab Info', 'lab-info', 'Lab information portal', '172.16.3.99', 5000, '/app/lab-info', 'student', true),
  ('Tom CTF', 'tom-ctf', 'CTFd challenge platform', '172.16.3.99', 8080, '/app/tom-ctf', 'ctf_user', true)
ON CONFLICT (slug) DO NOTHING;
