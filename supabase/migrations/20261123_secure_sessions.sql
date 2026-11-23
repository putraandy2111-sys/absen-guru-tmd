ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS public.sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx
ON public.sessions(user_id);

CREATE INDEX IF NOT EXISTS sessions_revoked_at_idx
ON public.sessions(revoked_at);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
