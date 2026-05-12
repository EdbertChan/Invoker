#!/usr/bin/env bash
# test-inv-63-brief-thresholds.sh
#
# Re-derive every experiment verdict from docs/context/inv-63/experiment-brief.md
# against the current working tree. The brief records the PROVEN verdict for
# the single-orchestrator design under INV-63; this test fails if any
# threshold regresses (e.g. an advertised run_check is removed, the cursor
# mirror desynchronises, an out-of-band exit code is introduced, or the
# scripts inventory shrinks below the documented step map).
#
# This test is intentionally pure shell (grep, diff, readlink, ls). It does
# not require pnpm or any Node version — see the Reproducibility Note at the
# end of docs/context/inv-63/experiment-brief.md.
#
# Usage: bash skills/plan-to-invoker/scripts/test-inv-63-brief-thresholds.sh
# Exit codes: 0 = all thresholds met, 1 = at least one threshold failed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BRIEF="$REPO_ROOT/docs/context/inv-63/experiment-brief.md"
SKILL_MD="$REPO_ROOT/skills/plan-to-invoker/SKILL.md"
DOCTOR="$REPO_ROOT/skills/plan-to-invoker/scripts/skill-doctor.sh"
CURSOR_LINK="$REPO_ROOT/.cursor/skills/plan-to-invoker"
CURSOR_SKILL_MD="$REPO_ROOT/.cursor/skills/plan-to-invoker/SKILL.md"
SCRIPTS_DIR="$REPO_ROOT/skills/plan-to-invoker/scripts"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$BRIEF" ]]      || fail "expected experiment brief at $BRIEF"
[[ -f "$SKILL_MD" ]]   || fail "expected skill policy at $SKILL_MD"
[[ -f "$DOCTOR" ]]     || fail "expected orchestrator at $DOCTOR"

# EXP-1 — orchestrator fans out every advertised sub-check (threshold ≥ 8)
exp1=$(grep -cE "^[[:space:]]*run_check\b" "$DOCTOR")
[[ "$exp1" -ge 8 ]] || fail "EXP-1: run_check count $exp1 < 8 — orchestrator has been gutted"

# EXP-2 — SKILL.md advertises the single-command surface ≥ 2 times
exp2=$(grep -cE "^bash skills/plan-to-invoker/scripts/skill-doctor\.sh" "$SKILL_MD")
[[ "$exp2" -ge 2 ]] || fail "EXP-2: SKILL.md advertises skill-doctor only $exp2 times; threshold is 2"

# EXP-3 — cursor mirror is byte-identical to the canonical skill
[[ -e "$CURSOR_SKILL_MD" ]] || fail "EXP-3: cursor mirror SKILL.md missing at $CURSOR_SKILL_MD"
diff -q "$SKILL_MD" "$CURSOR_SKILL_MD" >/dev/null \
  || fail "EXP-3: cursor mirror differs from canonical SKILL.md"

# EXP-4 — mirror is a symlink, not a copy
[[ -L "$CURSOR_LINK" ]] || fail "EXP-4: $CURSOR_LINK is not a symlink (run scripts/setup-agent-skills.sh)"
target="$(readlink "$CURSOR_LINK")"
[[ "$target" == "../../skills/plan-to-invoker" ]] \
  || fail "EXP-4: $CURSOR_LINK -> $target, expected '../../skills/plan-to-invoker'"

# EXP-5 — orchestrator exit-code contract is finite ({0,1,2}, threshold ≥ 4)
exp5=$(grep -cE "^\s*exit [012]\b" "$DOCTOR")
[[ "$exp5" -ge 4 ]] || fail "EXP-5: documented exit count $exp5 < 4"
oob=$( { grep -nE "^\s*exit [0-9]+" "$DOCTOR" || true; } | { grep -vE "exit [012]\b" || true; } | wc -l | tr -d ' ')
[[ "$oob" -eq 0 ]] || fail "EXP-5: $oob exit statements use codes outside {0,1,2}"

# EXP-6 — control: scripts inventory ≥ 10 (no advertised script was removed)
exp6=$(ls "$SCRIPTS_DIR"/*.sh | wc -l | tr -d ' ')
[[ "$exp6" -ge 10 ]] || fail "EXP-6: scripts/*.sh count $exp6 < 10 — surface has shrunk"

# Aggregate verdict per the brief's Decision rule: PROVEN.
echo "OK: INV-63 brief thresholds — EXP-1=$exp1, EXP-2=$exp2, EXP-3=match, EXP-4=symlink, EXP-5=$exp5 (0 OOB), EXP-6=$exp6 (verdict: PROVEN)"
