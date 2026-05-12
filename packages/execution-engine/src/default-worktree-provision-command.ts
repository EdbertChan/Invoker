/**
 * Default shell command for provisioning a worktree after clone (local or remote).
 * Kept in one place so WorktreeExecutor, SshExecutor, and docs stay aligned.
 * Honors .node-version before pnpm so managed worktrees do not inherit an
 * incompatible ambient Node from the Invoker host process.
 */
export const DEFAULT_WORKTREE_PROVISION_COMMAND =
  'if [ ! -f package.json ] && [ ! -f pnpm-workspace.yaml ]; then \
    echo "[provision] No package.json/pnpm-workspace.yaml found; skipping pnpm install"; \
    exit 0; \
  fi; \
  invoker_prepend_node_version_bin() { \
    if [ ! -f .node-version ]; then return 0; fi; \
    INVOKER_NODE_VERSION="$(tr -d "[:space:]" < .node-version)"; \
    if [ -z "$INVOKER_NODE_VERSION" ]; then return 0; fi; \
    INVOKER_NODE_VERSION="${INVOKER_NODE_VERSION#v}"; \
    INVOKER_NODE_MAJOR="${INVOKER_NODE_VERSION%%.*}"; \
    INVOKER_NODE_BIN_DIRS="${INVOKER_NODE_VERSION_BIN_DIRS:-/opt/homebrew/opt/node@$INVOKER_NODE_MAJOR/bin:/usr/local/opt/node@$INVOKER_NODE_MAJOR/bin}"; \
    INVOKER_OLD_IFS="$IFS"; IFS=:; \
    for INVOKER_NODE_BIN in $INVOKER_NODE_BIN_DIRS; do \
      IFS="$INVOKER_OLD_IFS"; \
      if [ -x "$INVOKER_NODE_BIN/node" ]; then \
        export PATH="$INVOKER_NODE_BIN:$PATH"; \
        echo "[provision] using Node from .node-version: $($INVOKER_NODE_BIN/node --version)"; \
        return 0; \
      fi; \
    done; \
    IFS="$INVOKER_OLD_IFS"; \
  }; \
  invoker_prepend_node_version_bin; \
  if ! NODE_ENV=development pnpm install --frozen-lockfile; then \
    echo "[provision] frozen-lockfile install failed; refreshing lockfile and retrying"; \
    NODE_ENV=development pnpm install --lockfile-only; \
    NODE_ENV=development pnpm install --frozen-lockfile; \
  fi && ( \
  [ ! -f pnpm-workspace.yaml ] || ( \
    echo "[provision] pnpm config production (debug): $(pnpm config get production 2>/dev/null || echo unknown)" && \
    ( [ -f packages/transport/node_modules/@types/node/package.json ] && echo "[provision] @types/node linked under packages/transport" ) || \
    ( FOUND_TYPES=0 && for f in node_modules/.pnpm/@types+node@*/node_modules/@types/node/package.json; do [ -f "$f" ] && FOUND_TYPES=1 && echo "[provision] @types/node in pnpm store: $f" && break; done && [ "$FOUND_TYPES" -eq 1 ] ) || \
    ( \
      echo "[provision] Missing @types/node after install (not under transport or pnpm virtual store)" && \
      echo "[provision] transport @types dir:" && \
      ls -la packages/transport/node_modules/@types 2>/dev/null || true && \
      echo "[provision] root @types dir:" && \
      ls -la node_modules/@types 2>/dev/null || true && \
      echo "[provision] pnpm -C packages/transport list @types/node (debug):" && \
      pnpm -C packages/transport list --depth 0 @types/node 2>/dev/null || true && \
      echo "[provision] pnpm store candidates under node_modules/.pnpm (debug):" && \
      ls -la node_modules/.pnpm/@types+node* 2>/dev/null || true && \
      exit 1 \
    ) \
  ) \
  )';
