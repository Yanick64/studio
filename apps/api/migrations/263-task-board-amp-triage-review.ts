import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE task_board_amp_runs
      DROP CONSTRAINT task_board_amp_runs_phase_check,
      ADD CONSTRAINT task_board_amp_runs_phase_check
        CHECK (phase IN ('legacy', 'summary', 'planning', 'implementation', 'review')),
      ADD COLUMN summary_text text,
      ADD COLUMN summary_context_hash text,
      ADD COLUMN review_text text,
      ADD COLUMN review_key text,
      ADD COLUMN review_targets jsonb NOT NULL DEFAULT '[]'
  `.execute(db);
}

export async function down(): Promise<void> {}
