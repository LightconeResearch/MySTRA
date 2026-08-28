/**
 * Tests for the prose parser: component Markdown → mdast.
 */

import { describe, it, expect } from 'vitest';
import { VFile } from 'vfile';
import { parseProseBlocks, parseProseInline } from '../src/transform/prose.js';

function collectNodes(nodes: any[], type: string): any[] {
  const collected: any[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === type) collected.push(node);
    Object.values(node).forEach(walk);
  };
  walk(nodes);
  return collected;
}

describe('parseProseBlocks (via myst-parser)', () => {
  it('splits paragraphs on blank lines', () => {
    const out = parseProseBlocks('First paragraph.\n\nSecond paragraph.');
    expect(out).toHaveLength(2);
    expect(out.every((n) => n.type === 'paragraph')).toBe(true);
  });

  it('parses inline strong/emphasis/code/links', () => {
    const out = parseProseBlocks(
      'Run **fast** _slow_ with `python` and see [the docs](https://example.org).',
    );
    const types = (out[0].children as any[]).map((c) => c.type);
    expect(types).toContain('strong');
    expect(types).toContain('emphasis');
    expect(types).toContain('inlineCode');
    expect(types).toContain('link');
  });

  it('parses block-level structures (lists, code blocks, headings)', () => {
    const md = '# Heading\n\nA paragraph.\n\n- one\n- two\n\n```python\nx = 1\n```';
    const types = parseProseBlocks(md).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['heading', 'paragraph', 'list', 'code']));
  });

  it('strips position fields from output', () => {
    const out = parseProseBlocks('hello');
    const stack: any[] = [...out];
    while (stack.length) {
      const n = stack.pop();
      expect(n.position).toBeUndefined();
      if (Array.isArray(n.children)) stack.push(...n.children);
    }
  });

  it('unwraps mystDirective wrappers to their expanded content', () => {
    const out = parseProseBlocks(':::{note}\nBody of the note.\n:::');
    expect(collectNodes(out, 'mystDirective')).toHaveLength(0);
    const admonitions = collectNodes(out, 'admonition');
    expect(admonitions).toHaveLength(1);
  });

  it('renders display math before late component prose reaches the theme', () => {
    const [math] = parseProseBlocks('$$\nx^2 + y^2\n$$');
    expect(math).toMatchObject({ type: 'math', value: 'x^2 + y^2' });
    expect(math.html).toContain('class="katex-display"');
  });
});

describe('parseProseInline', () => {
  it('unwraps a single paragraph to its inline children', () => {
    const out = parseProseInline('A **bold** claim.');
    expect(out.every((n: any) => n.type !== 'paragraph')).toBe(true);
    expect(out.map((n: any) => n.type)).toContain('strong');
  });

  it('handles undefined and empty strings', () => {
    expect(parseProseInline(undefined)).toEqual([]);
    expect(parseProseInline('')).toEqual([]);
  });

  it('preserves text from non-paragraph blocks (lists, headings, code)', () => {
    const md = '# heading\n\n- item one\n- item two\n\n```\nfenced code\n```';
    const flat = parseProseInline(md)
      .map((n: any) => (n.type === 'text' ? n.value : ''))
      .join('');
    expect(flat).toContain('heading');
    expect(flat).toContain('item one');
    expect(flat).toContain('fenced code');
  });

  it('renders inline math before late component prose reaches the theme', () => {
    const math = collectNodes(
      parseProseInline('where $x^2$ is positive'),
      'inlineMath',
    )[0];
    expect(math).toMatchObject({ type: 'inlineMath', value: 'x^2' });
    expect(math.html).toContain('class="katex"');
  });

  it('reports invalid math through the supplied page file', () => {
    const file = new VFile({ path: 'article.md' });
    const math = collectNodes(
      parseProseInline('broken $\\notacommand{$', file),
      'inlineMath',
    )[0];
    expect(file.messages).toHaveLength(1);
    expect(file.messages[0]?.fatal).toBe(true);
    expect(math).toMatchObject({ type: 'inlineMath', error: true });
  });
});
