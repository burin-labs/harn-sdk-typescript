import {
  DEFAULT_HARN_BASE_URL,
  normalizeHarnBaseUrl,
  warnForAuthenticatedCustomBaseUrl,
} from "./base-url.js";
import { createClient } from "./generated/protocol/client/index.js";
import type { Client, Config } from "./generated/protocol/client/index.js";

export const HARN_PROTOCOL_VERSION = "agents-protocol-2026-04-25" as const;

export const HARN_PROTOCOL_HEADERS = {
  "Harn-Agents-Protocol-Version": HARN_PROTOCOL_VERSION,
} as const;

export interface HarnProtocolClientOptions {
  baseUrl?: string | URL;
  accessToken?: string | (() => string | Promise<string>);
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

/**
 * Create the transport consumed by every generated protocol operation.
 *
 * The generated operation functions and models are the protocol's semantic
 * owner. This factory adds Harn's safe URL and authentication defaults once,
 * without wrapping or duplicating those operations.
 */
export function createHarnProtocolClient(options: HarnProtocolClientOptions = {}): Client {
  const baseUrl = normalizeHarnBaseUrl(options.baseUrl ?? DEFAULT_HARN_BASE_URL);
  warnForAuthenticatedCustomBaseUrl(baseUrl, options.accessToken !== undefined);

  const config: Config = {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    headers: mergeProtocolHeaders(options.headers),
  };
  if (options.accessToken !== undefined) {
    config.auth = options.accessToken;
  }
  if (options.fetch !== undefined) {
    config.fetch = options.fetch;
  }
  return createClient(config);
}

function mergeProtocolHeaders(headers: HeadersInit | undefined): Headers {
  const merged = new Headers(headers);
  merged.set("Harn-Agents-Protocol-Version", HARN_PROTOCOL_VERSION);
  return merged;
}
