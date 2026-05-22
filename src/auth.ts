import { sleep } from "./timing.js";
import type { Sleep } from "./timing.js";

export interface HarnAuthContext {
  url: URL;
  method: string;
}

export type AuthProvider = (context: HarnAuthContext) => HeadersInit | Promise<HeadersInit>;

export function apiKeyAuth(apiKey: string): AuthProvider {
  return bearerTokenAuth(apiKey);
}

export function bearerTokenAuth(token: string | (() => string | Promise<string>)): AuthProvider {
  return async () => ({
    Authorization: `Bearer ${typeof token === "function" ? await token() : token}`,
  });
}

export function staticHeadersAuth(headers: HeadersInit): AuthProvider {
  return () => headers;
}

export function browserOidcAuth(getAccessToken: () => string | Promise<string>): AuthProvider {
  return bearerTokenAuth(getAccessToken);
}

export interface OAuth2DeviceFlowOptions {
  issuerUrl: string;
  clientId: string;
  scope?: string | string[];
  audience?: string;
  fetch?: typeof fetch;
}

export interface OAuth2DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
  token_endpoint: string;
}

export interface OAuth2DeviceToken {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export async function oauth2DeviceFlow(options: OAuth2DeviceFlowOptions): Promise<{
  authorization: OAuth2DeviceAuthorization;
  pollForToken: (pollOptions?: OAuth2DevicePollOptions) => Promise<OAuth2DeviceToken>;
  auth: AuthProvider;
}> {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    throw new Error("A fetch implementation is required for OAuth2 device flow.");
  }

  const discoveryUrl = new URL(".well-known/openid-configuration", ensureTrailingSlash(options.issuerUrl));
  const discovery = await fetchJson<{
    device_authorization_endpoint?: string;
    token_endpoint?: string;
  }>(fetchImpl, discoveryUrl, { method: "GET" });

  if (!discovery.device_authorization_endpoint || !discovery.token_endpoint) {
    throw new Error("OIDC discovery document does not advertise device authorization and token endpoints.");
  }

  const body = new URLSearchParams({ client_id: options.clientId });
  if (options.scope) {
    body.set("scope", Array.isArray(options.scope) ? options.scope.join(" ") : options.scope);
  }
  if (options.audience) {
    body.set("audience", options.audience);
  }

  const authorization = await fetchJson<Omit<OAuth2DeviceAuthorization, "token_endpoint">>(
    fetchImpl,
    new URL(discovery.device_authorization_endpoint),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  let latestToken: OAuth2DeviceToken | undefined;
  const fullAuthorization = { ...authorization, token_endpoint: discovery.token_endpoint };

  return {
    authorization: fullAuthorization,
    pollForToken: async (pollOptions = {}) => {
      latestToken = await pollDeviceToken(fetchImpl, fullAuthorization, options.clientId, pollOptions);
      return latestToken;
    },
    auth: async () => {
      if (!latestToken) {
        throw new Error("No OAuth2 token is available. Call pollForToken() before using this auth provider.");
      }
      return { Authorization: `${latestToken.token_type} ${latestToken.access_token}` };
    },
  };
}

async function pollDeviceToken(
  fetchImpl: typeof fetch,
  authorization: OAuth2DeviceAuthorization,
  clientId: string,
  options: OAuth2DevicePollOptions,
): Promise<OAuth2DeviceToken> {
  let intervalMs = options.intervalMs ?? (authorization.interval ?? 5) * 1000;
  const now = options.now ?? Date.now;
  const delay = options.sleep ?? sleep;
  const expiresAt = now() + authorization.expires_in * 1000;

  while (now() < expiresAt) {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: authorization.device_code,
      client_id: clientId,
    });

    const response = await fetchImpl(authorization.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: options.signal,
    });
    const payload = await safeJson<{ error?: string } & Partial<OAuth2DeviceToken>>(response);

    if (response.ok && payload.access_token && payload.token_type) {
      return payload as OAuth2DeviceToken;
    }
    if (payload.error === "authorization_pending") {
      await delay(intervalMs, options.signal);
      continue;
    }
    if (payload.error === "slow_down") {
      intervalMs += 5000;
      await delay(intervalMs, options.signal);
      continue;
    }
    throw new Error(payload.error ?? `OAuth2 token request failed with HTTP ${response.status}`);
  }

  throw new Error("OAuth2 device authorization expired before a token was issued.");
}

export interface OAuth2DevicePollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  now?: () => number;
  sleep?: Sleep;
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: URL, init: RequestInit): Promise<T> {
  const response = await fetchImpl(url, init);
  const payload = await safeJson<T>(response);
  if (!response.ok) {
    throw new Error(`OAuth2 request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function safeJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
