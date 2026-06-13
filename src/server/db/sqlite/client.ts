import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

let sqliteInstance: Database.Database | null = null;

export function getSqliteClient(dbPath: string): Database.Database {
  if (!sqliteInstance) {
    const absoluteDbPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), dbPath);
    mkdirSync(path.dirname(absoluteDbPath), { recursive: true });
    sqliteInstance = new Database(absoluteDbPath);
    sqliteInstance.pragma("journal_mode = WAL");
    sqliteInstance.pragma("foreign_keys = ON");
    sqliteInstance.exec(loadSqliteSchema());
    runSqliteMigrations(sqliteInstance);
  }

  return sqliteInstance;
}

function loadSqliteSchema(): string {
  const schemaPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "src",
    "server",
    "db",
    "sqlite",
    "schema.sql",
  );

  return readFileSync(schemaPath, "utf8");
}

function runSqliteMigrations(db: Database.Database): void {
  const vectorColumns = db
    .prepare("PRAGMA table_info(vector_indexes)")
    .all() as Array<{ name: string }>;

  if (!vectorColumns.some((column) => column.name === "vector_json")) {
    db.prepare("ALTER TABLE vector_indexes ADD COLUMN vector_json TEXT").run();
  }

  const vectorTableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vector_indexes'")
    .get() as { sql?: string } | undefined;

  if (vectorTableSql?.sql && !vectorTableSql.sql.includes("'sqlite-faiss'")) {
    db.exec(`
      ALTER TABLE vector_indexes RENAME TO vector_indexes_legacy;

      CREATE TABLE vector_indexes (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        vector_store TEXT NOT NULL CHECK (vector_store IN ('sqlite-faiss', 'chroma', 'faiss')),
        embedding_model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents (id),
        FOREIGN KEY (chunk_id) REFERENCES document_chunks (id)
      );

      INSERT INTO vector_indexes (
        id, document_id, chunk_id, vector_store, embedding_model, dimensions, vector_json, created_at
      )
      SELECT
        id, document_id, chunk_id, vector_store, embedding_model, dimensions, vector_json, created_at
      FROM vector_indexes_legacy
      WHERE vector_store IN ('chroma', 'faiss');

      DROP TABLE vector_indexes_legacy;
    `);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vector_indexes_chunk_store_model
      ON vector_indexes (chunk_id, vector_store, embedding_model);
  `);
}
