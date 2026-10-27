import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("task_board_items")
    .addColumn("webhook_context_revision", "text")
    .execute();
}

export async function down(): Promise<void> {}
