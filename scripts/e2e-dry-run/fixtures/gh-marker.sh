#!/usr/bin/env bash
# Stub gh CLI for e2e-dry-run: no network, instant responses.
# Handles the exact calls made by GitHubMergeGateProvider:
#   - gh pr list --head ... --base ... --state open --json url,number --limit 1
#   - gh api repos/{owner}/{repo}/pulls --method POST -f base=... -f head=... -f title=... -f body=...
#   - gh api repos/{owner}/{repo}/pulls/N --method PATCH ...
#   - gh pr view N --json state,reviewDecision,url
# All calls logged to $INVOKER_E2E_MARKER_ROOT/gh-calls.log for verification.
# When the call is a pulls POST/PATCH carrying a `-f body=...` field, the
# decoded body content is also written to $INVOKER_E2E_MARKER_ROOT/gh-pr-body.txt
# so cases can assert the request body shape (e.g. canonical PR sections),
# not just call presence.
set -eu

ROOT="${INVOKER_E2E_MARKER_ROOT:-}"
LOGFILE="${ROOT:+$ROOT/gh-calls.log}"
PR_BODY_FILE="${ROOT:+$ROOT/gh-pr-body.txt}"

log_call() {
  if [ -n "$LOGFILE" ]; then
    mkdir -p "$(dirname "$LOGFILE")"
    echo "$*" >>"$LOGFILE"
  fi
}

record_pr_body() {
  # Walk remaining args looking for `-f body=<content>` (or `--field body=...`).
  # Writes only the body content (after `body=`). Last occurrence wins.
  local body=""
  local found=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f|--field)
        if [ "$#" -ge 2 ]; then
          case "$2" in
            body=*)
              body="${2#body=}"
              found=1
              ;;
          esac
          shift 2
        else
          shift
        fi
        ;;
      *)
        shift
        ;;
    esac
  done
  if [ "$found" -eq 1 ] && [ -n "$PR_BODY_FILE" ]; then
    mkdir -p "$(dirname "$PR_BODY_FILE")"
    printf '%s' "$body" >"$PR_BODY_FILE"
  fi
}

# Log the full invocation. Snapshot original argv before it is consumed by
# the parsers below so record_pr_body can inspect every -f/--field pair.
ORIGINAL_ARGS=("$@")
log_call "gh $*"

# Parse the subcommand
SUBCMD="${1:-}"
shift || true

case "$SUBCMD" in
  pr)
    ACTION="${1:-}"
    shift || true
    case "$ACTION" in
      list)
        # gh pr list --head ... --base ... --state open --json url,number --limit 1
        # Return empty array (no existing PR)
        echo '[]'
        ;;
      view)
        # gh pr view N --json state,reviewDecision,url
        PR_NUM="${1:-99}"
        echo '{"state":"OPEN","reviewDecision":null,"url":"https://github.com/test/repo/pull/'"$PR_NUM"'"}'
        ;;
      *)
        echo "{}" ;;
    esac
    ;;
  api)
    # gh api repos/{owner}/{repo}/pulls --method POST ...
    # or gh api repos/{owner}/{repo}/pulls/N --method PATCH ...
    ENDPOINT="${1:-}"
    shift || true
    # Capture the PR body for any pulls POST/PATCH so cases can inspect
    # the request payload, not just the fact that gh was invoked.
    case "$ENDPOINT" in
      *pulls|*pulls/*)
        record_pr_body "${ORIGINAL_ARGS[@]}"
        ;;
    esac
    if echo "$ENDPOINT" | grep -qE 'pulls$'; then
      # POST — create new PR
      echo '{"html_url":"https://github.com/test/repo/pull/99","number":99}'
    else
      # PATCH — update existing PR
      echo '{}'
    fi
    ;;
  *)
    echo "{}" ;;
esac

exit 0
