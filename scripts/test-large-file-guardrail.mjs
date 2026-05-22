#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repoRoot, "scripts", "check-large-files.mjs");
const tempRoot = await mkdtemp(path.join(tmpdir(), "invoker-large-file-guardrail-"));

function runChecker(args) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

try {
  const sourceDir = path.join(tempRoot, "packages", "sample", "src");
  await mkdir(sourceDir, { recursive: true });

  const oversizedFile = path.join(sourceDir, "oversized.ts");
  await writeFile(
    oversizedFile,
    Array.from({ length: 6 }, (_, index) => `export const x${index} = ${index};`).join("\n"),
  );

  const oversized = runChecker(["--root", tempRoot, "--threshold", "5"]);
  if (oversized.status === 0) {
    throw new Error("Expected oversized production source to fail the guardrail");
  }
  if (!oversized.stderr.includes("packages/sample/src/oversized.ts")) {
    throw new Error(`Expected failure output to name oversized.ts, got:\n${oversized.stderr}`);
  }

  const lockfile = path.join(sourceDir, "pnpm-lock.yaml");
  await writeFile(
    lockfile,
    Array.from({ length: 20 }, (_, index) => `line${index}: value`).join("\n"),
  );

  const passing = runChecker(["--root", tempRoot, "--threshold", "6"]);
  if (passing.status !== 0) {
    throw new Error(`Expected threshold-sized source and ignored lockfile to pass, got:\n${passing.stderr}`);
  }

  console.log("Large-file guardrail proof passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
