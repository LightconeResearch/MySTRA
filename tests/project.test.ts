import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validate } from '@astra-spec/sdk/node';

import {
  clearResolvedProjectCache,
  formatProjectError,
  loadResolvedProject,
} from '../src/project.js';
import { readMetric } from '../src/transform/parse-metric.js';
import { parseTableData } from '../src/transform/parse-table-data.js';

let root: string;

function analysis(label = 'Cache One'): string {
  return `spec_version: "0.1.0"
label: ${label}
outputs:
  result:
    type: data
    format: txt
    recipe: {command: 'echo artifact > {output}'}
universes:
  baseline: {}
`;
}

function git(...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=MySTRA tests',
      '-c',
      'user.email=tests@astra.invalid',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim();
}

beforeEach(async () => {
  clearResolvedProjectCache();
  root = await mkdtemp(join(tmpdir(), 'mystra-project-'));
  await writeFile(join(root, 'astra.yaml'), analysis());
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'fixture');
});

afterEach(async () => {
  clearResolvedProjectCache();
  await rm(root, { recursive: true, force: true });
});

describe('loadResolvedProject', () => {
  it('returns the shared reports and resources keyed by result identity', async () => {
    await mkdir(join(root, 'results'), { recursive: true });
    await writeFile(join(root, 'results', 'result.txt'), 'artifact');
    const project = await loadResolvedProject(root);
    expect(project.root).toBe(root);
    expect(project.analysis.analyses[0]?.label).toBe('Cache One');
    expect(project.index.elementByRef.get('outputs.result')).toMatchObject({
      collection: 'outputs',
      element: { ref: 'outputs.result' },
    });
    const resource = project.resources.get('result')!;
    expect(await readFile(resource.path, 'utf8')).toBe('artifact');
    expect(resource.cacheToken).toBe(
      createHash('sha256').update('artifact').digest('hex'),
    );
    // Actual bytes remain publishable even without a provenance record.
    expect(project.status.statuses['result']).toMatchObject({
      state: 'missing',
    });
  });

  it('shares concurrent work but refreshes a later document pass', async () => {
    const first = loadResolvedProject(root);
    const second = loadResolvedProject(root);
    expect(second).toBe(first);
    const resolved = await first;
    const refreshed = await loadResolvedProject(root);
    expect(refreshed).not.toBe(resolved);
    expect(refreshed.analysis).toEqual(resolved.analysis);
  });

  it('refreshes authored content even when size and mtime are unchanged', async () => {
    const source = join(root, 'astra.yaml');
    const before = await stat(source);
    const first = await loadResolvedProject(root);
    await writeFile(source, analysis('Cache Two'));
    await utimes(source, before.atime, before.mtime);
    const second = await loadResolvedProject(root);
    expect(second).not.toBe(first);
    expect(second.analysis.analyses[0]?.label).toBe('Cache Two');
  });

  it('observes Git HEAD changes without an authored-file edit', async () => {
    const first = await loadResolvedProject(root);
    git('commit', '--allow-empty', '-qm', 'new HEAD');
    const second = await loadResolvedProject(root);
    expect(second.analysis.head).not.toBe(first.analysis.head);
    expect(second.status.head).toBe(second.analysis.head);
  });

  it('retains all universes and observes newly authored selections', async () => {
    await writeFile(
      join(root, 'astra.yaml'),
      analysis().replace('  baseline: {}', '  later: {}'),
    );
    const first = await loadResolvedProject(root);
    expect(
      first.analysis.analyses[0]?.universes.map((item) => item.ref),
    ).toEqual(['universes.later']);
    await writeFile(
      join(root, 'astra.yaml'),
      analysis().replace('  baseline: {}', '  later: {}\n  earlier: {}'),
    );
    const second = await loadResolvedProject(root);
    expect(
      second.analysis.analyses[0]?.universes.map((item) => item.ref),
    ).toEqual(['universes.later', 'universes.earlier']);
  });

  it('observes newly produced and changed artifact bytes', async () => {
    expect((await loadResolvedProject(root)).resources.size).toBe(0);
    await mkdir(join(root, 'results'), { recursive: true });
    await writeFile(join(root, 'results', 'result.txt'), 'first');
    const first = await loadResolvedProject(root);
    await writeFile(join(root, 'results', 'result.txt'), 'other');
    const second = await loadResolvedProject(root);
    expect(first.resources.get('result')?.cacheToken).not.toBe(
      second.resources.get('result')?.cacheToken,
    );
    expect(await readFile(second.resources.get('result')!.path, 'utf8')).toBe(
      'other',
    );
  });

  it('uses a later available result place when the first alias has no bytes', async () => {
    await mkdir(join(root, 'stage'));
    await writeFile(join(root, 'stage', 'astra.yaml'), `spec_version: "0.1.0"
label: Shared stage
decisions:
  method:
    options: {a: {}}
  other:
    options: {a: {}}
outputs:
  fit:
    type: metric
    format: json
    decisions: [method, other]
    recipe: {command: 'fit {decisions.method} {decisions.other} > {output}'}
`);
    await writeFile(join(root, 'astra.yaml'), `spec_version: "0.1.0"
analyses:
  stage: {path: stage}
  alias: {path: stage}
outputs:
  comparison:
    type: report
    format: txt
    inputs: [stage.fit, alias.fit]
    recipe: {command: 'cat {inputs} > {output}'}
universes:
  baseline:
    decisions: {stage.method: a, alias.other: a}
`);
    git('add', '.');
    git('commit', '-qm', 'aliases');
    const validation = await validate(root);
    expect(validation.valid, JSON.stringify(validation.diagnostics)).toBe(true);
    const initial = await loadResolvedProject(root);
    const output = initial.analysis.analyses.find((item) => item.label === 'Shared stage')!.outputs[0]!;
    const result = initial.analysis.results.find((item) => item.output === output.ref)!;
    expect(result.places).toHaveLength(2);
    const available = join(root, result.places[1]!.file_path);
    await mkdir(dirname(available), {recursive: true});
    await writeFile(available, '{"value":7}');
    const project = await loadResolvedProject(root);
    expect(await readFile(project.resources.get(result.id)!.path, 'utf8')).toBe('{"value":7}');
  });

  it('reads a pinned sub-analysis from its commit instead of the dirty worktree', async () => {
    await mkdir(join(root, 'stage', 'results'), { recursive: true });
    await writeFile(
      join(root, 'stage', 'astra.yaml'),
      analysis('Historical stage'),
    );
    await writeFile(
      join(root, 'stage', 'results', 'result.txt'),
      'historical bytes',
    );
    git('add', '.');
    git('commit', '-qm', 'stage');
    const commit = git('rev-parse', 'HEAD');
    await writeFile(
      join(root, 'astra.yaml'),
      `spec_version: "0.1.0"\nanalyses:\n  stage: {path: stage, commit: ${commit}}\nfindings:\n  historical:\n    claim: Historical output.\n    evidence: [{artifact: stage.result}]\n`,
    );
    await writeFile(
      join(root, 'stage', 'results', 'result.txt'),
      'wrong current bytes',
    );
    const project = await loadResolvedProject(root);
    const output = project.analysis.analyses.find(
      (item) => item.label === 'Historical stage',
    )!.outputs[0]!;
    const result = project.analysis.results.find(
      (item) => item.output === output.ref,
    )!;
    expect(result.commit?.id).toBe(commit);
    expect(await readFile(project.resources.get(result.id)!.path, 'utf8')).toBe(
      'historical bytes',
    );
  });
});

describe('formatProjectError', () => {
  it('formats validation diagnostics with their source pointers and codes', async () => {
    await writeFile(
      join(root, 'astra.yaml'),
      analysis().replace('type: data', 'type: impossible'),
    );
    let failure: unknown;
    try {
      await loadResolvedProject(root);
    } catch (error) {
      failure = error;
    }
    const lines = formatProjectError(failure);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^astra\.yaml:\/outputs\/result\/type.* \[/),
      ]),
    );
  });

  it('keeps unexpected failures useful', () => {
    expect(formatProjectError(new Error('boom'))).toEqual(['boom']);
    expect(formatProjectError('boom')).toEqual(['boom']);
  });
});

describe('readMetric', () => {
  it('normalizes scalar, tuple, and object JSON metrics', async () => {
    const path = join(root, 'metric.json');

    await writeFile(path, '2.5');
    expect(readMetric(path)).toEqual({ value: 2.5 });

    await writeFile(path, '[2.5, 0.1]');
    expect(readMetric(path)).toEqual({ value: 2.5, uncertainty: 0.1 });

    await writeFile(
      path,
      '{"value":2.5,"error":0.2,"unit":"Mpc","label":"Fit"}',
    );
    expect(readMetric(path)).toEqual({
      value: 2.5,
      uncertainty: 0.2,
      unit: 'Mpc',
      label: 'Fit',
    });
  });

  it('returns undefined for unsupported files and values', async () => {
    const json = join(root, 'metric.json');
    const text = join(root, 'metric.txt');
    await writeFile(json, '{"value":true}');
    await writeFile(text, '2.5');

    expect(readMetric(json)).toBeUndefined();
    expect(readMetric(text)).toBeUndefined();
    expect(readMetric(join(root, 'missing.json'))).toBeUndefined();
  });
});

describe('parseTableData', () => {
  it('retains every row and numeric precision for value lookup', async () => {
    const csv = join(root, 'large.csv');
    const rows = Array.from(
      { length: 250 },
      (_, index) => `${index},${index + 0.123456789}`,
    );
    await writeFile(csv, `id,value\n${rows.join('\n')}\n`);

    const parsed = parseTableData(csv)!;
    expect(parsed.rows).toHaveLength(250);
    expect(parsed.rows[249]).toEqual(['249', '249.123456789']);
  });

  it('rejects JSON arrays that are not entirely records', async () => {
    const json = join(root, 'invalid-table.json');
    await writeFile(json, '[null, {"value": 1}]');
    expect(parseTableData(json)).toBeNull();
  });
});
