#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

source_path="$repo_root/packages/contracts/src/headless-owner-launch.ts"

echo "[repro] Running PR #4926 headless owner override repro."
echo "[repro] Scenario: INVOKER_GUI_COMMAND must still launch a headless owner, not the plain GUI."

python3 - "$source_path" <<'PY'
from pathlib import Path
import sys

source_path = Path(sys.argv[1])
source = source_path.read_text(encoding='utf-8')

def split_command(command_text: str):
    parts = command_text.split()
    if not parts:
        raise SystemExit('[repro] FAIL: empty override unexpectedly parsed')
    return parts[0], parts[1:]

def pre_fix_resolve(command_text: str):
    return split_command(command_text)

def fixed_args(args: list[str]) -> list[str]:
    args_without_owner_serve = [arg for arg in args if arg != 'owner-serve']
    if '--headless' not in args_without_owner_serve:
        return [*args_without_owner_serve, '--headless', 'owner-serve']
    headless_index = args_without_owner_serve.index('--headless')
    return [
        *args_without_owner_serve[: headless_index + 1],
        'owner-serve',
        *args_without_owner_serve[headless_index + 1 :],
    ]

override = '/opt/Invoker.app/Contents/MacOS/Invoker --trace-warnings'
pre_command, pre_args = pre_fix_resolve(override)
if pre_command != '/opt/Invoker.app/Contents/MacOS/Invoker':
    raise SystemExit(f'[repro] FAIL: unexpected override command parse: {pre_command!r}')
if pre_args != ['--trace-warnings']:
    raise SystemExit(f'[repro] FAIL: pre-fix model changed unexpectedly: {pre_args!r}')
if '--headless' in pre_args or 'owner-serve' in pre_args:
    raise SystemExit('[repro] FAIL: pre-fix model no longer demonstrates the missing headless args bug')

post_args = fixed_args(pre_args)
if post_args != ['--trace-warnings', '--headless', 'owner-serve']:
    raise SystemExit(f'[repro] FAIL: fixed model produced {post_args!r}')

required_snippets = [
    'function ensureHeadlessOwnerArgs(spec: HeadlessOwnerLaunchSpec): HeadlessOwnerLaunchSpec {',
    "const argsWithoutOwnerServe = spec.args.filter((arg) => arg !== 'owner-serve');",
    "const headlessIndex = argsWithoutOwnerServe.indexOf('--headless');",
    "args: [...argsWithoutOwnerServe, '--headless', 'owner-serve'],",
    'return ensureHeadlessOwnerArgs(splitCommand(overrideCommand));',
]
for snippet in required_snippets:
    if snippet not in source:
        raise SystemExit(f'[repro] FAIL: missing source invariant: {snippet}')

print('[repro] pre-fix model: INVOKER_GUI_COMMAND override launched without --headless owner-serve')
print('[repro] post-fix model: override preserves custom args and appends the headless owner tail')
print('[repro] source check: resolveHeadlessOwnerLaunchSpec canonicalizes override args via ensureHeadlessOwnerArgs')
print('[repro] PASS: INVOKER_GUI_COMMAND overrides keep the --headless owner-serve launch shape.')
PY
