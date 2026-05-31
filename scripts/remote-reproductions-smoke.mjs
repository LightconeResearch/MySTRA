#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const REPRODUCTIONS_REMOTE =
  process.env.REPRODUCTIONS_REMOTE ?? 'git@github.com:LightconeResearch/Reproductions.git';
const REPRODUCTIONS_REPO =
  process.env.REPRODUCTIONS_REPO ??
  '/Users/cd280747/Documents/projects/LightconeResearch/Reproductions';
const REPRODUCTIONS_REF = process.env.REPRODUCTIONS_REF ?? 'origin/main';
const REPRODUCTIONS_PROJECT_PATH =
  process.env.REPRODUCTIONS_PROJECT_PATH ?? 'DESI/dr1/iii-bao-galaxy-quasars';
const MYSTRA_REF = process.env.MYSTRA_BASE_REF ?? 'origin/main';
const UNIVERSE = process.env.MYSTRA_SMOKE_UNIVERSE ?? 'baseline';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'mystra-remote-reproductions-'));
const currentPort = await freePort();
const baselinePort = await freePort(currentPort + 1);
const cleanup = [];

try {
  const reproductionsRoot = await materializeRemoteReproductions();
  const projectDir = path.join(reproductionsRoot, REPRODUCTIONS_PROJECT_PATH);
  const baselineRoot = await materializeMystraBaseline();

  console.log(`[smoke] Reproductions: ${REPRODUCTIONS_REF} (${await gitHead(reproductionsRoot)})`);
  console.log(`[smoke] Project: ${REPRODUCTIONS_PROJECT_PATH}`);
  console.log(`[smoke] MySTRA baseline: ${MYSTRA_REF} (${await gitHead(baselineRoot)})`);

  run('npm', ['ci', '--ignore-scripts'], { cwd: baselineRoot });
  run('npm', ['run', 'build'], { cwd: baselineRoot });

  const [current, baseline] = await Promise.all([
    snapshotMySTRA(repoRoot, projectDir, currentPort),
    snapshotMySTRA(baselineRoot, projectDir, baselinePort),
  ]);

  const diffs = compareSnapshots(current, baseline);
  if (diffs.length > 0) {
    console.error(`[smoke] Remote Reproductions parity failed (${diffs.length} difference(s)):`);
    for (const diff of diffs.slice(0, 25)) console.error(`  - ${diff}`);
    if (diffs.length > 25) console.error(`  - ... ${diffs.length - 25} more`);
    process.exitCode = 1;
  } else {
    console.log(
      `[smoke] Remote Reproductions parity clean: ${current.slugs.length} page(s), ${current.astraSlugs.length} ASTRA sidecar(s).`,
    );
  }
} finally {
  for (const fn of cleanup.reverse()) await fn();
  await rm(tempRoot, { recursive: true, force: true });
}

async function materializeRemoteReproductions() {
  const destination = path.join(tempRoot, 'reproductions-main');
  if (REPRODUCTIONS_REPO && existsSync(path.join(REPRODUCTIONS_REPO, '.git'))) {
    run('git', ['-C', REPRODUCTIONS_REPO, 'fetch', 'origin', 'main', '--prune'], { cwd: repoRoot });
    run('git', ['-C', REPRODUCTIONS_REPO, 'worktree', 'add', '--detach', destination, REPRODUCTIONS_REF], {
      cwd: repoRoot,
    });
    cleanup.push(async () => {
      run('git', ['-C', REPRODUCTIONS_REPO, 'worktree', 'remove', '--force', destination], {
        cwd: repoRoot,
        allowFailure: true,
      });
    });
    return destination;
  }

  run('git', ['clone', '--depth=1', '--branch', 'main', REPRODUCTIONS_REMOTE, destination], {
    cwd: repoRoot,
  });
  return destination;
}

async function materializeMystraBaseline() {
  const destination = path.join(tempRoot, 'mystra-main');
  run('git', ['fetch', 'origin', 'main', '--prune'], { cwd: repoRoot });
  run('git', ['worktree', 'add', '--detach', destination, MYSTRA_REF], { cwd: repoRoot });
  cleanup.push(async () => {
    run('git', ['worktree', 'remove', '--force', destination], {
      cwd: repoRoot,
      allowFailure: true,
    });
  });
  return destination;
}

async function snapshotMySTRA(mystraRoot, projectDir, port) {
  const child = spawn(
    'node',
    ['dist/cli.js', projectDir, '--no-theme', '--content-port', String(port), '--universe', UNIVERSE],
    { cwd: mystraRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  cleanup.push(async () => stop(child));

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  try {
    await waitFor(`http://127.0.0.1:${port}/config.json`, child, () => logs);
    const config = await json(`http://127.0.0.1:${port}/config.json`);
    const slugs = ['index', ...(config.projects?.[0]?.pages ?? []).map((page) => page.slug)].sort();
    const content = new Map();
    const astra = new Map();

    for (const slug of slugs) {
      content.set(slug, normalizeContent(await json(url(port, 'content', slug))));
      astra.set(slug, await json(url(port, 'astra', slug)));
    }

    return { slugs, astraSlugs: [...astra.keys()], content, astra };
  } finally {
    await stop(child);
  }
}

function compareSnapshots(current, baseline) {
  const diffs = [];
  compareList('page slugs', current.slugs, baseline.slugs, diffs);
  compareList('ASTRA sidecar slugs', current.astraSlugs, baseline.astraSlugs, diffs);

  for (const slug of current.slugs) {
    const actual = stableStringify(current.content.get(slug));
    const expected = stableStringify(baseline.content.get(slug));
    if (actual !== expected) diffs.push(`/content/${slug}.json differs`);
  }

  for (const slug of current.astraSlugs) {
    const actual = stableStringify(current.astra.get(slug));
    const expected = stableStringify(baseline.astra.get(slug));
    if (actual !== expected) diffs.push(`/astra/${slug}.json differs`);
  }

  return diffs;
}

function normalizeContent(content) {
  return {
    ...content,
    // DOI resolution is asynchronous and may depend on local cache/network timing.
    // The parity guard is for MySTRA's ASTRA/MyST render contract.
    references: {},
  };
}

function compareList(label, actual, expected, diffs) {
  const a = stableStringify(actual);
  const b = stableStringify(expected);
  if (a !== b) diffs.push(`${label} differ: current=${a}, baseline=${b}`);
}

async function waitFor(target, child, logs) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (child.exitCode !== null) {
      throw new Error(`MySTRA server exited early.\n${logs()}`);
    }
    try {
      const res = await fetch(target);
      if (res.ok) return;
    } catch {
      // Server not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${target}.\n${logs()}`);
}

async function json(target) {
  const res = await fetch(target);
  if (!res.ok) throw new Error(`${target} returned ${res.status}`);
  return res.json();
}

function url(port, route, slug) {
  return `http://127.0.0.1:${port}/${route}/${slug}.json`;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    stdio: options.allowFailure ? 'ignore' : 'inherit',
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${result.status}`);
  }
  return result;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function freePort(start = 4300) {
  const net = await import('node:net');
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(net, port)) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

function canListen(net, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function gitHead(repo) {
  const out = await output('git', ['-C', repo, 'rev-parse', '--short=12', 'HEAD']);
  return out.trim();
}

async function output(cmd, args) {
  const chunks = [];
  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout.on('data', (chunk) => chunks.push(chunk));
  const code = await new Promise((resolve) => proc.once('exit', resolve));
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with status ${code}`);
  return Buffer.concat(chunks).toString('utf8');
}

function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, sortKeys(val)]),
  );
}
