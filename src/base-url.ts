export const DEFAULT_HARN_BASE_URL = "https://api.harnlang.com";

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeHarnBaseUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  const scheme = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  if (scheme === "https:" || (scheme === "http:" && LOCAL_HTTP_HOSTS.has(host))) {
    return url;
  }
  throw new Error(
    `Harn baseUrl must use https:// (got ${url.toString()}); ` +
      `http:// is only allowed for localhost / 127.0.0.1`,
  );
}

export function warnForAuthenticatedCustomBaseUrl(
  baseUrl: URL,
  authenticated: boolean,
): void {
  const overridden =
    baseUrl.toString().replace(/\/$/, "") !==
    new URL(DEFAULT_HARN_BASE_URL).toString().replace(/\/$/, "");
  if (overridden && authenticated && typeof globalThis.console !== "undefined") {
    globalThis.console.warn(
      `[harn] baseUrl overridden to ${baseUrl.toString()} while a token/auth ` +
        `provider is configured. Only use credentials issued for this host.`,
    );
  }
}
