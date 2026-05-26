CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash TEXT,
  country TEXT,
  user_agent TEXT,
  tool TEXT NOT NULL,
  portal TEXT,
  keyword TEXT,
  args_json TEXT NOT NULL,
  status INTEGER NOT NULL,
  is_error INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_tool ON request_logs(tool);
CREATE INDEX IF NOT EXISTS idx_request_logs_portal ON request_logs(portal);
