CREATE TABLE event_registrations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  idempotency_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, idempotency_hash)
);
--> statement-breakpoint
CREATE TABLE event_registration_limits (
  rate_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  PRIMARY KEY(rate_key, window_start)
);
--> statement-breakpoint
CREATE INDEX event_registration_limits_expiry ON event_registration_limits(window_start);
