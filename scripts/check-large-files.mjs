#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(argv) {
  let configPath = path.join(repoRoot, 'scripts', 'large-file-guardrail.config.json');

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return { configPath: path.resolve(repoRoot, configPath) };
}

function printUsage() {
  console.log('Usage: node scripts/check-large-files.mjs [--config <path>]');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function lineCount(text) {
  if (text.length === 0) {
    return 0;
  }

  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      count += 1;
    }
  }

  return count;
}

function compileRegexList(patterns = []) {
  return patterns.map((pattern) => new RegExp(pattern));
}

function matchesAnyRegex(value, regexes) {
  return regexes.some((regex) => regex.test(value));
}

function matchesAnyPrefix(value, prefixes = []) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function matchesAnySubstring(value, substrings = []) {
  return substrings.some((substring) => value.includes(substring));
}

function shouldIgnorePath(relativePath, config, target) {
  if (config.ignoreFiles?.includes(path.posix.basename(relativePath))) {
    return true;
  }

  if (matchesAnyPrefix(relativePath, config.ignorePathPrefixes)) {
    return true;
  }

  if (matchesAnySubstring(relativePath, config.ignorePathSubstrings)) {
    return true;
  }

  if (matchesAnyRegex(relativePath, config.ignorePathRegexesCompiled)) {
    return true;
  }

  if (matchesAnyPrefix(relativePath, target.ignorePathPrefixes)) {
    return true;
  }

  if (matchesAnySubstring(relativePath, target.ignorePathSubstrings)) {
    return true;
  }

  if (matchesAnyRegex(relativePath, target.ignorePathRegexesCompiled)) {
    return true;
  }

  return false;
}

function collectFiles(config, target) {
  const targetRoot = path.resolve(repoRoot, target.root);
  if (!fs.existsSync(targetRoot)) {
    throw new Error(`target root does not exist: ${target.root}`);
  }

  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = normalizeRelativePath(path.relative(repoRoot, fullPath));

      if (entry.isDirectory()) {
        if (config.ignoreDirectories?.includes(entry.name)) {
          continue;
        }

        if (target.ignoreDirectories?.includes(entry.name)) {
          continue;
        }

        if (shouldIgnorePath(`${relativePath}/`, config, target)) {
          continue;
        }

        walk(fullPath);
        continue;
      }

      if (!target.extensions.includes(path.extname(entry.name))) {
        continue;
      }

      if (shouldIgnorePath(relativePath, config, target)) {
        continue;
      }

      if (target.includePathSubstrings?.length > 0 && !matchesAnySubstring(relativePath, target.includePathSubstrings)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  walk(targetRoot);
  return files;
}

function main() {
  const { configPath } = parseArgs(process.argv.slice(2));
  const config = readJson(configPath);

  config.ignorePathPrefixes ??= [];
  config.ignorePathSubstrings ??= [];
  config.ignorePathRegexesCompiled = compileRegexList(config.ignorePathRegexes);

  const seen = new Set();
  const files = [];

  for (const target of config.targets) {
    target.ignorePathPrefixes ??= [];
    target.ignorePathSubstrings ??= [];
    target.ignoreDirectories ??= [];
    target.ignorePathRegexesCompiled = compileRegexList(target.ignorePathRegexes);

    for (const file of collectFiles(config, target)) {
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      files.push(file);
    }
  }

  files.sort();

  const violations = [];

  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath);
    const actualLines = lineCount(fs.readFileSync(absolutePath, 'utf8'));
    const maxLines = config.overrides?.[relativePath] ?? config.defaultMaxLines;

    if (actualLines > maxLines) {
      violations.push({ relativePath, actualLines, maxLines });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-file-guard] ${violations.length} file(s) exceed line limits`);
    for (const violation of violations) {
      console.error(
        `[large-file-guard] ${violation.relativePath}: ${violation.actualLines} lines exceeds max ${violation.maxLines}`,
      );
    }
    process.exit(1);
  }

  console.log(`[large-file-guard] scanned ${files.length} production source file(s); all within limits`);
}

main();
