#!/usr/bin/env node
/**
 * Thin CLI wrapper around HeadlessTransport.
 *
 * Keeps: CLI parsing, JSON / JSONL output, EPIPE handling.
 * Delegates: all transport policy to HeadlessTransport (IPC delegation,
 *            standalone bootstrap, read-only fallback).
 *
 * Requires the compiled app bundle (`pnpm -C packages/app build`).
 */
const path = require('node:path');

const APP_DIST = path.resolve(__dirname, '..', 'packages', 'app', 'dist', 'headless-client.js');

// ---------------------------------------------------------------------------
// EPIPE handling (keep stdout/stderr from crashing when piped to head, etc.)
// ---------------------------------------------------------------------------

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error && error.code === 'EPIPE') {
      process.exit(0);
    }
    throw error;
  });
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function usage() {
  console.error(
    'Usage:\n' +
    '  node scripts/headless-ipc.js exec [--no-track] [--wait-for-approval] [--timeout-ms N] -- <headless args...>\n' +
    '  node scripts/headless-ipc.js batch-exec [--no-track] [--wait-for-approval] [--timeout-ms N] [--parallel N] < commands.jsonl',
  );
}

function parseCli(argv) {
  const mode = argv[0];
  if (mode !== 'exec' && mode !== 'batch-exec') {
    usage();
    process.exit(2);
  }

  let noTrack = false;
  let waitForApproval = false;
  let parallel = 1;
  let timeoutMs = 30_000;
  const args = [];
  let afterDoubleDash = false;

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (afterDoubleDash) {
      args.push(token);
      continue;
    }
    if (token === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (token === '--no-track') {
      noTrack = true;
      continue;
    }
    if (token === '--wait-for-approval') {
      waitForApproval = true;
      continue;
    }
    if (token === '--parallel') {
      parallel = Number.parseInt(argv[i + 1] ?? '', 10);
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      timeoutMs = Number.parseInt(argv[i + 1] ?? '', 10);
      i += 1;
      continue;
    }
    args.push(token);
  }

  return { mode, noTrack, waitForApproval, parallel, timeoutMs, args };
}

async function readStdinLines() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Transport setup
// ---------------------------------------------------------------------------

function createTransport() {
  // Lazy-require the compiled app bundle so the script fails fast with a
  // clear message when the build is missing.
  let appExports;
  try {
    appExports = require(APP_DIST);
  } catch (err) {
    throw new Error(
      `Failed to load compiled app bundle at ${APP_DIST}. ` +
      'Run "pnpm -C packages/app build" first.\n' +
      `  (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const { IpcBus, HeadlessTransport, ensureStandaloneOwnerViaBootstrap } = appExports;

  let bus = new IpcBus(undefined, { allowServe: false });

  const refreshMessageBus = async () => {
    bus.disconnect();
    bus = new IpcBus(undefined, { allowServe: false });
    await bus.ready();
    return bus;
  };

  const transport = new HeadlessTransport({
    messageBus: bus,
    refreshMessageBus,
    ensureStandaloneOwner: ensureStandaloneOwnerViaBootstrap
      ? (currentBus) => ensureStandaloneOwnerViaBootstrap(currentBus ?? bus)
      : undefined,
  });

  const readyPromise = bus.ready();

  return { transport, bus, readyPromise };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseCli(process.argv.slice(2));
  const { transport, bus, readyPromise } = createTransport();

  try {
    await readyPromise;

    const execOptions = {
      noTrack: options.noTrack,
      waitForApproval: options.waitForApproval,
      timeoutMs: options.timeoutMs,
    };

    if (options.mode === 'exec') {
      if (options.args.length === 0) {
        throw new Error('Missing headless args for exec');
      }
      const result = await transport.exec(options.args, execOptions);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }

    // batch-exec: read JSONL from stdin, dispatch with parallelism.
    const lines = await readStdinLines();
    const items = lines.map((line) => {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) {
        return { args: parsed };
      }
      if (!parsed || !Array.isArray(parsed.args)) {
        throw new Error(`Invalid batch item: ${line}`);
      }
      return parsed;
    });

    let nextIndex = 0;
    const parallel = Math.max(1, Number.isFinite(options.parallel) ? options.parallel : 1);

    async function worker() {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        const item = items[index];
        const result = await transport.exec(item.args, execOptions);
        // Merge extra properties from the input item (e.g. label, workflowId)
        // into the result so existing callers see them in the output.
        const output = { ...item, ...result };
        process.stdout.write(`${JSON.stringify(output)}\n`);
      }
    }

    await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, () => worker()));
  } finally {
    bus.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
