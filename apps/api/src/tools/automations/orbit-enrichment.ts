import type { z } from "zod";
import type { StudioContext } from "@/core/studio-context";
import { clientFromConnection } from "@/mcp-clients";
import type { OrbitTicketSchema } from "./orbit-ticket";
import {
  OrbitTicketSearchSchema,
  OrbitTicketDetailSchema,
  OrbitTicketCommentsSchema,
  orbitResultJson,
  orbitTicketMatch,
  renderOrbitContext,
} from "./orbit-context";

export const ORBIT_CONTEXT_TOOLS = [
  "ListTickets",
  "GetTicketDetail",
  "ListTicketComments",
];

async function loadContext(
  ctx: StudioContext,
  connectionId: string,
  ticket: z.infer<typeof OrbitTicketSchema>,
  signal: AbortSignal,
): Promise<string> {
  const organizationId = ctx.organization?.id;
  if (!organizationId) throw new Error("Organization required");
  const connection = await ctx.storage.connections.findById(
    connectionId,
    organizationId,
  );
  if (!connection || connection.status !== "active")
    throw new Error("Orbit connection unavailable");
  if (
    !(await ctx.boundAuth.hasPermission(
      { [connectionId]: ORBIT_CONTEXT_TOOLS },
      { organizationId, role: ctx.access.getRole() },
    ))
  )
    throw new Error("Orbit context access denied");
  signal.throwIfAborted();
  const client = await clientFromConnection(connection, ctx, false);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      signal.throwIfAborted();
      return orbitResultJson(
        await client.callTool({ name, arguments: args }, undefined, {
          signal,
          timeout: 8_000,
        }),
      );
    };
    // Webhooks carry the human ticket number, while detail tools require api_id.
    const search = OrbitTicketSearchSchema.parse(
      await call("ListTickets", {
        query: ticket["TICKET.ID"],
        state: "NEW|OPEN|WAIT|CLOSED|DELETED|REQCLOSE",
        ...(ticket["CLIENT.ID"] ? { clientId: ticket["CLIENT.ID"] } : {}),
        limit: 100,
      }),
    );
    const ticketId = orbitTicketMatch(
      search,
      ticket["TICKET.ID"],
      ticket["CLIENT.ID"],
    );
    const detail = OrbitTicketDetailSchema.parse(
      await call("GetTicketDetail", { ticketId }),
    );
    if (
      detail.ticketId !== ticketId ||
      detail.number !== ticket["TICKET.ID"] ||
      (ticket["CLIENT.ID"] && detail.clientId !== ticket["CLIENT.ID"])
    ) {
      throw new Error("Orbit ticket identity changed");
    }
    const history = OrbitTicketCommentsSchema.parse(
      await call("ListTicketComments", {
        ticketId,
        includeInternal: "true",
        limit: 100,
      }),
    );
    return renderOrbitContext(detail, history);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Intake is already saved. A slow/unavailable Orbit must not hold up delivery. */
export async function fetchOrbitTicketContext(
  ctx: StudioContext,
  connectionId: string,
  ticket: z.infer<typeof OrbitTicketSchema>,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Orbit context timed out"));
    }, 12_000);
  });
  try {
    return await Promise.race([
      loadContext(ctx, connectionId, ticket, controller.signal),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
