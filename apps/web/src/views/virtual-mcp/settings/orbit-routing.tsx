import { useId, useState } from "react";
import { z } from "zod";
import {
  parseRepoUrl,
  repoWebUrl,
  sameRepo,
  splitOwnerName,
} from "@decocms/shared/git-providers";
import type { RepositoryBinding } from "@decocms/shared/sdk/types";
import {
  EmailRoutingRulesSchema,
  matchesEmailRules,
} from "@decocms/shared/ticket-routing";
import { Button } from "@decocms/ui/components/button.tsx";
import { Input } from "@decocms/ui/components/input.tsx";
import { Textarea } from "@decocms/ui/components/textarea.tsx";
import {
  SettingsCard,
  SettingsCardRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { useT } from "@/i18n/use-t";
import { VirtualMcpFormSchema, type VirtualMcpFormReturn } from "../types";

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export function OrbitRoutingSettings({
  form,
  onCommit,
}: {
  form: VirtualMcpFormReturn;
  onCommit: () => Promise<unknown>;
}) {
  const t = useT();
  const id = useId();
  const metadata = form.getValues("metadata");
  const [clients, setClients] = useState(() =>
    (metadata?.orbitClientIds ?? []).join("\n"),
  );
  const [repositories, setRepositories] = useState(() =>
    [metadata?.repository, ...(metadata?.additionalRepositories ?? [])]
      .flatMap((repo) => (repo ? [repo.url] : []))
      .join("\n"),
  );
  const [emails, setEmails] = useState(() =>
    (metadata?.emailRoutingRules ?? []).join("\n"),
  );
  const [sentryProjects, setSentryProjects] = useState(() =>
    (metadata?.sentryProjects ?? []).join("\n"),
  );
  const [testAddress, setTestAddress] = useState("");
  const [matchResult, setMatchResult] = useState<
    "match" | "noMatch" | "invalid" | null
  >(null);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setError(false);
    setSaved(false);
    const current = form.getValues();
    const existing = [
      current.metadata?.repository,
      ...(current.metadata?.additionalRepositories ?? []),
    ];
    const bindings: RepositoryBinding[] = [];
    for (const url of lines(repositories)) {
      const ref = parseRepoUrl(url);
      if (
        !ref ||
        bindings.some((repo) => {
          const other = parseRepoUrl(repo.url);
          return other && sameRepo(other, ref);
        })
      ) {
        setError(true);
        return;
      }
      const previous = existing.find((repo) => {
        const other = repo && parseRepoUrl(repo.url);
        return other && sameRepo(other, ref);
      });
      bindings.push(
        previous ?? { url: repoWebUrl(ref), ...splitOwnerName(ref) },
      );
    }
    const next = {
      ...current,
      metadata: {
        ...current.metadata,
        orbitClientIds: lines(clients),
        emailRoutingRules: lines(emails),
        sentryProjects: lines(sentryProjects),
        repository: bindings[0] ?? null,
        additionalRepositories: bindings.slice(1),
      },
    };
    if (!VirtualMcpFormSchema.safeParse(next).success) {
      setError(true);
      return;
    }
    setPending(true);
    try {
      form.setValue("metadata.orbitClientIds", next.metadata.orbitClientIds, {
        shouldDirty: true,
      });
      form.setValue(
        "metadata.emailRoutingRules",
        next.metadata.emailRoutingRules,
        { shouldDirty: true },
      );
      form.setValue("metadata.sentryProjects", next.metadata.sentryProjects, {
        shouldDirty: true,
      });
      form.setValue("metadata.repository", next.metadata.repository, {
        shouldDirty: true,
      });
      form.setValue(
        "metadata.additionalRepositories",
        next.metadata.additionalRepositories,
        { shouldDirty: true },
      );
      await onCommit();
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSection
      title={t("virtualMcp.orbit.title")}
      description={t("virtualMcp.orbit.description")}
    >
      <SettingsCard>
        <SettingsCardRow>
          <label htmlFor={`${id}-emails`} className="text-sm font-medium">
            {t("virtualMcp.routing.emails")}
          </label>
          <Textarea
            id={`${id}-emails`}
            className="mt-2"
            value={emails}
            disabled={pending}
            onChange={(event) => {
              setEmails(event.target.value);
              setSaved(false);
              setMatchResult(null);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("virtualMcp.routing.emailsHelp")}
          </p>
          <label htmlFor={`${id}-test-address`} className="mt-3 block text-sm">
            {t("virtualMcp.routing.testAddress")}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              id={`${id}-test-address`}
              type="email"
              className="min-w-0 flex-1"
              value={testAddress}
              onChange={(event) => {
                setTestAddress(event.target.value);
                setMatchResult(null);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const rules = EmailRoutingRulesSchema.safeParse(lines(emails));
                setMatchResult(
                  !rules.success ||
                    !z.email().safeParse(testAddress.trim()).success
                    ? "invalid"
                    : matchesEmailRules(rules.data, [testAddress.trim()])
                      ? "match"
                      : "noMatch",
                );
              }}
            >
              {t("virtualMcp.routing.test")}
            </Button>
          </div>
          {matchResult && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {t(`virtualMcp.routing.${matchResult}`)}
            </p>
          )}
        </SettingsCardRow>
        <SettingsCardRow>
          <label htmlFor={`${id}-sentry`} className="text-sm font-medium">
            {t("virtualMcp.routing.sentry")}
          </label>
          <Textarea
            id={`${id}-sentry`}
            className="mt-2"
            value={sentryProjects}
            disabled={pending}
            onChange={(event) => {
              setSentryProjects(event.target.value);
              setSaved(false);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("virtualMcp.routing.sentryHelp")}
          </p>
        </SettingsCardRow>
        <SettingsCardRow>
          <label htmlFor={`${id}-clients`} className="text-sm font-medium">
            {t("virtualMcp.orbit.clients")}
          </label>
          <Textarea
            id={`${id}-clients`}
            className="mt-2"
            value={clients}
            disabled={pending}
            onChange={(event) => {
              setClients(event.target.value);
              setSaved(false);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("virtualMcp.orbit.clientsHelp")}
          </p>
        </SettingsCardRow>
        <SettingsCardRow>
          <label htmlFor={`${id}-repositories`} className="text-sm font-medium">
            {t("virtualMcp.orbit.repositories")}
          </label>
          <Textarea
            id={`${id}-repositories`}
            className="mt-2"
            value={repositories}
            disabled={pending}
            onChange={(event) => {
              setRepositories(event.target.value);
              setSaved(false);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("virtualMcp.orbit.repositoriesHelp")}
          </p>
        </SettingsCardRow>
        <SettingsCardRow>
          <Button type="button" disabled={pending} onClick={save}>
            {t("virtualMcp.orbit.save")}
          </Button>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t("virtualMcp.orbit.error")}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-2 text-sm text-success">
              {t("virtualMcp.orbit.saved")}
            </p>
          )}
        </SettingsCardRow>
      </SettingsCard>
    </SettingsSection>
  );
}
