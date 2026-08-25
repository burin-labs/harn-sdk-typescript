const protocol = await import("../dist/protocol.js");

if (typeof protocol.getProviderCatalog !== "function") {
  throw new Error("Built protocol subpath does not export getProviderCatalog");
}
if (typeof protocol.takeoverSessionClient !== "function") {
  throw new Error("Built protocol subpath does not export takeoverSessionClient");
}

console.log("Verified built Node ESM protocol subpath.");
