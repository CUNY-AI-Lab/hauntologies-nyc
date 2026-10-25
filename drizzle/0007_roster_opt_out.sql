-- Map accounts that asked to be left off the signed-in contributor roster.
CREATE TABLE contributor_roster_hidden (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES hny_auth_user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
