import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE task_board_amp_runs
      ADD COLUMN phase text NOT NULL DEFAULT 'legacy'
        CHECK (phase IN ('legacy', 'planning', 'implementation')),
      ADD COLUMN context_hash text,
      ADD COLUMN plan_text text,
      ADD COLUMN plan_run_id text,
      ADD COLUMN approved_by text,
      ADD COLUMN approved_at timestamptz
  `.execute(db);
}

export async function down(): Promise<void> {}
