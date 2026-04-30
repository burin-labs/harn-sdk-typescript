import { HarnClient, oauth2DeviceFlow } from "../src/index.js";

const flow = await oauth2DeviceFlow({
  issuerUrl: process.env.HARN_OIDC_ISSUER ?? "https://auth.harnlang.com",
  clientId: process.env.HARN_OIDC_CLIENT_ID ?? "harn-cli",
  scope: ["openid", "profile", "harn:agents"],
});

console.log(`Open ${flow.authorization.verification_uri_complete ?? flow.authorization.verification_uri}`);
console.log(`Code: ${flow.authorization.user_code}`);

await flow.pollForToken();

const client = new HarnClient({
  baseUrl: process.env.HARN_BASE_URL ?? "https://api.harnlang.com",
  auth: flow.auth,
});

console.log(await client.getProtocolDiscovery());
