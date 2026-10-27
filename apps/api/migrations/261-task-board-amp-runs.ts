import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE task_board_amp_runs (
      task_id text PRIMARY KEY REFERENCES task_board_items(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      run_id text NOT NULL UNIQUE,
      thread_id text,
      state text NOT NULL CHECK (state IN ('queued', 'starting', 'running', 'unknown', 'completed', 'failed')),
      prompt text NOT NULL,
      repositories jsonb NOT NULL,
      requested_by text NOT NULL,
      comment_id text REFERENCES task_board_comments(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(): Promise<void> {}
