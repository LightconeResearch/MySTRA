import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pageMathMacros } from '../src/myst-config.js';

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'mystra-config-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('effective MyST math configuration', () => {
  it('follows extend chains with later, project, page, and host overrides', () => {
    const root = project();
    writeFileSync(
      join(root, 'base.yml'),
      `version: 1
project:
  math:
    <<:
      '\\base': '1'
    '\\shared': 'base'
`,
    );
    writeFileSync(
      join(root, 'middle.yml'),
      `version: 1
extends: base.yml
project:
  math:
    '\\middle': '2'
    '\\shared': 'middle'
`,
    );
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
extend: [base.yml, middle.yml]
project:
  math:
    '\\project': '3'
    '\\shared': 'project'
`,
    );
    const page = join(root, 'page.md');
    writeFileSync(
      page,
      `---
math:
  '\\page': '4'
  '\\shared': 'page'
---
`,
    );

    expect(pageMathMacros(root, {
      path: page,
      data: { frontmatter: { math: { '\\host': '5', '\\shared': 'host' } } },
    })).toEqual({
      '\\base': { macro: '1' },
      '\\middle': { macro: '2' },
      '\\project': { macro: '3' },
      '\\page': { macro: '4' },
      '\\host': { macro: '5' },
      '\\shared': { macro: 'host' },
    });
  });

  it('uses the remote extension bytes already resolved into MyST cache', () => {
    const root = project();
    const url = 'https://configs.example.test/astra-base.yml';
    const hash = createHash('md5').update(url).digest('hex');
    const cache = join(root, '_build', 'cache');
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      join(cache, `config-item-${hash}.yml`),
      `version: 1
project:
  math:
    '\\remote': '6'
    '\\shared': 'remote'
`,
    );
    writeFileSync(
      join(root, 'myst.yml'),
      `version: 1
extend: ${url}
project:
  math:
    '\\local': '7'
    '\\shared': 'local'
`,
    );

    expect(pageMathMacros(root)).toEqual({
      '\\remote': { macro: '6' },
      '\\local': { macro: '7' },
      '\\shared': { macro: 'local' },
    });
  });

  it('honours MyST --config when selecting the root config file', () => {
    const root = project();
    writeFileSync(
      join(root, 'custom.yml'),
      `version: 1
project:
  math:
    '\\custom': '8'
`,
    );
    const original = process.argv;
    process.argv = [
      ...original,
      '--config=ignored.yml',
      '--config',
      'custom.yml',
    ];
    try {
      expect(pageMathMacros(root)).toEqual({ '\\custom': { macro: '8' } });
    } finally {
      process.argv = original;
    }
  });
});
