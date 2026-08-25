/**
 * Artifact selection inside an output directory.
 *
 * An ASTRA output is a *directory*, so a recipe may write several files into
 * `{output}`. These tests pin down which one a value reads, in order of
 * decreasing explicitness — the declared `format:` first, the `<id>.<ext>`
 * convention next, alphabetical order only as a last resort — and that the
 * last resort is never silent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { VFile } from 'vfile';

import { resolveArtifact } from '../src/loader.js';
import { resolveOutput } from '../src/transform/resolve-output.js';

/** Temp dirs created per test, torn down afterwards. */
const tempDirs: string[] = [];

/** Build `results/baseline/<id>/` holding `files`, and return the project dir. */
function makeResults(id: string, files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mystra-artifact-'));
  tempDirs.push(dir);
  const outDir = join(dir, 'results', 'baseline', id);
  mkdirSync(outDir, { recursive: true });
  for (const f of files) writeFileSync(join(outDir, f), '');
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('resolveArtifact', () => {
  it('picks <id>.<format> over a file that merely sorts first', () => {
    const root = makeResults('constraints', ['constraints.csv', 'constraints.log']);
    // `constraints.csv` sorts second and both share the id stem, so nothing but
    // the declared format can separate them.
    const chosen = resolveArtifact(root, 'baseline', 'constraints', { format: 'csv' });
    expect(basename(chosen!)).toBe('constraints.csv');
  });

  it('falls back to any file carrying the declared extension', () => {
    // The recipe named the artifact itself; the format still identifies it.
    const root = makeResults('constraints', ['run.log', 'values.csv']);
    const chosen = resolveArtifact(root, 'baseline', 'constraints', { format: 'csv' });
    expect(basename(chosen!)).toBe('values.csv');
  });

  it('matches a dotted format the single-extension strip cannot see', () => {
    const root = makeResults('bundle', ['bundle.tar.gz', 'manifest.txt']);
    const chosen = resolveArtifact(root, 'baseline', 'bundle', { format: 'tar.gz' });
    expect(basename(chosen!)).toBe('bundle.tar.gz');
  });

  it('still prefers <id>.* when no format is declared', () => {
    const root = makeResults('constraints', ['analysis.csv', 'constraints.csv']);
    const chosen = resolveArtifact(root, 'baseline', 'constraints');
    expect(basename(chosen!)).toBe('constraints.csv');
  });

  it('warns when alphabetical order is load-bearing, and names the file it read', () => {
    const root = makeResults('parameter_constraints', ['constraints.csv', 'summary.json']);
    const vf = new VFile({ path: 'index.md' });
    const chosen = resolveArtifact(root, 'baseline', 'parameter_constraints', { vfile: vf });

    expect(basename(chosen!)).toBe('constraints.csv');
    const message = String(vf.messages[0]?.message ?? '');
    expect(message).toContain('parameter_constraints');
    expect(message).toContain('constraints.csv');
    expect(message).toContain('format:');
  });

  it('says so when the declared format matches nothing in the directory', () => {
    const root = makeResults('constraints', ['constraints.json', 'run.log']);
    const vf = new VFile({ path: 'index.md' });
    const chosen = resolveArtifact(root, 'baseline', 'constraints', { format: 'csv', vfile: vf });

    // The `<id>.*` convention still supplies a sane answer; the mismatch is the
    // thing worth reporting.
    expect(basename(chosen!)).toBe('constraints.json');
    expect(String(vf.messages[0]?.message ?? '')).toContain('format: csv');
  });

  it('stays silent when the directory holds no choice to get wrong', () => {
    const root = makeResults('constraints', ['whatever.csv']);
    const vf = new VFile({ path: 'index.md' });
    expect(basename(resolveArtifact(root, 'baseline', 'constraints', { vfile: vf })!))
      .toBe('whatever.csv');
    expect(vf.messages).toEqual([]);
  });

  it('warns once per output id, not once per reference', () => {
    const root = makeResults('constraints', ['a.csv', 'b.csv']);
    const vf = new VFile({ path: 'index.md' });
    const warned = new Set<string>();
    for (let i = 0; i < 3; i++) {
      resolveArtifact(root, 'baseline', 'constraints', { vfile: vf, warned });
    }
    expect(vf.messages).toHaveLength(1);
  });

  it('skips dotfiles, so a run manifest never becomes the artifact', () => {
    const root = makeResults('constraints', ['.lightcone-manifest.json', 'values.csv']);
    const vf = new VFile({ path: 'index.md' });
    expect(basename(resolveArtifact(root, 'baseline', 'constraints', { vfile: vf })!))
      .toBe('values.csv');
    // One visible file left → nothing ambiguous to report.
    expect(vf.messages).toEqual([]);
  });

  it('returns undefined for an output directory that was never produced', () => {
    const root = makeResults('constraints', ['values.csv']);
    expect(resolveArtifact(root, 'baseline', 'not_produced')).toBeUndefined();
  });
});

describe('format inheritance through a `from:` alias', () => {
  // The schema forbids `format:` on a re-export, so the resolved view has to
  // carry the source's — otherwise the alias is exactly the case that falls
  // back to guessing.
  const scope: any = {
    outputs: [{ id: 'headline', from: 'stage.plot' }],
    analyses: {
      stage: { outputs: [{ id: 'plot', type: 'figure', format: 'svg' }] },
    },
  };

  it('resolves an alias to the source format', () => {
    const { resolved } = resolveOutput(scope.outputs[0], scope);
    expect(resolved.format).toBe('svg');
  });

  it('leaves a broken alias without a format to guess from', () => {
    const broken: any = { id: 'headline', from: 'stage.missing' };
    const { resolved, unresolved } = resolveOutput(broken, scope);
    expect(unresolved).toBe(true);
    expect(resolved.format).toBeUndefined();
  });
});
