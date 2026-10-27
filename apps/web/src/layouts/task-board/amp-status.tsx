import { Spinner } from "@decocms/ui/components/spinner.tsx";
import { cn } from "@decocms/ui/lib/utils.ts";
import { useT, type TranslationKey } from "@/i18n/use-t";
import type { TaskBoardItem } from "./config";

const PHASE_LABELS: Record<
  NonNullable<TaskBoardItem["ampRun"]>["phase"],
  TranslationKey
> = {
  legacy: "taskBoard.ampStatus.implementing",
  summary: "taskBoard.ampStatus.summarizing",
  planning: "taskBoard.ampStatus.planning",
  implementation: "taskBoard.ampStatus.implementing",
  review: "taskBoard.ampStatus.reviewing",
};

export function AmpStatus({
  item,
  className,
}: {
  item: TaskBoardItem;
  className?: string;
}) {
  const t = useT();
  const run = item.ampRun;
  if (!run || run.state === "completed" || run.state === "failed") return null;
  const label =
    run.state === "queued"
      ? "taskBoard.ampStatus.queued"
      : run.state === "starting"
        ? "taskBoard.ampStatus.starting"
        : run.state === "unknown"
          ? "taskBoard.ampStatus.reconnecting"
          : PHASE_LABELS[run.phase];
  return (
    <span
      role="status"
      className={cn(
        "flex min-w-0 items-center gap-2 text-xs text-primary",
        className,
      )}
    >
      <Spinner size="2xs" className="motion-reduce:animate-none" />
      <span>{t(label)}</span>
    </span>
  );
}
