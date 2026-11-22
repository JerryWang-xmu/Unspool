import { buildServer } from "../apps/runner-api/dist/apps/runner-api/src/index.js";

const port = Number(process.env.UNSPOOL_VALIDATION_PORT ?? "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid validation port");
const dataDir = process.env.UNSPOOL_DATA_DIR;
if (dataDir === undefined || !dataDir.includes("validation")) {
  throw new Error("UNSPOOL_DATA_DIR must name a dedicated validation directory");
}
if (process.env.NODE_ENV === "production")
  throw new Error("The static validation identities are not for production");

const server = await buildServer({
  dataDir,
  ownerToken: "validation-us2-us4-owner",
  logger: false,
  additionalTokens: {
    "validation-us2-operator": { id: "us2-operator", displayName: "US2 Operator" },
    "validation-us2-contributor": { id: "us2-contributor", displayName: "US2 Contributor" },
    "validation-us2-observer": { id: "us2-observer", displayName: "US2 Observer" },
    "validation-us2-expert": { id: "us2-expert", displayName: "US2 Expert" },
    "validation-us2-admin": { id: "us2-admin", displayName: "US2 Administrator" },
    "validation-us4-operator": { id: "us4-operator", displayName: "US4 Operator" },
    "validation-us4-recipient": { id: "us4-recipient", displayName: "US4 Recipient" },
    "validation-us4-second-operator": {
      id: "us4-second-operator",
      displayName: "US4 Second Operator",
    },
    "validation-us4-outsider": { id: "us4-outsider", displayName: "US4 Outsider" },
  },
});
await server.listen({ host: "127.0.0.1", port });
console.log(`Validation Runner listening at http://127.0.0.1:${port}/v1`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
