CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  workspace_id TEXT,
  title TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'workspace')),
  model TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_project_id
  ON conversations (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  request_id TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  parser_version TEXT,
  chunker_version TEXT,
  embedding_model TEXT,
  parse_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE INDEX IF NOT EXISTS idx_documents_project_id
  ON documents (project_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_project_hash
  ON documents (project_id, sha256);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  section_title TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_chunks_position
  ON document_chunks (document_id, chunk_index);

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (document_id) REFERENCES documents (id)
);

CREATE TABLE IF NOT EXISTS vector_indexes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  vector_store TEXT NOT NULL CHECK (vector_store IN ('chroma', 'faiss')),
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents (id),
  FOREIGN KEY (chunk_id) REFERENCES document_chunks (id)
);

CREATE INDEX IF NOT EXISTS idx_vector_indexes_document_id
  ON vector_indexes (document_id, vector_store);

CREATE TABLE IF NOT EXISTS generated_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('roadmap', 'critical_analysis')),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_message_id TEXT,
  source_document_ids_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id),
  FOREIGN KEY (source_message_id) REFERENCES messages (id)
);
