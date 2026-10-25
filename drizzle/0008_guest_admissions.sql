-- A successful guest-code check qualifies this email for account setup.
-- Email ownership still requires the emailed verification link. Codes are never stored.
CREATE TABLE IF NOT EXISTS hny_guest_admissions (
  email_hash TEXT PRIMARY KEY NOT NULL,
  approved_at TEXT NOT NULL
);
