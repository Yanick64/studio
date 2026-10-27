import { ampCustomerMessage } from "@decocms/shared/task-board-amp";
import { Button } from "@decocms/ui/components/button.tsx";
import { useCopy } from "@decocms/ui/hooks/use-copy.ts";
import { useT, type TranslationKey } from "@/i18n/use-t";
import { toast } from "sonner";
import type { TaskBoardItem } from "./config";
import { AmpStatus } from "./amp-status";

type Destination = "summary" | "plan" | "review" | "activity";

export function AmpNextAction({
  item,
  onOpenTab,
}: {
  item: TaskBoardItem;
  onOpenTab: (tab: Destination) => void;
}) {
  const t = useT();
  const { handleCopy, copied } = useCopy();
  const run = item.ampRun;
  if (!run) return null;
  if (!["completed", "failed"].includes(run.state)) {
    return (
      <div className="my-4 rounded-xl bg-muted/40 px-4 py-3">
        <AmpStatus
          item={item}
          className="gap-2.5 text-sm font-medium text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground"
        />
        <p className="mt-1 pl-6.5 text-xs leading-relaxed text-muted-foreground">
          {t("taskBoard.nextAction.waitDescription")}
        </p>
      </div>
    );
  }
  if (
    [
      "done",
      "archived",
      "ready_for_deployment",
      "post_deploy_validation",
    ].includes(item.status)
  )
    return null;
  const customerMessage = ampCustomerMessage(run.summary);
  let title: TranslationKey;
  let description: TranslationKey;
  let destination: Destination | undefined;
  let action: TranslationKey | undefined;
  let canCopy = false;
  if (run.state === "failed") {
    title = "taskBoard.nextAction.failedTitle";
    description = "taskBoard.nextAction.failedDescription";
    destination =
      run.phase === "summary"
        ? "summary"
        : run.phase === "review"
          ? "review"
          : run.phase === "legacy"
            ? "activity"
            : "plan";
    action = "taskBoard.nextAction.viewDetails";
  } else if (item.status === "customer_approval") {
    title = "taskBoard.nextAction.customerResponseTitle";
    description = "taskBoard.nextAction.customerResponseDescription";
    destination = "activity";
    action = "taskBoard.nextAction.openConversation";
  } else if (run.phase === "planning" && run.plan) {
    title = "taskBoard.nextAction.planTitle";
    description = "taskBoard.nextAction.planDescription";
    destination = "plan";
    action = "taskBoard.nextAction.viewPlan";
  } else if (run.phase === "review") {
    title = "taskBoard.nextAction.reviewTitle";
    description = "taskBoard.nextAction.reviewDescription";
    destination = "review";
    action = "taskBoard.nextAction.viewReview";
  } else if (run.phase === "summary" && customerMessage) {
    title = "taskBoard.nextAction.customerTitle";
    description = "taskBoard.nextAction.customerDescription";
    destination = "summary";
    action = "taskBoard.nextAction.viewMessage";
    canCopy = true;
  } else if (run.phase === "summary") {
    title = "taskBoard.nextAction.summaryTitle";
    description = "taskBoard.nextAction.summaryDescription";
    destination = "summary";
    action = "taskBoard.nextAction.viewSummary";
  } else {
    title = "taskBoard.nextAction.outcomeTitle";
    description = "taskBoard.nextAction.outcomeDescription";
    destination = "activity";
    action = "taskBoard.nextAction.viewOutcome";
  }
  return (
    <section
      aria-label={t("taskBoard.nextAction.label")}
      className="my-4 space-y-2 rounded-xl border border-border bg-background p-4 shadow-xs"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {t("taskBoard.nextAction.label")}
      </p>
      <h2 className="text-sm font-semibold">{t(title)}</h2>
      <p className="text-sm text-muted-foreground">{t(description)}</p>
      {(destination || canCopy) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {destination && action && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenTab(destination)}
            >
              {t(action)}
            </Button>
          )}
          {canCopy && customerMessage && (
            <Button
              size="sm"
              onClick={() =>
                void handleCopy(customerMessage).catch(() =>
                  toast.error(t("taskBoard.nextAction.copyFailed")),
                )
              }
            >
              {t(
                copied
                  ? "taskBoard.nextAction.copied"
                  : "taskBoard.nextAction.copyMessage",
              )}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
