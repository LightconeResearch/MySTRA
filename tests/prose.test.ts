/**
 * Tests for the prose parser: Markdown → mdast and `#astra:<path>` cross-reference
 * resolution per the unified path grammar.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Analysis } from '@astra-spec/sdk';
import {
  parseProseBlocks,
  parseProseInline,
  resolveNarrativeAnchors,
  resolveAstraAnchor,
} from '../src/transform/prose.js';

/** Minimal Analysis fixture: one finding, one decision, one sub-analysis. */
function fixtureAnalysis(): Analysis {
  return {
    name: 'Test',
    decisions: {
      scaling: { label: 'Feature Scaling', options: { standard: { label: 'Std' } } },
    },
    prior_insights: {},
    findings: {
      best_model: { id: 'best_model', claim: 'SVM wins', created_at: '2024-01-01', evidence: [] },
    },
    inputs: [{ id: 'iris_data', type: 'data' }],
    outputs: [
      { id: 'accuracy', type: 'metric' },
      { id: 'accuracy_plot', type: 'figure' },
      { id: 'results_table', type: 'table' },
    ],
    analyses: {
      preprocessing: { decisions: {}, prior_insights: {}, findings: {} },
    },
  };
}

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

  it('preserves #astra: links as link nodes pre-resolution', () => {
    const out = parseProseBlocks('See the [scaling](#astra:decisions/scaling) decision.');
    const links = (out[0].children as any[]).filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('#astra:decisions/scaling');
  });

  it('parses inline strong/emphasis/code alongside anchors', () => {
    const out = parseProseBlocks(
      'Run **fast** _slow_ with `python` and see [finding](#astra:findings/best_model).',
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

  it('resolves inline #astra: links when input is a heading (block context)', () => {
    const out = parseProseInline('# See [the finding](#astra:findings/best_model) for details', {
      analysis: fixtureAnalysis(),
      slug: 'index',
    });
    const xrefs = out.filter((c: any) => c.type === 'crossReference');
    expect(xrefs).toHaveLength(1);
    expect(xrefs[0].identifier).toBe('finding-best_model');
  });
});

describe('parseProse* with context (anchor resolution)', () => {
  const a = fixtureAnalysis();

  it('resolves [finding](#astra:findings/<id>) to a crossReference', () => {
    const out = parseProseBlocks('See [the finding](#astra:findings/best_model).', {
      analysis: a,
      slug: 'index',
    });
    const xrefs = (out[0].children as any[]).filter((c) => c.type === 'crossReference');
    expect(xrefs).toHaveLength(1);
    expect(xrefs[0].identifier).toBe('finding-best_model');
  });

  it('resolves [input](#astra:inputs/<id>) to a crossReference', () => {
    const out = parseProseBlocks('Driven by the [iris dataset](#astra:inputs/iris_data).', {
      analysis: a,
      slug: 'index',
    });
    const xrefs = (out[0].children as any[]).filter((c) => c.type === 'crossReference');
    expect(xrefs[0].identifier).toBe('input-iris_data');
  });

  it('without context: #astra: anchors remain plain links (back-compat)', () => {
    const out = parseProseBlocks('See [it](#astra:findings/best_model).');
    const inline = out[0].children as any[];
    expect(inline.filter((c) => c.type === 'crossReference')).toHaveLength(0);
    expect(inline.filter((c) => c.type === 'link')).toHaveLength(1);
  });
});

describe('resolveAstraAnchor', () => {
  const a = fixtureAnalysis();

  it('resolves in-scope elements to <kind>-<id> identifiers', () => {
    expect(resolveAstraAnchor('#astra:findings/best_model', a, 'index')).toEqual({
      identifier: 'finding-best_model',
    });
    expect(resolveAstraAnchor('#astra:decisions/scaling', a, 'index')).toEqual({
      identifier: 'decision-scaling',
    });
    expect(resolveAstraAnchor('#astra:inputs/iris_data', a, 'index')).toEqual({
      identifier: 'input-iris_data',
    });
    expect(resolveAstraAnchor('#astra:outputs/accuracy', a, 'index')).toEqual({
      identifier: 'output-accuracy',
    });
  });

  it('collapses an option child to the parent decision identifier', () => {
    expect(resolveAstraAnchor('#astra:decisions/scaling/options/standard', a, 'index')).toEqual({
      identifier: 'decision-scaling',
    });
  });

  it('falls back to a link URL for unknown in-scope ids', () => {
    expect(resolveAstraAnchor('#astra:findings/nope', a, 'index')).toEqual({
      url: '#astra:findings/nope',
    });
    expect(resolveAstraAnchor('#astra:outputs/nope', a, 'index')).toEqual({
      url: '#astra:outputs/nope',
    });
  });

  it('routes a bare sub-analysis to a relative page URL', () => {
    expect(resolveAstraAnchor('#astra:preprocessing', a, 'index')).toEqual({ url: '/preprocessing' });
    expect(resolveAstraAnchor('#astra:preprocessing', a, 'foo')).toEqual({
      url: '/foo/preprocessing',
    });
  });

  it('builds a cross-page URL with the <kind>-<id> fragment for sub-analysis elements', () => {
    expect(resolveAstraAnchor('#astra:preprocessing/outputs/features', a, 'index')).toEqual({
      url: '/preprocessing#output-features',
    });
    expect(resolveAstraAnchor('#astra:preprocessing/decisions/scaling', a, 'index')).toEqual({
      url: '/preprocessing#decision-scaling',
    });
  });

  it('resolves an absolute /path from the root (cross-page when off-root)', () => {
    expect(resolveAstraAnchor('#astra:/findings/best_model', a, 'index')).toEqual({
      identifier: 'finding-best_model',
    });
    expect(resolveAstraAnchor('#astra:/findings/best_model', a, 'preprocessing')).toEqual({
      url: '/#finding-best_model',
    });
  });

  it('climbs scopes with ../', () => {
    expect(resolveAstraAnchor('#astra:../decisions/scaling', a, 'preprocessing')).toEqual({
      url: '/#decision-scaling',
    });
  });

  it('routes prior insights to the ancestor page that declares them', () => {
    const scopes = [
      {
        slug: 'index',
        priorInsights: {
          compute_scaling: {
            id: 'compute_scaling',
            claim: 'Scaling matters',
            created_at: '2024-01-01',
            evidence: [],
          },
        },
      },
    ];
    expect(
      resolveAstraAnchor('#astra:prior_insights/compute_scaling', a, 'preprocessing', scopes),
    ).toEqual({ url: '/#prior_insight-compute_scaling' });
    expect(
      resolveAstraAnchor('#astra:../prior_insights/compute_scaling', a, 'preprocessing', scopes),
    ).toEqual({ url: '/#prior_insight-compute_scaling' });
  });

  it('resolves a local prior insight to its identifier', () => {
    const withPrior: Analysis = {
      ...a,
      prior_insights: {
        compute_scaling: { id: 'compute_scaling', claim: 'x', created_at: '2024-01-01', evidence: [] },
      },
    };
    expect(resolveAstraAnchor('#astra:prior_insights/compute_scaling', withPrior, 'index')).toEqual({
      identifier: 'prior_insight-compute_scaling',
    });
  });
});

describe('resolveNarrativeAnchors', () => {
  it('rewrites in-scope anchor links to crossReference nodes, keeping the text', () => {
    const a = fixtureAnalysis();
    const md = 'See [the finding](#astra:findings/best_model) and [scaling](#astra:decisions/scaling).';
    const resolved = resolveNarrativeAnchors(parseProseBlocks(md), a, 'index');
    const xrefs = (resolved[0].children as any[]).filter((c) => c.type === 'crossReference');
    expect(xrefs.map((x) => x.identifier).sort()).toEqual(['decision-scaling', 'finding-best_model']);
    expect(xrefs.find((x) => x.identifier === 'finding-best_model').children[0].value).toBe(
      'the finding',
    );
  });

  it('leaves unresolvable anchors as plain link nodes', () => {
    const a = fixtureAnalysis();
    const resolved = resolveNarrativeAnchors(
      parseProseBlocks('See [missing](#astra:findings/does_not_exist).'),
      a,
      'index',
    );
    const links = (resolved[0].children as any[]).filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('#astra:findings/does_not_exist');
  });

  it('routes a sub-analysis reference to a relative page URL', () => {
    const a = fixtureAnalysis();
    const resolved = resolveNarrativeAnchors(
      parseProseBlocks('See [pre](#astra:preprocessing).'),
      a,
      'index',
    );
    const links = (resolved[0].children as any[]).filter((c) => c.type === 'link');
    expect(links[0].url).toBe('/preprocessing');
  });

  it('rewrites in-scope figure image embeds to /static artifact URLs', () => {
    const a = fixtureAnalysis();
    const resolved = parseProseBlocks('![Accuracy](#astra:outputs/accuracy_plot)', {
      analysis: a,
      slug: 'index',
      results: (id) => (id === 'accuracy_plot' ? '/tmp/accuracy_plot.PNG' : undefined),
    });
    const images = collectNodes(resolved, 'image');
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('/static/accuracy_plot.png');
  });

  it('rewrites image URLs inside MyST figure directives', () => {
    const a = fixtureAnalysis();
    const resolved = parseProseBlocks(':::{figure} #astra:outputs/accuracy_plot\nCaption\n:::', {
      analysis: a,
      slug: 'index',
      results: (id) => (id === 'accuracy_plot' ? '/tmp/accuracy_plot.svg' : undefined),
    });
    const images = collectNodes(resolved, 'image');
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('/static/accuracy_plot.svg');
  });

  it('drops image embeds that point at non-figure outputs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = fixtureAnalysis();
    const resolved = parseProseBlocks('![Table](#astra:outputs/results_table)', {
      analysis: a,
      slug: 'index',
      results: (id) => (id === 'results_table' ? '/tmp/results_table.csv' : undefined),
    });
    expect(collectNodes(resolved, 'image')).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      '[mystra] image embed references non-figure output "results_table" (type: table) — dropped.',
    );
    warn.mockRestore();
  });
});
