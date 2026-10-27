import { useId, useState } from "react";
import {
  parseRepoUrl,
  repoWebUrl,
  sameRepo,
  splitOwnerName,
} from "@decocms/shared/git-providers";
import type { RepositoryBinding } from "@decocms/shared/sdk/types";
import { Button } from "@decocms/ui/components/button.tsx";
import { Textarea } from "@decocms/ui/components/textarea.tsx";
import {
  SettingsCard,
  SettingsCardRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { useT } from "@/i18n/use-t";
import { VirtualMcpFormSchema, type VirtualMcpFormReturn } from "../types";

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
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setError(false);
    setSaved(false);
    const lines = (value: string) =>
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
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
