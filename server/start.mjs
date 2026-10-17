import { readFile } from "node:fs/promises";
import pg from "pg";
import { createDocumentStore } from "./document-store.mjs";
import { createDocumentRoutes, documentBodyLimit } from "./document-http.mjs";
import {
  createIdentityStore,
  pgTransactions,
  verifyIdentityRuntime,
} from "./identity-store.mjs";
import { discoverIdentityProvider, createOIDCLogin } from "./oidc-login.mjs";
import { createAccountHandler } from "./account-http.mjs";
import { createEngineApplication, createEngineServer } from "./application.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw Error("Missing configuration: " + name);
  return value;
};
try {
  const origin = required("PUBLIC_ORIGIN"),
    url = new URL(required("DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
    throw Error("Invalid database configuration");
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(name);
  const pool = new pg.Pool({
    connectionString: url.href,
    max: 4,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    ssl: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      servername: url.hostname,
    },
  });
  pool.on("error", () => {}); // No credential-bearing pg error objects enter logs.
  await verifyIdentityRuntime(pool);
  const decode = (name) => {
    const raw = required(name);
    if (!/^[a-f0-9]{64}$/.test(raw))
      throw Error("Identity keys must be 32-byte lowercase hexadecimal values");
    return Buffer.from(raw, "hex");
  };
  const store = createIdentityStore({
    transaction: pgTransactions(pool),
    sessionKey: decode("SESSION_KEY"),
    stateKey: decode("OIDC_STATE_KEY"),
    origin,
  });
  const configuration = await discoverIdentityProvider({
    issuer: required("OIDC_ISSUER"),
    clientId: required("OIDC_CLIENT_ID"),
    clientSecret: required("OIDC_CLIENT_SECRET"),
  });
  const redirectUri = origin + "/auth/callback";
  const login = createOIDCLogin({ store, configuration, redirectUri }),
    accounts = createAccountHandler({
      store,
      login,
      origin,
      extensions: [
        createDocumentRoutes({
          documents: createDocumentStore({
            identity: store,
            transaction: pgTransactions(pool),
          }),
        }),
      ],
    });
  const application = createEngineApplication({
    accounts,
    origin,
    product: process.env.QUILL_PRODUCT ?? "civic",
  });
  const key = await readFile(required("TLS_KEY_FILE")),
    cert = await readFile(required("TLS_CERT_FILE"));
  const server = createEngineServer({
    application,
    origin,
    key,
    cert,
    bodyLimit: documentBodyLimit,
  });
  const port = Number(process.env.PORT ?? 8443);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid port");
  server.listen(port, process.env.BIND_ADDRESS ?? "127.0.0.1", () =>
    console.log(
      "Governance account service listening; configured origin and credentials are not logged.",
    ),
  );
  const stop = () => {
    server.close(() => {
      pool.end().finally(() => process.exit());
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch {
  console.error(
    "Account service startup failed. Check configured origin, identity provider, migrations, runtime permissions, TLS and secret references. No credential details were logged.",
  );
  process.exit(1);
}
