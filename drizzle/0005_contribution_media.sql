-- Local additive migration. Images never enter public records or revision JSON.
CREATE TABLE contribution_media (
 id TEXT PRIMARY KEY NOT NULL,
 submission_id TEXT NOT NULL REFERENCES workflow_submissions(id),
 owner_id TEXT NOT NULL,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 1048576),
 media_type TEXT NOT NULL CHECK(media_type IN ('image/jpeg','image/png','image/webp')),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 8192),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 8192 AND width*height<=16777216),
 metadata_json TEXT NOT NULL,
 image_blob BLOB NOT NULL CHECK(typeof(image_blob)='blob' AND length(image_blob)=byte_length),
 created_at TEXT NOT NULL
);
CREATE INDEX contribution_media_submission ON contribution_media(submission_id);
CREATE TRIGGER contribution_media_immutable BEFORE UPDATE ON contribution_media
 BEGIN SELECT RAISE(ABORT,'immutable_attachment'); END;
