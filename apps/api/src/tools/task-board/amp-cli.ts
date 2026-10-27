import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSettings } from "@/settings";
import { mapBounded } from "@decocms/shared/std";
import {
  AmpEvent,
  AmpProject,
  AmpProjectSelectionError,
  ampProjectCandidates,
  selectAmpTeamProject,
} from "./amp-protocol";

export async function resolveAmpTeamProject(repository: string) {
  const ids = ampProjectCandidates(
    JSON.parse(await ampCli(["projects", "list", "--json"])),
    repository,
  );
  if (ids.length > 100)
    throw new AmpProjectSelectionError(
      "Too many Amp projects match this repository. Make the repository mapping unique in Amp.",
    );
  const projects = await mapBounded(ids, 4, async (id) => {
    const project = AmpProject.parse(
      JSON.parse(await ampCli(["projects", "get", id, "--json"])),
    );
    if (project.id !== id)
      throw new AmpProjectSelectionError(
        "Amp returned a different project. This run was not started.",
      );
    return project;
  });
  return selectAmpTeamProject(projects, repository);
}

export async function resolveAmpSummaryProject() {
  const reference = getSettings().ampSummaryProject;
  if (!reference || !/^[\w.-]+\/[\w.-]+$/.test(reference))
    throw new AmpProjectSelectionError(
      "Set AMP_TASK_SUMMARY_PROJECT to a team/project for tickets without a repository.",
    );
  const project = AmpProject.parse(
    JSON.parse(await ampCli(["projects", "get", reference, "--json"])),
  );
  if (
    project.owner.type !== "workspace" ||
    `${project.namespace}/${project.name}` !== reference
  )
    throw new AmpProjectSelectionError(
      "The intake project must belong to an Amp workspace.",
    );
  return { id: project.id, reference, workspaceId: project.owner.workspaceID };
}

/** This process only submits and observes remote work. It receives no Studio credentials. */
export async function ampCli(
  args: string[],
  options: {
    prompt?: string;
    onEvent?: (event: unknown) => Promise<void>;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const settings = getSettings();
  if (!settings.ampApiKey)
    throw new Error("Amp access token is not configured.");
  const cwd = await mkdtemp(join(tmpdir(), "studio-amp-"));
  let process: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = join(cwd, "settings.json");
    await writeFile(
      config,
      JSON.stringify({ "amp.updates.mode": "disabled", "amp.mcpServers": {} }),
    );
    const child = Bun.spawn(
      [settings.ampCliPath, "--settings-file", config, ...args],
      {
        cwd,
        env: {
          PATH: Bun.env.PATH,
          HOME: cwd,
          AMP_API_KEY: settings.ampApiKey,
          NO_COLOR: "1",
        },
        stdin: options.prompt ? new Blob([options.prompt]) : "ignore",
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    process = child;
    timer = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > (options.onEvent ? 2_000_000 : 10_000_000))
        throw new Error("Amp output exceeded the limit.");
      if (options.onEvent) {
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) await options.onEvent(AmpEvent.parse(JSON.parse(line)));
        }
      }
    }
    buffer += decoder.decode();
    if (options.onEvent && buffer.trim())
      await options.onEvent(AmpEvent.parse(JSON.parse(buffer)));
    if ((await child.exited) !== 0)
      throw new Error(
        "Amp command failed. Check the Amp thread for its current state.",
      );
    return buffer;
  } finally {
    clearTimeout(timer);
    process?.kill();
    if (process) await process.exited;
    await rm(cwd, { recursive: true, force: true });
  }
}
