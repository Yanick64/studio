import { Button } from "@decocms/ui/components/button.tsx";
import { MemoizedMarkdown } from "@/components/chat/markdown";
import { useTaskBoardItemActions } from "@/hooks/use-task-board-items";
import { useT } from "@/i18n/use-t";
import { toast } from "sonner";
import type { TaskBoardItem } from "./config";

export function AmpPlan({
  item,
  disabled,
}: {
  item: TaskBoardItem;
  disabled: boolean;
}) {
  const t = useT();
  const { approvePlan, rerun } = useTaskBoardItemActions();
  const run = item.ampRun;
  if (
    !run ||
    (!run.plan &&
      (run.phase === "legacy" ||
        run.phase === "summary" ||
        run.phase === "review"))
  ) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {t("taskBoard.ampPlan.empty")}
      </p>
    );
  }
  const pending = approvePlan.isPending || rerun.isPending;
  const planPhase = run.phase === "planning" || run.phase === "implementation";
  const terminal = run.state === "completed" || run.state === "failed";
  const awaitingApproval =
    run.phase === "planning" && run.state === "completed" && !!run.plan;
  const reportError = (error: Error) => toast.error(error.message);
  return (
    <section
      className="my-6 space-y-4 rounded-lg border border-border p-4"
      aria-label={t("taskBoard.ampPlan.title")}
    >
      <h2 className="font-medium">{t("taskBoard.ampPlan.title")}</h2>
      {planPhase && (
        <p className="text-sm text-muted-foreground" role="status">
          {t(
            run.state === "failed"
              ? "taskBoard.ampPlan.failed"
              : run.state === "unknown"
                ? "taskBoard.ampPlan.reconnecting"
                : awaitingApproval
                  ? "taskBoard.ampPlan.awaitingApproval"
                  : run.phase === "planning"
                    ? "taskBoard.ampPlan.planning"
                    : run.state === "completed"
                      ? "taskBoard.ampPlan.completed"
                      : "taskBoard.ampPlan.implementing",
          )}
        </p>
      )}
      {run.plan && (
        <MemoizedMarkdown id={`amp-plan-${run.planRunId}`} text={run.plan} />
      )}
      <div className="flex flex-wrap gap-2">
        {awaitingApproval && run.planRunId && (
          <Button
            disabled={
              disabled ||
              pending ||
              item.status !== "todo" ||
              item.assigneeId !== "super-agent"
            }
            onClick={() =>
              approvePlan.mutate(
                { id: item.id, planRunId: run.planRunId! },
                { onError: reportError },
              )
            }
          >
            {t("taskBoard.ampPlan.approve")}
          </Button>
        )}
        {planPhase && terminal && item.assigneeId === "super-agent" && (
          <Button
            variant="outline"
            disabled={disabled || pending}
            onClick={() =>
              rerun.mutate({ id: item.id }, { onError: reportError })
            }
          >
            {t("taskBoard.ampPlan.regenerate")}
          </Button>
        )}
      </div>
    </section>
  );
}
