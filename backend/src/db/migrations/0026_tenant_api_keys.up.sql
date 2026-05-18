-- 0026_tenant_api_keys.up.sql - tenant-wide AI/captcha key storage for web mode.

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  scope                    TEXT NOT NULL PRIMARY KEY DEFAULT 'tenant'
                             CHECK(scope = 'tenant'),
  anthropic_cipher         TEXT,
  anthropic_iv             TEXT,
  anthropic_tag            TEXT,
  openai_cipher            TEXT,
  openai_iv                TEXT,
  openai_tag               TEXT,
  google_cipher            TEXT,
  google_iv                TEXT,
  google_tag               TEXT,
  openrouter_cipher        TEXT,
  openrouter_iv            TEXT,
  openrouter_tag           TEXT,
  twocaptcha_cipher        TEXT,
  twocaptcha_iv            TEXT,
  twocaptcha_tag           TEXT,
  capsolver_cipher         TEXT,
  capsolver_iv             TEXT,
  capsolver_tag            TEXT,
  captcha_provider         TEXT NOT NULL DEFAULT '2captcha'
                             CHECK(captcha_provider IN ('2captcha','capsolver')),
  captcha_mode             TEXT NOT NULL DEFAULT 'sequential'
                             CHECK(captcha_mode IN ('sequential','race')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by               TEXT
);

INSERT OR IGNORE INTO tenant_api_keys (scope) VALUES ('tenant');
