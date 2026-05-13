# Remote SSH Targets

Execute Invoker tasks on remote machines by routing them through an execution pool.

## Overview

Plans route work with `poolId`. The matching pool in `~/.invoker/config.json`
contains members. A member is either:

- `local` for the local worktree runner
- an SSH machine ID declared under `remoteTargets`

Each SSH machine keeps its host, user, key, workspace, heartbeat, and concurrency
settings under `remoteTargets`.

## Configuration

```json
{
  "remoteTargets": {
    "staging-server": {
      "host": "192.168.1.100",
      "user": "deploy",
      "sshKeyPath": "/home/user/.ssh/id_staging",
      "managedWorkspaces": true,
      "remoteInvokerHome": "~/.invoker",
      "provisionCommand": "pnpm install --frozen-lockfile",
      "remoteHeartbeatIntervalSeconds": 30,
      "maxConcurrentTasks": 2
    },
    "staging-server-b": {
      "host": "192.168.1.101",
      "user": "deploy",
      "sshKeyPath": "/home/user/.ssh/id_staging_b",
      "port": 22,
      "managedWorkspaces": true
    }
  },
  "executionPools": {
    "ssh-light": {
      "members": [
        { "type": "ssh", "id": "staging-server" },
        { "type": "ssh", "id": "staging-server-b" }
      ]
    },
    "mixed": {
      "members": [
        { "type": "worktree", "id": "local" },
        { "type": "ssh", "id": "staging-server" }
      ]
    }
  }
}
```

If you want to use a repo-specific config file, launch Invoker with
`INVOKER_REPO_CONFIG_PATH=/path/to/config.json`.

## Remote Target Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | yes | Remote host IP or hostname |
| `user` | string | yes | SSH username |
| `sshKeyPath` | string | yes | Absolute path to SSH private key file |
| `port` | number | no | SSH port, default `22` |
| `managedWorkspaces` | boolean | no | When true, Invoker manages per-task worktrees on the remote host |
| `remoteInvokerHome` | string | no | Base directory for managed remote workspaces, default `~/.invoker` |
| `provisionCommand` | string | no | Command run after worktree creation in managed mode |
| `remoteHeartbeatIntervalSeconds` | number | no | SSH workload heartbeat interval in seconds |
| `maxConcurrentTasks` | number | no | Per-machine concurrency cap |

## Usage In Plans

```yaml
name: "Deploy to staging"
repoUrl: git@github.com:your-org/your-repo.git
onFinish: none
baseBranch: master
tasks:
  - id: health-check
    description: "Verify staging server is reachable"
    command: "echo 'OK'; uptime; df -h"
    poolId: ssh-light
    dependencies: []

  - id: run-migrations
    description: "Run database migrations on staging"
    command: "cd /opt/app && ./migrate.sh"
    poolId: ssh-light
    dependencies:
      - health-check
```

Tasks without `poolId` run locally. To allow either local or remote execution,
route the task to a pool containing both `local` and SSH machine IDs.

## How It Works

1. The plan parser reads `poolId` from YAML.
2. The runner looks up `executionPools[poolId]`.
3. If the selected member is `local`, the task runs in the local worktree.
4. If the selected member is any other string, it must match a key in `remoteTargets` and the task runs over SSH with that machine's config.

## Security Notes

- SSH keys must never be committed to the repository.
- `sshKeyPath` is a local filesystem path, not key content.
- SSH uses batch key-based authentication and must not fall back to password prompts.
