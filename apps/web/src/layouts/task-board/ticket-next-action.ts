import {
  ampCustomerMessage,
  ampResolution,
} from "@decocms/shared/task-board-amp";
import type { TaskBoardItem } from "./config";

export function ticketNextAction(
  item: Pick<TaskBoardItem, "status" | "virtualMcpId" | "ampRun">,
) {
  const run = item.ampRun;
  if (item.status === "done" || item.status === "archived") return "none";
  if (run && !["completed", "failed"].includes(run.state)) return "wait";
  if (!item.virtualMcpId) return "route";
  if (item.status === "customer_approval") return "customerResponse";
  if (item.status === "ready_for_deployment") return "deploy";
  if (item.status === "post_deploy_validation") return "validate";
  if (run?.state === "failed") return "failed";
  if (item.status === "in_review") return "review";
  if (run?.phase === "planning" && run.plan && item.status === "todo")
    return "plan";
  if (item.status === "todo") return "preparePlan";
  if (item.status === "in_progress") return "outcome";
  if (run?.phase === "summary" && ampCustomerMessage(run.summary))
    return "customer";
  if (item.status === "qa") return "test";
  if (run?.phase === "summary") {
    switch (ampResolution(run.summary)) {
      case "research":
        return "research";
      case "clarify":
        return "clarify";
      case "configure":
        return "configure";
      case "plan":
        return "scopeCode";
      default:
        return "summary";
    }
  }
  return "research";
}
