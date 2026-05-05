#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');

const {
  exec: transportExec,
  resolveTransportMode,
  IpcBus,
} = require('../packages/app/dist/headless-transport.js');

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error && error.code === 'EPIPE') {
      process.exit(0);
    }
    throw error;
  });
}

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

function runLocal(args) {
  const appDir = path.resolve(__dirname, '..', 'packages', 'app');
  const electronBin = path.resolve(appDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const mainJs = path.resolve(appDir, 'dist', 'main.js');
  const electronArgs = [
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    mainJs,
    '--headless',
    ...args,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, electronArgs, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: {
        ...process.env,
        LIBGL_ALWAYS_SOFTWARE: process.platform === 'linux' ? '1' : process.env.LIBGL_ALWAYS_SOFTWARE,
      },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`headless electron exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function createDeps() {
  const mode = resolveTransportMode();
  let bus = null;

  if (mode === 'shared-owner') {
    bus = new IpcBus(undefined, { allowServe: false });
  }

  return {
    messageBus: bus,
    runLocal,
    refreshMessageBus: bus
      ? async () => {
          bus.disconnect();
          bus = new IpcBus(undefined, { allowServe: false });
          await bus.ready();
          return bus;
        }
      : undefined,
    disconnect() {
      if (bus) bus.disconnect();
    },
  };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const deps = createDeps();

  try {
    if (deps.messageBus && deps.messageBus.ready) {
      await deps.messageBus.ready();
    }

    const execOptions = {
      waitForApproval: options.waitForApproval,
      noTrack: options.noTrack,
      timeoutMs: options.timeoutMs,
    };

    if (options.mode === 'exec') {
      if (options.args.length === 0) {
        throw new Error('Missing headless args for exec');
      }
      const result = await transportExec(options.args, deps, execOptions);
      process.stdout.write(`${JSON.stringify({ args: options.args, ok: result.ok, response: result })}\n`);
      return;
    }

    // batch-exec mode
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

    const parallel = Math.max(1, Number.isFinite(options.parallel) ? options.parallel : 1);
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        const item = items[index];
        try {
          const result = await transportExec(item.args, deps, execOptions);
          process.stdout.write(`${JSON.stringify({ ...item, ok: result.ok, response: result })}\n`);
        } catch (error) {
          process.stdout.write(`${JSON.stringify({
            ...item,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, () => worker()));
  } finally {
    deps.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
