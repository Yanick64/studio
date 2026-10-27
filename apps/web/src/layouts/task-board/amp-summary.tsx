import { Button } from "@decocms/ui/components/button.tsx";
import { MemoizedMarkdown } from "@/components/chat/markdown";
import { useTaskBoardItemActions } from "@/hooks/use-task-board-items";
import { useT } from "@/i18n/use-t";
import { toast } from "sonner";
import type { TaskBoardItem } from "./config";

export function AmpSummary({ item }: { item: TaskBoardItem }) {
  const t = useT();
  const { rerun } = useTaskBoardItemActions();
  const run = item.ampRun;
  if (!run || (!run.summary && run.phase !== "summary")) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {t("taskBoard.ampSummary.empty")}
      </p>
    );
  }
  const active =
    run.phase === "summary" && !["completed", "failed"].includes(run.state);
  return (
    <section
      className="my-4 space-y-3 rounded-lg border border-border p-4"
      aria-label={t("taskBoard.ampSummary.title")}
    >
      <h2 className="font-medium">{t("taskBoard.ampSummary.title")}</h2>
      {active && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("taskBoard.ampSummary.running")}
        </p>
      )}
      {run.phase === "summary" && run.state === "failed" && (
        <p className="text-sm text-warning" role="status">
          {t("taskBoard.ampSummary.failed")}
        </p>
      )}
      {run.summary && (
        <MemoizedMarkdown
          id={`amp-summary-${item.id}`}
          text={run.summary.replace(
            /^```customer-message[^\r\n]*$/gm,
            "```text",
          )}
        />
      )}
      {item.status === "triage" && !active && (
        <Button
          variant="outline"
          size="sm"
          disabled={rerun.isPending}
          onClick={() =>
            rerun.mutate(
              { id: item.id },
              { onError: (error) => toast.error(error.message) },
            )
          }
        >
          {t("taskBoard.ampSummary.refresh")}
        </Button>
      )}
    </section>
  );
}
