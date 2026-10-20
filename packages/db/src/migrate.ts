import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.ts";

export async function runMigrations(url: string): Promise<void> {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  console.log("Migrations applied");
}
