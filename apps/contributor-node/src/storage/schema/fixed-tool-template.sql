CREATE TABLE IF NOT EXISTS fixed_tool_template (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  digest TEXT NOT NULL,
  display_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  executable_digest TEXT NOT NULL,
  parameter_schema TEXT NOT NULL CHECK (json_valid(parameter_schema)),
  working_scope TEXT NOT NULL,
  env_allowlist TEXT NOT NULL CHECK (json_valid(env_allowlist)),
  network_policy TEXT NOT NULL CHECK (network_policy = 'disabled'),
  output_limit INTEGER NOT NULL CHECK (output_limit >= 1),
  side_effect_class TEXT NOT NULL,
  budget TEXT NOT NULL CHECK (json_valid(budget)),
  UNIQUE (node_id, version)
);
