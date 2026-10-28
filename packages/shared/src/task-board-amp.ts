/** A triage recommendation guides people; it never grants implementation approval. */
export function ampResolution(summary: string | null | undefined) {
  if (!summary || summary.length > 10_000) return null;
  const markers = [
    ...summary.matchAll(
      /^<!-- ticket-action: (research|clarify|configure|plan|reply) -->[ \t]*$/gm,
    ),
  ];
  if (markers.length !== 1) return null;
  switch (markers[0]?.[1]) {
    case "research":
      return "research";
    case "clarify":
      return "clarify";
    case "configure":
      return "configure";
    case "plan":
      return "plan";
    case "reply":
      return "reply";
    default:
      return null;
  }
}

/** Customer drafts use a distinct fence; older summaries used a translated heading. */
export function ampCustomerMessage(
  summary: string | null | undefined,
): string | null {
  if (!summary || summary.length > 10_000) return null;
  const blocks = [
    ...summary.matchAll(/^```([^\r\n]*)\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gm),
  ];
  const last = blocks.at(-1);
  if (!last || summary.slice(last.index + last[0].length).trim()) return null;
  const language = last[1]?.trim().split(/\s+/)[0];
  const explicit = language === "customer-message";
  const legacy =
    language === "text" &&
    /^#{1,6}\s+(?:Bericht aan klant|Customer message|Message to (?:the )?customer|Mensagem ao cliente|Nachricht an (?:den )?Kunden)\s*$/im.test(
      summary.slice(0, last.index).trim().split(/\r?\n/).at(-1) ?? "",
    );
  if (!explicit && !legacy) return null;
  if (
    blocks.filter(
      (block) => block[1]?.trim().split(/\s+/)[0] === "customer-message",
    ).length > 1
  )
    return null;
  return last[2]?.trim() || null;
}
