import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisIndex } from '@astra-spec/sdk';

import { analysisPageHrefs, rawAstraScope } from '../src/page-map.js';

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'mystra-pages-'));
  roots.push(root);
  return root;
}

function index(...analysisPaths: string[]): AnalysisIndex {
  return {
    analysisByPath: new Map(analysisPaths.map((canonicalPath) => [
      canonicalPath,
      { canonicalPath },
    ])),
    recordByPath: new Map(),
    analysisByRecordPath: new Map(),
  } as unknown as AnalysisIndex;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('analysis page mapping', () => {
  it('uses TOC routes and explicit astra_scope overrides without guessing', () => {
    const root = project();
    writeFileSync(join(root, 'index.md'), '# Root');
    writeFileSync(
      join(root, 'methods.md'),
      '---\nastra_scope: reconstruction\n---\n# Methods\n',
    );
    writeFileSync(join(root, 'unlisted.md'), '# Unlisted');
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: index.md
    - file: methods.md
`,
    );

    const hrefs = analysisPageHrefs(
      root,
      index('$', 'reconstruction', 'unlisted'),
    );
    expect([...hrefs]).toEqual([
      ['$', '/'],
      ['reconstruction', '/methods'],
    ]);
    expect(hrefs.has('unlisted')).toBe(false);
  });

  it('omits an analysis href when two configured pages map to it', () => {
    const root = project();
    writeFileSync(join(root, 'index.md'), '# Root');
    writeFileSync(
      join(root, 'first.md'),
      '---\nastra_scope: stage\n---\n# First\n',
    );
    writeFileSync(
      join(root, 'second.md'),
      '---\nastra_scope: [stage]\n---\n# Second\n',
    );
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: index.md
    - file: first.md
    - file: second.md
`,
    );

    const hrefs = analysisPageHrefs(root, index('$', 'stage'));
    expect(hrefs.get('$')).toBe('/');
    expect(hrefs.has('stage')).toBe(false);
  });

  it('matches MyST folder URLs when site.options.folders is enabled', () => {
    const root = project();
    writeFileSync(join(root, 'index.md'), '# Root');
    mkdirSync(join(root, 'chapters'));
    writeFileSync(
      join(root, 'chapters', 'overview.md'),
      '---\nastra_scope: stage\n---\n# Stage\n',
    );
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: index.md
    - file: chapters/overview.md
site:
  options:
    folders: true
`,
    );

    expect(analysisPageHrefs(root, index('$', 'stage')).get('stage')).toBe(
      '/chapters/overview',
    );
  });

  it('matches MyST basename routes for pages outside the project root', () => {
    const container = project();
    const root = join(container, 'site');
    mkdirSync(root);
    writeFileSync(join(root, 'index.md'), '# Root');
    writeFileSync(
      join(container, 'stage.md'),
      '---\nastra_scope: stage\n---\n# Stage\n',
    );
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: index.md
    - file: ../stage.md
site:
  options:
    folders: true
`,
    );

    expect(analysisPageHrefs(root, index('$', 'stage')).get('stage')).toBe(
      '/stage',
    );
  });

  it('maps a custom first-page filename to its analysis at the root route', () => {
    const root = project();
    writeFileSync(join(root, 'stage.md'), '# Stage');
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: stage.md
`,
    );

    const hrefs = analysisPageHrefs(root, index('$', 'stage'));
    expect([...hrefs]).toEqual([['stage', '/']]);
  });

  it('resolves an extensionless dotted filename without losing its scope', () => {
    const root = project();
    writeFileSync(join(root, 'index.md'), '# Root');
    writeFileSync(join(root, 'stage.inner.md'), '# Inner stage');
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: index
    - file: stage.inner
`,
    );

    const hrefs = analysisPageHrefs(root, index('$', 'stage.inner'));
    expect(hrefs.get('stage.inner')).toBe('/stage-inner');
  });

  it('omits hrefs when host-owned TOC pattern expansion prevents proof', () => {
    const root = project();
    writeFileSync(join(root, 'index.md'), '# Root');
    writeFileSync(join(root, 'stage.md'), '# Stage');
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
project:
  toc:
    - file: index.md
    - pattern: '*.md'
`,
    );

    expect(analysisPageHrefs(root, index('$', 'stage')).size).toBe(0);
  });

  it('returns no routes without an explicit project TOC', () => {
    const root = project();
    writeFileSync(join(root, 'stage.md'), '# Stage');
    expect(analysisPageHrefs(root, index('$', 'stage')).size).toBe(0);
  });
});

describe('rawAstraScope', () => {
  it('accepts only the documented dotted-string and segment-list forms', () => {
    const root = project();
    const dotted = join(root, 'dotted.md');
    const listed = join(root, 'listed.md');
    const invalid = join(root, 'invalid.md');
    writeFileSync(dotted, '---\nastra_scope: stage.inner\n---\n');
    writeFileSync(listed, '---\nastra_scope: [stage, inner]\n---\n');
    writeFileSync(invalid, '---\nastra_scope: 42\n---\n');
    expect(rawAstraScope(dotted)).toBe('stage.inner');
    expect(rawAstraScope(listed)).toEqual(['stage', 'inner']);
    expect(rawAstraScope(invalid)).toBeUndefined();
  });
});
