This directory is a transfer export of the workflows that existed in the local Invoker DB on 2026-05-10.

Contents:
- One YAML plan per workflow, named from the workflow `feature_branch` slug.
- `manifest.json`, which maps each exported file back to the saved backup file it came from.

How it was recovered:
- The source of truth was the local Invoker SQLite DB at export time.
- For each workflow in the DB, the exporter matched the workflow `name` against saved plan backups in `.invoker/plans/`.
- When multiple backups had the same workflow name, the exporter chose the one nearest to the workflow `created_at` timestamp.

Verification:
- 34 workflows in the DB.
- 34 exported YAML files.
- Every selected backup timestamp was at or before the workflow creation time.

Intended use:
- Move this directory to another machine.
- Re-submit the needed plans from these YAMLs on the destination Invoker instance.
