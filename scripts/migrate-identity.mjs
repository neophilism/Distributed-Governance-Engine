import pg from "pg";
import {
  applyIdentityMigrations,
  pgTransactions,
} from "../server/identity-store.mjs";
let pool;
try {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw Error("Migration credential required");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("Invalid migration configuration");
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(name);
  pool = new pg.Pool({
    connectionString: url.href,
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      servername: url.hostname,
    },
  });
  await applyIdentityMigrations(pgTransactions(pool));
  console.log(
    "Identity migrations verified/applied. Runtime role grants remain a separate administrator action.",
  );
} catch {
  console.error(
    "Identity migration failed; transaction rolled back. Check the administrator configuration and migration history. No credential details were logged.",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
