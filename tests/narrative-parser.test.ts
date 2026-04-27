/**
 * Tests for narrative-parser: Markdown → mdast and anchor → crossRef
 * resolution per the v0.0.6 narrative grammar.
 */

import { describe, it, expect } from 'vitest';
import type { ASTRAAnalysis } from '../src/types/astra.js';
import {
  parseNarrativeMarkdown,
  resolveNarrativeAnchors,
  resolveAnchorPath,
} from '../src/transform/narrative-parser.js';

/** Minimal Analysis fixture with one finding, one decision, one
 *  sub-analysis — enough to exercise every resolution branch. */
function fixtureAnalysis(): ASTRAAnalysis {
  return {
    name: 'Test',
    decisions: {
      scaling: { label: 'Feature Scaling', options: { standard: { label: 'Std' } } },
    },
    prior_insights: {},
    findings: {
      best_model: {
        id: 'best_model',
        claim: 'SVM wins',
        created_at: '2024-01-01',
        evidence: [],
      },
    },
    inputs: [{ id: 'iris_data', type: 'data' }],
    outputs: [{ id: 'accuracy', type: 'metric' }],
    analyses: {
      preprocessing: {
        decisions: {},
        prior_insights: {},
        findings: {},
      },
    },
  };
}

describe('parseNarrativeMarkdown', () => {
  it('splits paragraphs on blank lines', () => {
    const out = parseNarrativeMarkdown('First paragraph.\n\nSecond paragraph.');
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('paragraph');
    expect(out[1].type).toBe('paragraph');
  });

  it('preserves anchor links as link nodes pre-resolution', () => {
    const out = parseNarrativeMarkdown(
      'See the [scaling decision](#decisions.scaling) for details.',
    );
    const links = (out[0].children as any[]).filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('#decisions.scaling');
  });

  it('parses inline strong/emphasis/code alongside anchors', () => {
    const out = parseNarrativeMarkdown(
      'Run **fast** with `python` and see [finding](#findings.best_model).',
    );
    const types = (out[0].children as any[]).map((c) => c.type);
    expect(types).toContain('strong');
    expect(types).toContain('inlineCode');
    expect(types).toContain('link');
  });
});

describe('resolveAnchorPath', () => {
  const a = fixtureAnalysis();

  it('resolves #findings.<id> to a finding-<id> identifier', () => {
    expect(resolveAnchorPath('#findings.best_model', a, 'index')).toEqual({
      identifier: 'finding-best_model',
    });
  });

  it('resolves #decisions.<id> to the decision identifier', () => {
    expect(resolveAnchorPath('#decisions.scaling', a, 'index')).toEqual({
      identifier: 'scaling',
    });
  });

  it('resolves #decisions.<id>.options.<opt> to the parent decision', () => {
    // Option-level identifiers don't exist in MySTRA's xref scheme yet,
    // so option anchors fall back to the parent decision heading.
    expect(
      resolveAnchorPath('#decisions.scaling.options.standard', a, 'index'),
    ).toEqual({ identifier: 'scaling' });
  });

  it('falls back to a link URL for missing finding ids', () => {
    expect(resolveAnchorPath('#findings.unknown', a, 'index')).toEqual({
      url: '#findings.unknown',
    });
  });

  it('routes #analyses.<sub> to a relative URL on the host slug', () => {
    expect(resolveAnchorPath('#analyses.preprocessing', a, 'index')).toEqual({
      url: '/preprocessing',
    });
    expect(resolveAnchorPath('#analyses.preprocessing', a, 'foo')).toEqual({
      url: '/foo/preprocessing',
    });
  });

  it('appends sub-analysis path to the URL hash', () => {
    expect(
      resolveAnchorPath('#analyses.preprocessing.outputs.features', a, 'index'),
    ).toEqual({ url: '/preprocessing#outputs.features' });
  });

  it('falls back for ../ parent escapes (parent context unavailable)', () => {
    expect(resolveAnchorPath('#../decisions.method', a, 'index')).toEqual({
      url: '#../decisions.method',
    });
  });

  it('treats a leading sub-analysis id as #analyses.<id> shorthand', () => {
    // `#preprocessing.outputs.features` — sub-analysis ID at the head
    // is the shorthand documented in the spec example block.
    expect(
      resolveAnchorPath('#preprocessing.outputs.features', a, 'index'),
    ).toEqual({ url: '/preprocessing#outputs.features' });
  });
});

describe('resolveNarrativeAnchors', () => {
  it('rewrites in-scope anchor links to crossReference nodes', () => {
    const a = fixtureAnalysis();
    const md = 'See [the finding](#findings.best_model) and [scaling](#decisions.scaling).';
    const resolved = resolveNarrativeAnchors(parseNarrativeMarkdown(md), a, 'index');

    const inline = resolved[0].children as any[];
    const xrefs = inline.filter((c) => c.type === 'crossReference');
    expect(xrefs).toHaveLength(2);
    expect(xrefs.map((x) => x.identifier).sort()).toEqual(
      ['finding-best_model', 'scaling'],
    );
    // Children (the link text) survive the rewrite.
    expect(xrefs[0].children[0].value).toBe('the finding');
  });

  it('leaves unresolvable anchors as plain link nodes', () => {
    const a = fixtureAnalysis();
    const md = 'See [missing](#findings.does_not_exist).';
    const resolved = resolveNarrativeAnchors(parseNarrativeMarkdown(md), a, 'index');
    const inline = resolved[0].children as any[];
    const links = inline.filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('#findings.does_not_exist');
  });

  it('routes sub-analysis references to relative page URLs (link nodes)', () => {
    const a = fixtureAnalysis();
    const md = 'See [pre](#analyses.preprocessing).';
    const resolved = resolveNarrativeAnchors(parseNarrativeMarkdown(md), a, 'index');
    const inline = resolved[0].children as any[];
    const links = inline.filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('/preprocessing');
  });
});
