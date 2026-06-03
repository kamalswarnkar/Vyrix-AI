import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

let sqliteInstance: Database.Database | null = null;

export function getSqliteClient(dbPath: string): Database.Database {
  if (!sqliteInstance) {
    sqliteInstance = new Database(dbPath);
    sqliteInstance.pragma("journal_mode = WAL");
    sqliteInstance.pragma("foreign_keys = ON");
    sqliteInstance.exec(loadSqliteSchema());
  }

  return sqliteInstance;
}

function loadSqliteSchema(): string {
  const schemaPath = path.join(
    process.cwd(),
    "src",
    "server",
    "db",
    "sqlite",
    "schema.sql",
  );

  return readFileSync(schemaPath, "utf8");
}
