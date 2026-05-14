#!/usr/bin/env bash

sqlite_query_noheader() {
  local db_path="$1"
  local sql="$2"

  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 -noheader "$db_path" "$sql"
    return
  fi

  DB_PATH="$db_path" SQL_QUERY="$sql" python3 - <<'PY'
import os
import sqlite3
import sys

db_path = os.environ["DB_PATH"]
sql = os.environ["SQL_QUERY"]

try:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
except sqlite3.Error as exc:
    print(f"sqlite fallback open failed: {exc}", file=sys.stderr)
    sys.exit(1)

try:
    cursor = conn.execute(sql)
    for row in cursor:
        values = ["" if value is None else str(value) for value in row]
        print("\t".join(values))
finally:
    conn.close()
PY
}
