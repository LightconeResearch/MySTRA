/**
 * §2 — advisory spec validation in `loadASTRASource`.
 *
 * These tests drive the loader against tiny hand-built astra.yaml files in a
 * temp dir built per test, to pin down the contract that matters: a
 * malformed spec is *reported, never fatal*. We assert that loading a spec with
 * an obvious semantic error (an output `when:` naming a decision that doesn't
 * exist) still returns a source and routes a `[mystra]` warning through
 * `console.warn`, and that a well-formed spec produces no semantic-error
 * warnings.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VFile } from 'vfile';

import { loadASTRASource } from '../src/loader.js';

/** Temp dirs created per test, torn down afterwards. */
const tempDirs: string[] = [];

/** Write `astra.yaml` into a fresh temp project dir and return its path. */
function makeProject(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mystra-loader-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'astra.yaml'), yaml);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// A well-formed minimal spec: one input, one output.
const WELL_FORMED = `version: "1.0"
name: Minimal
inputs:
  - id: a
    type: dataset
    from: https://example.com/a
outputs:
  - id: o
    type: figure
    recipe:
      command: echo {output}
      inputs: [a]
`;

// Same shape, but the output's `when:` references a decision that was never
// declared — `validateAnalysis` flags this as INVALID_WHEN_REF.
const MALFORMED = `version: "1.0"
name: Minimal
inputs:
  - id: a
    type: dataset
    from: https://example.com/a
outputs:
  - id: o
    type: figure
    when: ghost_decision.some_option
    recipe:
      command: echo {output}
      inputs: [a]
`;

describe('loadASTRASource validation', () => {
  it('reports a malformed spec via console.warn without throwing, and still loads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = makeProject(MALFORMED);

    const source = loadASTRASource(dir);

    // (a) it does not throw, (b) it returns a usable source...
    expect(source).toBeTruthy();
    expect(source.analysis).toBeTruthy();

    // (c) ...and at least one `[mystra]` warning describes the semantic problem.
    const messages = warn.mock.calls.map((c) => String(c[0]));
    const flagged = messages.filter((m) => m.startsWith('[mystra]'));
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.some((m) => m.includes('validateAnalysis') && m.includes('ghost_decision'))).toBe(
      true,
    );
  });

  it('routes validation warnings through a provided vfile instead of the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = makeProject(MALFORMED);
    const vf = new VFile({ path: 'index.md' });

    const source = loadASTRASource(dir, vf);

    expect(source.analysis).toBeTruthy();
    expect(vf.messages.some((m) => String(m.message).includes('ghost_decision'))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits no semantic-error warnings for a well-formed spec', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = makeProject(WELL_FORMED);

    const source = loadASTRASource(dir);
    expect(source.analysis).toBeTruthy();

    // The error-class validator must stay silent.
    const messages = warn.mock.calls.map((c) => String(c[0]));
    const offending = messages.filter((m) => m.startsWith('[mystra] validateAnalysis:'));
    expect(offending).toEqual([]);
  });
});
