CREATE TABLE IF NOT EXISTS context_version (
  id TEXT PRIMARY KEY NOT NULL,
  context_item_id TEXT NOT NULL REFERENCES context_item (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_refs TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(source_refs)
    AND json_type(source_refs) = 'array'
  ),
  member_visibility TEXT NOT NULL CHECK (member_visibility IN ('members', 'private')),
  agent_exposure TEXT NOT NULL CHECK (
    agent_exposure IN ('not_provided', 'pending_operator', 'provide_next_run')
  ),
  attribution TEXT NOT NULL CHECK (
    json_valid(attribution)
    AND json_type(attribution) = 'object'
    AND json_type(attribution, '$.actorId') IS 'text'
    AND json_type(attribution, '$.displayNameAtTime') IS 'text'
    AND json_type(attribution, '$.rolesAtTime') IS 'array'
    AND json_type(attribution, '$.occurredAt') IS 'text'
  ),
  supersedes_id TEXT REFERENCES context_version (id),
  UNIQUE (context_item_id, version),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id)
) STRICT;

CREATE INDEX IF NOT EXISTS context_version_item_idx
  ON context_version (context_item_id, version);

CREATE TRIGGER IF NOT EXISTS context_version_no_update
BEFORE UPDATE ON context_version
BEGIN
  SELECT RAISE(ABORT, 'context_version is immutable');
END;

CREATE TRIGGER IF NOT EXISTS context_version_no_delete
BEFORE DELETE ON context_version
BEGIN
  SELECT RAISE(ABORT, 'context_version history cannot be deleted');
END;
