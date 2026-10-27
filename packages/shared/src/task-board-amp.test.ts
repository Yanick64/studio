import { expect, test } from "bun:test";
import { ampCustomerMessage } from "./task-board-amp";

test("extracts only a complete final customer draft, including legacy summaries", () => {
  expect(
    ampCustomerMessage(
      "Summary\n\n```customer-message\nHello, please confirm the city.\n```",
    ),
  ).toBe("Hello, please confirm the city.");
  for (const heading of [
    "Bericht aan klant",
    "Customer message",
    "Mensagem ao cliente",
    "Nachricht an den Kunden",
  ]) {
    expect(
      ampCustomerMessage(
        `Summary\n\n### ${heading}\n\n\`\`\`text copy Copy\nHello.\n\`\`\``,
      ),
    ).toBe("Hello.");
  }
  expect(
    ampCustomerMessage(
      "Summary\r\n\r\n```customer-message\r\nHello.\r\n```\r\n",
    ),
  ).toBe("Hello.");
});

test("ordinary code, empty, truncated, duplicate and oversized drafts do not request customer action", () => {
  for (const summary of [
    null,
    "",
    "Summary only",
    "```text\nSome code\n```",
    "### Bericht aan klant\n```text\n\n```",
    "```customer-message\nUnfinished",
    "```customer-message\nDraft\n```\nStill working on it",
    "```customer-message\nFirst\n```\n```customer-message\nSecond\n```",
    `Summary\n\`\`\`customer-message\n${"x".repeat(10_001)}\n\`\`\``,
  ])
    expect(ampCustomerMessage(summary)).toBeNull();
});
