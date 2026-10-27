import { Button } from "@decocms/ui/components/button.tsx";
import { MemoizedMarkdown } from "@/components/chat/markdown";
import { useRunReviewer } from "@/hooks/use-run-reviewer";
import { useT } from "@/i18n/use-t";
import { toast } from "sonner";
import type { TaskBoardItem } from "./config";

export function AmpReview({
  item,
  disabled,
}: {
  item: TaskBoardItem;
  disabled: boolean;
}) {
  const t = useT();
  const review = useRunReviewer(item.id);
  const run = item.ampRun;
  if (!run || (!run.review && run.phase !== "review")) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {t("taskBoard.ampReview.empty")}
      </p>
    );
  }
  const terminal = run.state === "completed" || run.state === "failed";
  return (
    <section
      className="my-6 space-y-4 rounded-lg border border-border p-4"
      aria-label={t("taskBoard.ampReview.title")}
    >
      <h2 className="font-medium">{t("taskBoard.ampReview.title")}</h2>
      {run.phase === "review" && (
        <p className="text-sm text-muted-foreground" role="status">
          {t(
            run.state === "failed"
              ? "taskBoard.ampReview.failed"
              : run.state === "completed"
                ? "taskBoard.ampReview.completed"
                : "taskBoard.ampReview.running",
          )}
        </p>
      )}
      {run.review && (
        <MemoizedMarkdown id={`amp-review-${run.runId}`} text={run.review} />
      )}
      {run.phase === "review" && terminal && item.status === "in_review" && (
        <Button
          variant="outline"
          disabled={disabled || review.isPending}
          onClick={() =>
            review.mutate(undefined, {
              onError: (error) => toast.error(error.message),
            })
          }
        >
          {t("taskBoard.ampReview.retry")}
        </Button>
      )}
    </section>
  );
}
