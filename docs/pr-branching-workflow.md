# PR Branching Workflow (Parent Remote)

Use this workflow when your repo has both `origin` (your writable fork) and a read-only parent remote. The parent remote defaults to `upstream`, but any remote name can be used.

## Rules

- Never push working branches to the parent remote.
- Push branches to `origin` only.
- Create PR branches from `<parentRemote>/<baseBranch>`, not `origin/<baseBranch>`.
- Open PRs targeting the parent repository base branch.

## Clean PR Flow

1. Create branch from parent remote:

```bash
bash scripts/create-clean-pr-branch.sh --parent-remote upstream --base-ref master pr/<name> [commit ...]
```

2. Push to fork:

```bash
git push -u origin pr/<name>
```

3. Start from the canonical body template and validate it:

```bash
cp scripts/pr-body-template.md /tmp/my-pr.md
$EDITOR /tmp/my-pr.md
node scripts/validate-pr-body.mjs --body-file /tmp/my-pr.md
```

4. Create/update PR:

```bash
node scripts/create-pr.mjs --title "<title>" --base master --body-file /tmp/my-pr.md
```

By default, tools in this workflow use `upstream` as the parent remote. Override it when your team uses a different remote name.

## Invoker Review Stacks

Invoker-on-Invoker review publication now has two distinct lanes:

- `publish-review-stack <workflowId>` creates a synthetic `review-base/<root-workflow-id>` branch and publishes a Mergify review stack on top of that fork-point base. This keeps stale workflow histories reviewable even when `upstream/master` has moved on.
- `publish-landing-stack <workflowId>` rebuilds the same workflow chain on current `upstream/master` and publishes the mergeable landing stack that Mergify can queue against `master`.

Why this split exists:

- GitHub review diffs are computed from actual branch ancestry, not intent.
- A stale workflow branch can contain the right logical change but still show a noisy PR against current `master`.
- The synthetic review base preserves the old fork point for human review.
- The landing stack reapplies the reviewed delta onto fresh `upstream/master` for mergeability.
