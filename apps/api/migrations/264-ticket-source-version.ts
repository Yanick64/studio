import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_board_items ADD COLUMN webhook_source_version text`.execute(
    db,
  );
}

export async function down(): Promise<void> {}
