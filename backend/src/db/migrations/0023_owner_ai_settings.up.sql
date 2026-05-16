CREATE TABLE owner_ai_settings (
  owner_id          TEXT NOT NULL PRIMARY KEY,
  mode              TEXT NOT NULL DEFAULT 'native'
                      CHECK(mode IN ('native','openrouter')),
  openrouter_stack  TEXT NOT NULL DEFAULT 'western'
                      CHECK(openrouter_stack IN ('western','chinese')),
  updated_at        INTEGER NOT NULL
);
