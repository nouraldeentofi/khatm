import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };
export { runMigrations } from "./migrate.ts";

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { $client: client });
}
