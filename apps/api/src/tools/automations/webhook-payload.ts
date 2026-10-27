/** Preserve dotted field names used by form-encoded webhook senders. */
export function parseWebhookPayload(
  body: string,
  contentType: string | undefined,
): unknown {
  if (!body.trim()) return null;

  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/x-www-form-urlencoded") {
    const fields = new Map<string, string | string[]>();
    for (const [key, value] of new URLSearchParams(body)) {
      const previous = fields.get(key);
      if (Array.isArray(previous)) previous.push(value);
      else fields.set(key, previous === undefined ? value : [previous, value]);
    }
    return Object.fromEntries(fields);
  }

  // Keep the existing JSON/empty-payload behavior for other senders.
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
