// Connectors Ote can use. Add yours to CONNECTORS (see ./README.md); Settings lists them all.
import { getStore } from "../store";
import { restConnector, restLogin } from "./rest";
import type { Connector, ConnectorConnection, ConnectorDef, LoginProvider } from "./types";

export const CONNECTORS: ConnectorDef[] = [restConnector];

export const connectorDef = (id: string) => CONNECTORS.find((c) => c.id === id) ?? null;

// one opened connector per connection (they may cache things, like capabilities)
const g = globalThis as unknown as { __connector?: { key: string; c: Connector } };

/** The connected service, or null when Ote runs on its own. */
export async function activeConnector(): Promise<{ conn: ConnectorConnection; def: ConnectorDef; c: Connector } | null> {
  const conn = (await getStore()).connector;
  const def = conn && connectorDef(conn.connector);
  if (!conn || !def) return null;
  const key = `${conn.connector}:${conn.account.id}:${conn.connectedAt}`;
  if (g.__connector?.key !== key) g.__connector = { key, c: def.open(conn) };
  return { conn, def, c: g.__connector.c };
}

/**
 * A device-code sign-in besides the password one: OTE_LOGIN_URL points at a server implementing
 * the REST connector's /auth/device endpoints (OTE_LOGIN_LABEL names it on the button).
 */
export function loginProvider(): LoginProvider | null {
  const url = process.env.OTE_LOGIN_URL?.trim();
  return url ? restLogin(url, process.env.OTE_LOGIN_LABEL?.trim() || "your server") : null;
}
