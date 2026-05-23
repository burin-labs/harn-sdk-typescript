# Changelog

All notable changes to `@burin-labs/harn` are tracked here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Security

- **F1 (HIGH) — Cross-host bearer leak guard.** The `Authorization` header is
  now host-pinned to `baseUrl`. If a request URL points at a different host
  (e.g. via an absolute path passed through a custom `auth` provider), the
  bearer header is suppressed. A `console.warn` fires when `baseUrl` is
  overridden alongside a configured token / auth provider.
- **F9 (LOW) — https-only `baseUrl`.** Constructing `HarnClient` with a
  non-https `baseUrl` throws unless the host is `localhost` / `127.0.0.1`.
- **F12 (LOW) — symmetric timestamp/tolerance guard for webhooks.**
  `parseApprovalWebhook` now throws when a `timestamp` is provided without
  `toleranceSeconds`, mirroring the pre-existing
  `toleranceSeconds`-without-`timestamp` check. Previously the age window was
  silently skipped.

### Deprecated

- **F11 (MEDIUM) — `apiKey` / `apiKeyAuth`** are now marked `@deprecated`
  aliases of `accessToken` / `bearerTokenAuth`. Both code paths continue to
  work; new code should use the explicit bearer names.
