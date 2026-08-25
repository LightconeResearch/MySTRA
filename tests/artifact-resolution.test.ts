/**
 * Where an output's artifact lives.
 *
 * An output is one *file*, and its path is derived from the spec rather than
 * chosen by the recipe: `<home>/results/<universe>/<inline scope…>/<id>.<format>`,
 * with the run manifest as a `.<id>.manifest.json` sidecar beside it. That is
 * lightcone-cli's rule (`engine/assets.py`, `engine/plan.py`), and these tests
 * pin MySTRA to it — including the two things it is easy to get wrong: inline
 * sub-analyses nest under a scope directory, and a re-export has no file of
 * its own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { VFile } from 'vfile';

import { descendPlacement, descendTo, resolveArtifact, type Placement } from '../src/loader.js';
import { resolveOutput } from '../src/transform/resolve-output.js';

/** Temp dirs created per test, torn down afterwards. */
const tempDirs: string[] = [];

/** A project holding `files` (paths relative to the project root). */
function makeProject(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mystra-artifact-'));
  tempDirs.push(dir);
  for (const f of files) {
    const path = join(dir, ...f.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }
  return dir;
}

/** The chosen artifact as a project-relative posix path, for readable assertions. */
function chose(root: string, absolute: string | undefined): string | undefined {
  return absolute && relative(root, absolute).split(/[\\/]/).join('/');
}

const at = (home: string, scope: string[] = [], universeId = 'baseline'): Placement =>
  ({ home, universeId, scope });

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('resolveArtifact — the path is derived, not searched', () => {
  it('names the file from the output id and its declared format', () => {
    const root = makeProject(['results/baseline/constraints.csv']);
    expect(chose(root, resolveArtifact(at(root), 'constraints', { format: 'csv' })))
      .toBe('results/baseline/constraints.csv');
  });

  it('handles a dotted format', () => {
    const root = makeProject(['results/baseline/bundle.tar.gz']);
    expect(chose(root, resolveArtifact(at(root), 'bundle', { format: 'tar.gz' })))
      .toBe('results/baseline/bundle.tar.gz');
  });

  it('nests an inline sub-analysis under its scope directory', () => {
    const root = makeProject(['results/baseline/sub/nested/fit.json']);
    expect(chose(root, resolveArtifact(at(root, ['sub', 'nested']), 'fit', { format: 'json' })))
      .toBe('results/baseline/sub/nested/fit.json');
  });

  it('files results under the placement universe, not the project one', () => {
    const root = makeProject(['results/alt/fit.json']);
    expect(chose(root, resolveArtifact(at(root, [], 'alt'), 'fit', { format: 'json' })))
      .toBe('results/alt/fit.json');
  });

  it('reports nothing produced when the derived path is not there', () => {
    // A declared format with no file is the ordinary mid-analysis state, not an
    // error — the value role surfaces it as "not produced yet".
    const root = makeProject(['results/baseline/other.csv']);
    expect(resolveArtifact(at(root), 'constraints', { format: 'csv' })).toBeUndefined();
  });

  it('never mistakes the manifest sidecar for the artifact', () => {
    const root = makeProject([
      'results/baseline/.constraints.manifest.json',
      'results/baseline/constraints.csv',
    ]);
    // Derived: the sidecar is not even a candidate.
    expect(chose(root, resolveArtifact(at(root), 'constraints', { format: 'csv' })))
      .toBe('results/baseline/constraints.csv');
    // Searched: dotfiles are skipped, so it is still not a candidate.
    const vf = new VFile({ path: 'index.md' });
    expect(chose(root, resolveArtifact(at(root), 'constraints', { vfile: vf })))
      .toBe('results/baseline/constraints.csv');
    expect(vf.messages).toEqual([]);
  });
});

describe('resolveArtifact — the transitional search, for an output with no format', () => {
  it('matches <id>.<ext> in the results directory', () => {
    const root = makeProject(['results/baseline/constraints.csv', 'results/baseline/other.csv']);
    const vf = new VFile({ path: 'index.md' });
    expect(chose(root, resolveArtifact(at(root), 'constraints', { vfile: vf })))
      .toBe('results/baseline/constraints.csv');
    expect(vf.messages).toEqual([]);
  });

  it('matches on the id plus a dot, so a longer id is not a candidate', () => {
    const root = makeProject(['results/baseline/fit_extra.csv', 'results/baseline/fit.csv']);
    const vf = new VFile({ path: 'index.md' });
    expect(chose(root, resolveArtifact(at(root), 'fit', { vfile: vf })))
      .toBe('results/baseline/fit.csv');
    expect(vf.messages).toEqual([]);
  });

  it('warns when more than one file could be the artifact', () => {
    const root = makeProject(['results/baseline/fit.csv', 'results/baseline/fit.json']);
    const vf = new VFile({ path: 'index.md' });
    expect(chose(root, resolveArtifact(at(root), 'fit', { vfile: vf })))
      .toBe('results/baseline/fit.csv');
    const message = String(vf.messages[0]?.message ?? '');
    expect(message).toContain('fit.csv, fit.json');
    expect(message).toContain('format:');
  });

  it('warns once per output id, not once per reference', () => {
    const root = makeProject(['results/baseline/fit.csv', 'results/baseline/fit.json']);
    const vf = new VFile({ path: 'index.md' });
    const warned = new Set<string>();
    for (let i = 0; i < 3; i++) resolveArtifact(at(root), 'fit', { vfile: vf, warned });
    expect(vf.messages).toHaveLength(1);
  });

  it('returns undefined when the results directory does not exist', () => {
    const root = makeProject(['astra.yaml']);
    expect(resolveArtifact(at(root), 'fit')).toBeUndefined();
  });
});

describe('descendPlacement', () => {
  const base = at('/p');

  it('adds a scope directory for an inline sub-analysis', () => {
    expect(descendPlacement(base, 'sub', {} as any, undefined))
      .toEqual({ home: '/p', universeId: 'baseline', scope: ['sub'] });
  });

  it('moves home and clears the scope for a `path:` sub-analysis', () => {
    // An external sub-analysis is self-similar: its own astra.yaml, so its own
    // results tree, and the scope accumulated on the way there is spent.
    const inline = descendPlacement(base, 'sub', {} as any, undefined);
    expect(descendPlacement(inline, 'ext', { path: './analyses/ext' } as any, undefined))
      .toEqual({ home: join('/p', 'analyses/ext'), universeId: 'baseline', scope: [] });
  });

  it('lets a `path:` sub-analysis file results under a universe of its own', () => {
    expect(descendPlacement(base, 'ext', { path: './ext' } as any, { universe: 'alt' }).universeId)
      .toBe('alt');
  });

  it('ignores a universe selection on an inline sub-analysis', () => {
    // Only an external sub-analysis has its own universes/ to select from.
    expect(descendPlacement(base, 'sub', {} as any, { universe: 'alt' }).universeId)
      .toBe('baseline');
  });
});

describe('descendTo', () => {
  const analysis: any = {
    analyses: { sub: { analyses: { nested: {} } }, ext: { path: './ext' } },
  };

  it('walks a chain of inline sub-analyses', () => {
    expect(descendTo(at('/p'), analysis, undefined, ['sub', 'nested']))
      .toEqual({ home: '/p', universeId: 'baseline', scope: ['sub', 'nested'] });
  });

  it('gives undefined when a segment names no sub-analysis', () => {
    expect(descendTo(at('/p'), analysis, undefined, ['sub', 'ghost'])).toBeUndefined();
  });

  it('stays put for an empty chain', () => {
    expect(descendTo(at('/p'), analysis, undefined, [])).toEqual(at('/p'));
  });
});

describe('a re-export names the bytes its source makes', () => {
  const scope: any = {
    outputs: [
      { id: 'headline', from: 'stage.plot' },
      { id: 'deep_headline', from: 'stage.mid', when: ['method.grid'] },
    ],
    analyses: {
      stage: {
        outputs: [
          { id: 'plot', type: 'figure', format: 'svg' },
          { id: 'mid', from: 'deep.leaf' },
        ],
        analyses: { deep: { outputs: [{ id: 'leaf', type: 'figure', format: 'png' }] } },
      },
    },
  };

  it('points a single-hop alias at the source scope and id', () => {
    const { resolved, source } = resolveOutput(scope.outputs[0], scope);
    expect(source).toEqual({ scope: ['stage'], id: 'plot' });
    expect(resolved.format).toBe('svg');
  });

  it('composes the hops across a chained alias', () => {
    const { resolved, source, unresolved } = resolveOutput(scope.outputs[1], scope);
    expect(unresolved).toBe(false);
    expect(source).toEqual({ scope: ['stage', 'deep'], id: 'leaf' });
    // The resolved view keeps the identity declared *here* …
    expect(resolved.id).toBe('deep_headline');
    expect(resolved.when).toEqual(['method.grid']);
    // … and inherits what the chain supplies.
    expect(resolved.format).toBe('png');
    expect(resolved.type).toBe('figure');
  });

  it('resolves to the source file, in the source scope directory', () => {
    const root = makeProject(['results/baseline/stage/deep/leaf.png']);
    const { resolved, source } = resolveOutput(scope.outputs[1], scope);
    const target = descendTo(at(root), scope, undefined, source.scope)!;
    expect(chose(root, resolveArtifact(target, source.id, { format: resolved.format })))
      .toBe('results/baseline/stage/deep/leaf.png');
  });

  it('leaves a broken alias with nothing to point at', () => {
    const broken: any = { id: 'headline', from: 'stage.missing' };
    const { resolved, source, unresolved } = resolveOutput(broken, scope);
    expect(unresolved).toBe(true);
    expect(source).toEqual({ scope: [], id: 'headline' });
    expect(resolved.format).toBeUndefined();
  });

  it('reports a local output as its own source', () => {
    const local: any = { id: 'fit', type: 'table', format: 'csv' };
    expect(resolveOutput(local, scope).source).toEqual({ scope: [], id: 'fit' });
  });
});
