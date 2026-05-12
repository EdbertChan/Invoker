#!/usr/bin/env node
// Deterministic guardrail: scans production source files and fails when
// any non-baselined file exceeds the configured line threshold. Baseline
// pins ratchet hotspots: pinned files may shrink but not grow.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const DEFAULT_ROOTS = ["packages", "scripts"];
const DEFAULT_THRESHOLD = 1500;
const BASELINE_PATH = join(SCRIPT_DIR, "large-files-allowlist.json");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "__tests__",
  "__fixtures__",
  "fixtures",
  ".git",
  ".turbo",
  ".cache",
]);

const SKIP_FILENAME_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /\.d\.ts$/,
  /\.min\.js$/,
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
];

function parseArgs(argv) {
  const args = { roots: null, threshold: null, json: false, updateBaseline: false };
  for (const raw of argv) {
    if (raw === "--json") args.json = true;
    else if (raw === "--update-baseline") args.updateBaseline = true;
    else if (raw.startsWith("--threshold=")) {
      args.threshold = Number.parseInt(raw.slice("--threshold=".length), 10);
    } else if (raw.startsWith("--roots=")) {
      args.roots = raw.slice("--roots=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (raw === "--help" || raw === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${raw}`);
      printHelp();
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/check-large-files.mjs [options]",
      "",
      "Options:",
      "  --threshold=<N>     Override the line threshold (default 1500).",
      "  --roots=<paths>     Comma-separated roots to scan (default packages,scripts).",
      "  --json              Emit machine-readable JSON report.",
      "  --update-baseline   Rewrite the baseline file with current line counts.",
      "",
      "Env overrides:",
      "  INVOKER_LARGE_FILE_THRESHOLD   Same as --threshold.",
      "  INVOKER_LARGE_FILE_ROOTS       Comma-separated, same as --roots.",
      "",
    ].join("\n"),
  );
}

function shouldSkipDir(name) {
  return SKIP_DIR_NAMES.has(name) || name.startsWith(".");
}

function shouldSkipFile(name) {
  if (!SOURCE_EXTENSIONS.has(extOf(name))) return true;
  return SKIP_FILENAME_PATTERNS.some((re) => re.test(name));
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}

function walk(root, out) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue;
      out.push(full);
    }
  }
}

function countLines(absPath) {
  const buf = readFileSync(absPath);
  if (buf.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) lines++;
  }
  // Count trailing line that does not end with a newline.
  if (buf[buf.length - 1] !== 0x0a) lines++;
  return lines;
}

function loadBaseline() {
  try {
    const raw = readFileSync(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("baseline JSON must be an object");
    }
    const files = parsed.files && typeof parsed.files === "object" ? parsed.files : {};
    const threshold =
      Number.isFinite(parsed.threshold) && parsed.threshold > 0 ? parsed.threshold : null;
    return { files, threshold, raw: parsed };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { files: {}, threshold: null, raw: { threshold: null, files: {} } };
    }
    throw err;
  }
}

function toRepoRelative(absPath) {
  return relative(REPO_ROOT, absPath).split(sep).join("/");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envThreshold = process.env.INVOKER_LARGE_FILE_THRESHOLD
    ? Number.parseInt(process.env.INVOKER_LARGE_FILE_THRESHOLD, 10)
    : null;
  const envRoots = process.env.INVOKER_LARGE_FILE_ROOTS
    ? process.env.INVOKER_LARGE_FILE_ROOTS.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const baseline = loadBaseline();
  const threshold =
    args.threshold ?? envThreshold ?? baseline.threshold ?? DEFAULT_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold <= 0) {
    console.error(`Invalid threshold: ${threshold}`);
    process.exit(2);
  }

  const roots = args.roots ?? envRoots ?? DEFAULT_ROOTS;
  const files = [];
  for (const rel of roots) {
    walk(resolve(REPO_ROOT, rel), files);
  }
  files.sort();

  const measured = files.map((abs) => ({
    path: toRepoRelative(abs),
    lines: countLines(abs),
  }));

  if (args.updateBaseline) {
    const pinned = {};
    for (const { path, lines } of measured) {
      if (lines > threshold) pinned[path] = lines;
    }
    const next = { threshold, files: pinned };
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `Updated baseline at ${toRepoRelative(BASELINE_PATH)}: ${Object.keys(pinned).length} pinned files, threshold=${threshold}.`,
    );
    process.exit(0);
  }

  const violations = [];
  for (const { path, lines } of measured) {
    const cap = baseline.files[path];
    if (typeof cap === "number") {
      if (lines > cap) {
        violations.push({
          path,
          lines,
          limit: cap,
          kind: "baseline",
          message: `exceeds baseline cap (${lines} > ${cap})`,
        });
      }
    } else if (lines > threshold) {
      violations.push({
        path,
        lines,
        limit: threshold,
        kind: "threshold",
        message: `exceeds threshold (${lines} > ${threshold})`,
      });
    }
  }

  const baselineMissing = Object.keys(baseline.files).filter(
    (p) => !measured.some((m) => m.path === p),
  );

  const report = {
    threshold,
    roots,
    scanned: measured.length,
    pinned: Object.keys(baseline.files).length,
    violations,
    staleBaselineEntries: baselineMissing,
    largestFreeFile: measured
      .filter(({ path }) => !(path in baseline.files))
      .reduce((max, cur) => (max && max.lines >= cur.lines ? max : cur), null),
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    console.log(
      `check-large-files: scanned ${report.scanned} files in [${roots.join(", ")}], threshold=${threshold}, pinned=${report.pinned}.`,
    );
    if (report.largestFreeFile) {
      console.log(
        `  largest non-baselined: ${report.largestFreeFile.path} (${report.largestFreeFile.lines} lines)`,
      );
    }
    if (baselineMissing.length > 0) {
      console.error("Baseline entries reference files that no longer exist:");
      for (const p of baselineMissing) console.error(`  - ${p}`);
      console.error("Re-run with --update-baseline after confirming the files were removed intentionally.");
    }
    if (violations.length > 0) {
      console.error(`Large-file guardrail FAILED with ${violations.length} violation(s):`);
      for (const v of violations) {
        console.error(`  - ${v.path}: ${v.message}`);
      }
    } else {
      console.log("Large-file guardrail PASSED.");
    }
  }

  if (violations.length > 0 || baselineMissing.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
