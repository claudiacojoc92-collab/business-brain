-- Founder authentication credentials
-- Separate from founders table for security separation
CREATE TABLE IF NOT EXISTS app.founder_auth (
  founder_id            TEXT        PRIMARY KEY
    REFERENCES founder.founders(id),
  password_hash         TEXT        NOT NULL,
  last_login_at         TIMESTAMPTZ,
  failed_attempts       INTEGER     NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
