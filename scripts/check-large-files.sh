#!/usr/bin/env bash
# Fails when production source files exceed the repository line-count budget.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAX_LINES="${INVOKER_MAX_PROD_SOURCE_LINES:-5200}"

usage() {
  cat <<'EOF'
Usage: scripts/check-large-files.sh [--root PATH] [--max-lines N]

Scans production sources under packages/*/src and fails when any file exceeds
the configured line threshold. Generated/build artifacts, lockfiles, tests, and
type declaration files are ignored.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      if [[ $# -lt 2 ]]; then
        echo "[large-files] --root requires a path" >&2
        exit 2
      fi
      ROOT="$2"
      shift 2
      ;;
    --max-lines)
      if [[ $# -lt 2 ]]; then
        echo "[large-files] --max-lines requires a number" >&2
        exit 2
      fi
      MAX_LINES="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[large-files] unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$MAX_LINES" =~ ^[1-9][0-9]*$ ]]; then
  echo "[large-files] max line threshold must be a positive integer: $MAX_LINES" >&2
  exit 2
fi

if [[ ! -d "$ROOT" ]]; then
  echo "[large-files] root does not exist: $ROOT" >&2
  exit 2
fi

cd "$ROOT"

violations=()
scanned=0

while IFS= read -r -d '' file; do
  lines="$(awk 'END { print NR }' "$file")"
  scanned=$((scanned + 1))

  if (( lines > MAX_LINES )); then
    violations+=("${lines} ${file}")
  fi
done < <(
  find packages -path 'packages/*/src/*' -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) \
    ! -path '*/__tests__/*' \
    ! -path '*/__fixtures__/*' \
    ! -path '*/fixtures/*' \
    ! -path '*/generated/*' \
    ! -path '*/__generated__/*' \
    ! -path '*/dist/*' \
    ! -path '*/build/*' \
    ! -path '*/coverage/*' \
    ! -path '*/node_modules/*' \
    ! -name '*.test.*' \
    ! -name '*.spec.*' \
    ! -name '*.d.ts' \
    ! -name '*generated*' \
    ! -name 'pnpm-lock.yaml' \
    ! -name 'package-lock.json' \
    ! -name 'yarn.lock' \
    -print0 | LC_ALL=C sort -z
)

if (( ${#violations[@]} > 0 )); then
  echo "[large-files] Production source files exceed ${MAX_LINES} lines:" >&2
  printf '  %s\n' "${violations[@]}" >&2
  exit 1
fi

echo "[large-files] checked ${scanned} production source files; max allowed lines=${MAX_LINES}"
