#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/repro/repro-ssh-worktree-collision-variants.sh <case|all>

Cases:
  path-already-exists
  branch-owner-drift
  branch-already-exists
  checked-out-elsewhere
  all

This script creates fresh temp repos and reproduces the exact Git/worktree
collision families discussed in the SSH workspace analysis.
EOF
}

case_name="${1:-all}"
root=""

cleanup() {
  if [[ -n "${root}" && -d "${root}" ]]; then
    rm -rf "${root}"
  fi
}
trap cleanup EXIT

require_git() {
  command -v git >/dev/null 2>&1 || {
    echo "git is required" >&2
    exit 1
  }
}

init_repo() {
  root="$(mktemp -d)"
  repo="${root}/repo"
  mkdir -p "${repo}"
  git init -b master "${repo}" >/dev/null
  git -C "${repo}" config user.email "test@example.com"
  git -C "${repo}" config user.name "Test User"
  printf 'seed\n' > "${repo}/README.md"
  git -C "${repo}" add README.md
  git -C "${repo}" commit -m "seed" >/dev/null
}

run_expect_failure() {
  local label="$1"
  local expected="$2"
  shift 2

  echo
  echo "=== ${label} ==="
  echo "Repo root: ${repo}"
  echo "Expected stderr fragment: ${expected}"
  echo

  set +e
  output="$("$@" 2>&1)"
  code=$?
  set -e

  printf '%s\n' "${output}"
  echo "__EXIT=${code}"

  if [[ "${code}" -eq 0 ]]; then
    echo "FAIL: expected command to fail" >&2
    exit 1
  fi
  if [[ "${output}" != *"${expected}"* ]]; then
    echo "FAIL: expected output to contain: ${expected}" >&2
    exit 1
  fi
}

case_path_already_exists() {
  init_repo

  local branch="experiment/wf-1775874004544-6/capture-visual-proof-60e55823"
  local wt="${root}/experiment-wf-1775874004544-6-capture-visual-proof-60e55823"

  mkdir -p "${wt}"
  printf 'stale remote worktree dir\n' > "${wt}/KEEP.txt"

  cat <<EOF
Root cause:
  A stale worktree directory already exists at the target path.

Architecture:
  SshExecutor.start()
    -> setupTaskBranch()
    -> git worktree add <path> -B <branch> <base>
    -> fatal: '<path>' already exists

This mirrors the current task family:
  wf-1775874004544-6/capture-visual-proof
EOF

  run_expect_failure \
    "path-already-exists" \
    "already exists" \
    git -C "${repo}" worktree add -B "${branch}" "${wt}" master
}

case_branch_owner_drift() {
  init_repo

  local old_path="${root}/experiment-wf-1-test-execution-engine-bc7a0b71"
  local new_path="${root}/experiment-wf-1-test-execution-engine-b68b146f"
  local old_branch="experiment/wf-1/test-execution-engine-bc7a0b71"
  local new_branch="experiment/wf-1/test-execution-engine-b68b146f"

  git -C "${repo}" worktree add "${old_path}" -b "${old_branch}" master >/dev/null
  git -C "${old_path}" branch -m "${old_branch}" "${new_branch}"

  cat <<EOF
Root cause:
  The new branch name still points at an older worktree path.

Architecture:
  stale branch/worktree identity drift
    -> branch now owned by old worktree path
    -> new launch tries canonical path for same branch
    -> Git says branch is already used by another worktree
EOF

  run_expect_failure \
    "branch-owner-drift" \
    "already used by worktree at" \
    git -C "${repo}" worktree add "${new_path}" "${new_branch}"
}

case_branch_already_exists() {
  init_repo

  git -C "${repo}" branch feature/demo master

  cat <<'EOF'
Root cause:
  A branch-creation path tries to create a branch name that already exists.

Architecture:
  git checkout -b feature/demo
    -> branch name already present
EOF

  run_expect_failure \
    "branch-already-exists" \
    "already exists" \
    git -C "${repo}" checkout -b feature/demo
}

case_checked_out_elsewhere() {
  init_repo

  local wt="${root}/wt"
  git -C "${repo}" worktree add "${wt}" -b feature/demo master >/dev/null

  cat <<EOF
Root cause:
  Cleanup tries to delete a branch that is still checked out by another worktree.

Architecture:
  cleanup branch -D
    -> branch is active in worktree ${wt}
    -> Git refuses deletion
EOF

  run_expect_failure \
    "checked-out-elsewhere" \
    "used by worktree at" \
    git -C "${repo}" branch -D feature/demo
}

run_case() {
  local name="$1"
  cleanup
  case "${name}" in
    path-already-exists) case_path_already_exists ;;
    branch-owner-drift) case_branch_owner_drift ;;
    branch-already-exists) case_branch_already_exists ;;
    checked-out-elsewhere) case_checked_out_elsewhere ;;
    *)
      echo "Unknown case: ${name}" >&2
      usage
      exit 1
      ;;
  esac
}

main() {
  require_git

  case "${case_name}" in
    all)
      run_case path-already-exists
      run_case branch-owner-drift
      run_case branch-already-exists
      run_case checked-out-elsewhere
      ;;
    path-already-exists|branch-owner-drift|branch-already-exists|checked-out-elsewhere)
      run_case "${case_name}"
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
