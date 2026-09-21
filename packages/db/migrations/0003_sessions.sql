-- Agent session persistence and checkpoint support for Astra V1

-- Extend agent_sessions with canonical session fields
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'CRASHED', 'CANCELLED'));
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS current_model_id text;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS active_task_id uuid REFERENCES agent_tasks(id);
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS structured_state jsonb;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_checkpoint_id uuid;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS total_credits_reserved numeric(20,7) NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS total_credits_settled numeric(20,7) NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Session checkpoints (immutable snapshots)
CREATE TABLE IF NOT EXISTS session_checkpoints (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES agent_sessions(id),
  task_id uuid REFERENCES agent_tasks(id),
  reason text NOT NULL,
  structured_state jsonb NOT NULL,
  git_head text,
  git_branch text,
  working_tree_hash text,
  model_id text,
  credits_used numeric(20,7) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_checkpoints_session_idx
  ON session_checkpoints(session_id, created_at DESC);

-- Self-reference for last_checkpoint_id (add after table is created)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_sessions_last_checkpoint_fk'
  ) THEN
    ALTER TABLE agent_sessions
      ADD CONSTRAINT agent_sessions_last_checkpoint_fk
      FOREIGN KEY (last_checkpoint_id) REFERENCES session_checkpoints(id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS agent_sessions_user_idx
  ON agent_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_sessions_workspace_idx
  ON agent_sessions(workspace_id);
