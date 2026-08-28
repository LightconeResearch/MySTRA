import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearResolvedProjectCache,
  formatProjectError,
  loadResolvedProject,
} from '../src/project.js';
import { readMetric } from '../src/transform/parse-metric.js';
import { parseTableData } from '../src/transform/parse-table-data.js';

let root: string;

function analysis(name = 'Cache One'): string {
  return `version: "0.0.14"
name: ${name}
inputs: []
outputs:
  - id: result
    type: data
    format: txt
`;
}

beforeEach(async () => {
  clearResolvedProjectCache();
  root = await mkdtemp(join(tmpdir(), 'mystra-project-'));
  await writeFile(join(root, 'astra.yaml'), analysis());
});

afterEach(async () => {
  clearResolvedProjectCache();
  await rm(root, { recursive: true, force: true });
});

describe('loadResolvedProject', () => {
  it('returns the SDK bundle and its canonical lookup maps', async () => {
    await mkdir(join(root, 'results', 'default'), { recursive: true });
    await writeFile(join(root, 'results', 'default', 'result.txt'), 'artifact');

    const project = await loadResolvedProject(root);

    expect(project.root).toBe(root);
    expect(project.bundle.document.analysis.name).toBe('Cache One');
    expect(project.index.recordByPath.get('outputs.result')).toMatchObject({
      id: 'result',
      kind: 'output',
    });
    expect(project.bindingsByOutputPath.get('outputs.result')?.path)
      .toBe('results/default/result.txt');
  });

  it('shares concurrent work and reuses an unchanged result', async () => {
    const first = loadResolvedProject(root);
    const second = loadResolvedProject(root);
    expect(second).toBe(first);

    const resolved = await first;
    expect(await loadResolvedProject(root)).toBe(resolved);
  });

  it('tracks readText content even when size and mtime are unchanged', async () => {
    const source = join(root, 'astra.yaml');
    const before = await stat(source);
    const first = await loadResolvedProject(root);

    // The replacement is deliberately the same length, and the timestamp is
    // restored, so metadata-only invalidation would miss it.
    await writeFile(source, analysis('Cache Two'));
    await utimes(source, before.atime, before.mtime);

    const second = await loadResolvedProject(root);
    expect(second).not.toBe(first);
    expect(second.bundle.document.analysis.name).toBe('Cache Two');
  });

  it('tracks directory listings used for implicit universe selection', async () => {
    await mkdir(join(root, 'universes'));
    await writeFile(join(root, 'universes', 'later.yaml'), 'id: later\n');
    const first = await loadResolvedProject(root);
    expect(first.bundle.document.universe.universeId).toBe('later');

    await writeFile(join(root, 'universes', 'earlier.yaml'), 'id: earlier\n');
    const second = await loadResolvedProject(root);
    expect(second.bundle.document.universe.universeId).toBe('earlier');
  });

  it('tracks missing stat results so newly produced artifacts appear', async () => {
    const first = await loadResolvedProject(root);
    expect(first.bundle.bindings).toEqual([]);

    await mkdir(join(root, 'results', 'default'), { recursive: true });
    await writeFile(join(root, 'results', 'default', 'result.txt'), 'artifact');

    const second = await loadResolvedProject(root);
    expect(second.bindingsByOutputPath.get('outputs.result')).toBeDefined();
  });
});

describe('formatProjectError', () => {
  it('formats authored validation issues with their source locations and codes', async () => {
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
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^astra\.yaml:outputs\.0\.type \[SCHEMA_ENUM\]/),
    ]));
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

    await writeFile(path, '{"value":2.5,"error":0.2,"unit":"Mpc","label":"Fit"}');
    expect(readMetric(path)).toEqual({ value: 2.5, error: 0.2, unit: 'Mpc', label: 'Fit' });
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
    const rows = Array.from({ length: 250 }, (_, index) => `${index},${index + 0.123456789}`);
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
