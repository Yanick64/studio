import { ForbiddenError } from "../../core/access-control";
import { resolveCallerProjectScope } from "../../core/project-scope";
import type { StudioContext } from "../../core/studio-context";

export async function authorizeOrbitRouting(ctx: StudioContext): Promise<void> {
  // A mapping redirects organization-wide intake, beyond a single project.
  if (
    (await resolveCallerProjectScope(ctx)) !== null ||
    !(await ctx.boundAuth.hasPermission(
      { self: ["TASK_BOARD_ITEM_CREATE", "TASK_BOARD_ITEM_UPDATE"] },
      { organizationId: ctx.organization?.id, role: ctx.access.getRole() },
    ))
  ) {
    throw new ForbiddenError(
      "Ticket routing requires organization-wide project access and task create/update permissions",
    );
  }
}
