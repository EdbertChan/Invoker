#!/usr/bin/env bash
# Dummy Claude CLI for e2e-dry-run: no network, instant exit 0.
# Invoked like: claude --session-id <uuid> ... (prompt) or via INVOKER_CLAUDE_FIX_COMMAND (fix).
set -eu
SESSION_ID=""
# Preserve the full original argv (joined with NUL-safe spaces) for prompt
# inspection. The make-pr authoring path passes its prompt via `-p <prompt>`,
# so we need the original args to detect that flow before the parsing loop
# below consumes them with `shift`.
ALL_ARGS_STR="$*"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session-id)
      if [ "$#" -lt 2 ]; then
        echo "claude-marker: --session-id requires a value" >&2
        exit 2
      fi
      SESSION_ID="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

ROOT="${INVOKER_E2E_MARKER_ROOT:-}"
if [ -n "$ROOT" ] && [ -n "$SESSION_ID" ]; then
  mkdir -p "$ROOT"
  # Portable timestamp (no %N on macOS bash)
  ts="$(date +%s)"
  echo ok >"$ROOT/${SESSION_ID}-${ts}-$$.marker"
fi

# external_review publication invokes claude with a prompt that references the
# bundled `invoker-make-pr` skill. When we detect that prompt, emit a
# canonical PR body so `validateCanonicalPrBody` accepts it and the
# external_review path proceeds end-to-end. (Other claude invocations — fix
# flows, generic prompts — keep the previous silent-stub behaviour.)
if printf '%s' "$ALL_ARGS_STR" | grep -q 'invoker-make-pr'; then
  cat <<'PR_BODY'
## Summary
End-to-end dry-run coverage for the canonical GitHub PR publication path.
This body is emitted by the e2e claude stub to exercise the
`invoker-make-pr` authoring contract (## Summary / ## Test Plan / ## Revert
Plan) without depending on a real Claude CLI.

## Test Plan
- `bash scripts/e2e-dry-run/cases/case-4.2-github-pr.sh`

## Revert Plan
- Safe to revert via `git revert <sha>`. No data migration required.
PR_BODY
  exit 0
fi

# Auto-resolve merge conflicts (no-op when none exist).
if git rev-parse --git-dir >/dev/null 2>&1; then
  UNMERGED=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
  if [ -n "$UNMERGED" ]; then
    git checkout --theirs . 2>/dev/null || true
    git add -A 2>/dev/null || true
    git -c user.name='e2e-stub' -c user.email='stub@test' \
      commit --no-edit 2>/dev/null || true
  fi
fi

exit 0
