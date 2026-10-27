import { z } from "zod";
import { defineTool } from "@/core/define-tool";
import { requireAuth } from "@/core/studio-context";
import { enqueueAmpTask } from "./amp-task-run";
import { TaskBoardItemSchema } from "./schema";

export const TASK_BOARD_PLAN_APPROVE = defineTool({
  name: "TASK_BOARD_PLAN_APPROVE",
  description:
    "Approve the displayed Amp plan version and queue its implementation. Requires an explicit approval decision from the user.",
  annotations: {
    title: "Approve task plan",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.object({ id: z.string(), planRunId: z.string().min(1) }),
  outputSchema: z.object({ item: TaskBoardItemSchema }),
  handler: async ({ id, planRunId }, ctx) => {
    requireAuth(ctx);
    await ctx.access.check();
    const organizationId = ctx.organization?.id;
    if (!organizationId) throw new Error("Organization required");
    const item = await ctx.storage.taskBoard.getById(id, organizationId);
    if (!item) throw new Error("Task not found");
    await enqueueAmpTask(ctx, item, { userInitiated: true }, planRunId);
    return { item: (await ctx.storage.taskBoard.getById(id, organizationId))! };
  },
});
