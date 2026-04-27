/**
 * Tests for narrative-parser: Markdown → mdast and anchor → crossRef
 * resolution per the v0.0.6 narrative grammar.
 */

import { describe, it, expect } from 'vitest';
import type { ASTRAAnalysis } from '../src/types/astra.js';
import {
  parseProseBlocks,
  parseProseInline,
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

describe('parseProseBlocks (via myst-parser)', () => {
  it('splits paragraphs on blank lines', () => {
    const out = parseProseBlocks('First paragraph.\n\nSecond paragraph.');
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('paragraph');
    expect(out[1].type).toBe('paragraph');
  });

  it('preserves anchor links as link nodes pre-resolution', () => {
    const out = parseProseBlocks(
      'See the [scaling decision](#decisions.scaling) for details.',
    );
    const links = (out[0].children as any[]).filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('#decisions.scaling');
  });

  it('parses inline strong/emphasis/code alongside anchors', () => {
    const out = parseProseBlocks(
      'Run **fast** _slow_ with `python` and see [finding](#findings.best_model).',
    );
    const types = (out[0].children as any[]).map((c) => c.type);
    expect(types).toContain('strong');
    expect(types).toContain('emphasis');
    expect(types).toContain('inlineCode');
    expect(types).toContain('link');
  });

  it('emits myst-parser-shaped mdast (not the legacy approximation)', () => {
    // The bespoke inline-parser used a single regex and produced
    // shallow nodes without round-tripping nested formatting. This
    // test pins down the mdast shape we now get from myst-parser:
    // strong wraps text directly, links carry url + children, and
    // inline code is `inlineCode` with a `value` (no children).
    const out = parseProseBlocks('A **bold _nested_ word** in `code`.');
    const inline = out[0].children as any[];
    const strong = inline.find((c) => c.type === 'strong')!;
    expect(strong.children[0].type).toBe('text');
    // Nested emphasis should survive inside strong — the bespoke
    // parser flattened nested patterns.
    expect(strong.children.some((c: any) => c.type === 'emphasis')).toBe(true);
    const code = inline.find((c) => c.type === 'inlineCode')!;
    expect(code.value).toBe('code');
    expect(code.children).toBeUndefined();
  });

  it('parses block-level structures (lists, code blocks, headings)', () => {
    const md = '# Heading\n\nA paragraph.\n\n- one\n- two\n\n```python\nx = 1\n```';
    const out = parseProseBlocks(md);
    const types = out.map((n) => n.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('code');
  });

  it('strips position fields from output (no markdown-it noise)', () => {
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
    // No paragraph wrapper, just the inline phrasing nodes.
    expect(out.every((n: any) => n.type !== 'paragraph')).toBe(true);
    const types = out.map((n: any) => n.type);
    expect(types).toContain('strong');
  });

  it('handles undefined and empty strings', () => {
    expect(parseProseInline(undefined)).toEqual([]);
    expect(parseProseInline('')).toEqual([]);
  });
});

describe('parseProseBlocks/Inline with context (anchor resolution)', () => {
  // The same anchor-resolver post-pass that runs on narrative
  // sections runs on every prose call site when a context is
  // provided — so authors can cite from rationales, descriptions,
  // claims, etc., not just narrative.
  const a = fixtureAnalysis();

  it('Option.description: resolves [see finding](#findings.<id>) to a crossReference', () => {
    const md = 'See [the finding](#findings.best_model) for context.';
    const out = parseProseBlocks(md, { analysis: a, slug: 'index' });
    const inline = out[0].children as any[];
    const xrefs = inline.filter((c) => c.type === 'crossReference');
    expect(xrefs).toHaveLength(1);
    expect(xrefs[0].identifier).toBe('finding-best_model');
  });

  it('Decision.rationale: resolves [input](#inputs.<id>) to a crossReference', () => {
    const md = 'Driven by the [iris dataset](#inputs.iris_data).';
    const out = parseProseBlocks(md, { analysis: a, slug: 'index' });
    const inline = out[0].children as any[];
    const xrefs = inline.filter((c) => c.type === 'crossReference');
    expect(xrefs).toHaveLength(1);
    expect(xrefs[0].identifier).toBe('input-iris_data');
  });

  it('Insight.claim (inline): leaves [parent](#../decisions.<id>) as a plain link (parent escape)', () => {
    const md = 'Echoes the [parent decision](#../decisions.method).';
    const out = parseProseInline(md, { analysis: a, slug: 'index' });
    const xrefs = out.filter((c: any) => c.type === 'crossReference');
    const links = out.filter((c: any) => c.type === 'link');
    expect(xrefs).toHaveLength(0);
    expect(links).toHaveLength(1);
    // ../ escapes preserve the original href; cross-scope
    // resolution is left to the consumer.
    expect(links[0].url).toBe('#../decisions.method');
  });

  it('without context: anchors remain plain links (back-compat)', () => {
    const md = 'See [it](#findings.best_model).';
    const out = parseProseBlocks(md);
    const inline = out[0].children as any[];
    expect(inline.filter((c) => c.type === 'crossReference')).toHaveLength(0);
    expect(inline.filter((c) => c.type === 'link')).toHaveLength(1);
  });
});

describe('resolveAnchorPath', () => {
  const a = fixtureAnalysis();

  it('resolves #findings.<id> to a finding-<id> identifier', () => {
    expect(resolveAnchorPath('#findings.best_model', a, 'index')).toEqual({
      identifier: 'finding-best_model',
    });
  });

  it('resolves #decisions.<id> to a decision-<id> identifier', () => {
    expect(resolveAnchorPath('#decisions.scaling', a, 'index')).toEqual({
      identifier: 'decision-scaling',
    });
  });

  it('resolves #decisions.<id>.options.<opt> to the parent decision', () => {
    // Option-level identifiers don't exist in MySTRA's xref scheme yet,
    // so option anchors fall back to the parent decision heading.
    expect(
      resolveAnchorPath('#decisions.scaling.options.standard', a, 'index'),
    ).toEqual({ identifier: 'decision-scaling' });
  });

  it('resolves #inputs.<id> to an input-<id> identifier', () => {
    expect(resolveAnchorPath('#inputs.iris_data', a, 'index')).toEqual({
      identifier: 'input-iris_data',
    });
  });

  it('resolves #outputs.<id> to an output-<id> identifier', () => {
    expect(resolveAnchorPath('#outputs.accuracy', a, 'index')).toEqual({
      identifier: 'output-accuracy',
    });
  });

  it('resolves #prior_insights.<id> to a prior_insight-<id> identifier', () => {
    const aWithPrior: ASTRAAnalysis = {
      ...a,
      prior_insights: {
        compute_scaling: {
          id: 'compute_scaling',
          claim: 'Scaling matters',
          created_at: '2024-01-01',
          evidence: [],
        },
      },
    };
    expect(resolveAnchorPath('#prior_insights.compute_scaling', aWithPrior, 'index')).toEqual({
      identifier: 'prior_insight-compute_scaling',
    });
  });

  it('falls back when #inputs.<id>/#outputs.<id>/#prior_insights.<id> targets are unknown', () => {
    expect(resolveAnchorPath('#inputs.unknown', a, 'index')).toEqual({
      url: '#inputs.unknown',
    });
    expect(resolveAnchorPath('#outputs.unknown', a, 'index')).toEqual({
      url: '#outputs.unknown',
    });
    expect(resolveAnchorPath('#prior_insights.unknown', a, 'index')).toEqual({
      url: '#prior_insights.unknown',
    });
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

  it('appends sub-analysis path to the URL hash, translating ASTRA grammar to mdast ids', () => {
    // `outputs.features` on the destination page renders as
    // `output-features` (the structural-element id convention), so
    // the cross-page URL fragment must use that form to land on a
    // real anchor — not the raw ASTRA tree path.
    expect(
      resolveAnchorPath('#analyses.preprocessing.outputs.features', a, 'index'),
    ).toEqual({ url: '/preprocessing#output-features' });
  });

  it('translates other ASTRA categories to <kind>-<id> in cross-page URLs', () => {
    expect(
      resolveAnchorPath('#analyses.preprocessing.decisions.scaling', a, 'index'),
    ).toEqual({ url: '/preprocessing#decision-scaling' });
    expect(
      resolveAnchorPath('#analyses.preprocessing.findings.best_model', a, 'index'),
    ).toEqual({ url: '/preprocessing#finding-best_model' });
    expect(
      resolveAnchorPath('#analyses.preprocessing.inputs.iris_data', a, 'index'),
    ).toEqual({ url: '/preprocessing#input-iris_data' });
    expect(
      resolveAnchorPath('#analyses.preprocessing.prior_insights.compute_scaling', a, 'index'),
    ).toEqual({ url: '/preprocessing#prior_insight-compute_scaling' });
  });

  it('routes #narrative.<section> on a sub-analysis to the destination narrative carrier', () => {
    expect(
      resolveAnchorPath('#analyses.preprocessing.narrative.summary', a, 'index'),
    ).toEqual({ url: '/preprocessing#narrative-summary' });
  });

  it('collapses #analyses.<sub>.decisions.<id>.options.<opt> to the parent decision', () => {
    expect(
      resolveAnchorPath('#analyses.preprocessing.decisions.scaling.options.standard', a, 'index'),
    ).toEqual({ url: '/preprocessing#decision-scaling' });
  });

  it('falls back for ../ parent escapes (parent context unavailable)', () => {
    expect(resolveAnchorPath('#../decisions.method', a, 'index')).toEqual({
      url: '#../decisions.method',
    });
  });

  it('treats a leading sub-analysis id as #analyses.<id> shorthand', () => {
    // `#preprocessing.outputs.features` — sub-analysis ID at the head
    // is the shorthand documented in the spec example block; same
    // grammar translation applies as the explicit form.
    expect(
      resolveAnchorPath('#preprocessing.outputs.features', a, 'index'),
    ).toEqual({ url: '/preprocessing#output-features' });
  });

  it('resolves #narrative.<section> to the narrative chunk identifier', () => {
    const withNarrative: ASTRAAnalysis = {
      ...a,
      narrative: { findings: 'Some findings prose.', summary: 'Hi.' },
    };
    expect(
      resolveAnchorPath('#narrative.findings', withNarrative, 'index'),
    ).toEqual({ identifier: 'narrative-findings' });
    expect(
      resolveAnchorPath('#narrative.summary', withNarrative, 'index'),
    ).toEqual({ identifier: 'narrative-summary' });
  });

  it('falls back when #narrative.<section> targets an empty section', () => {
    const onlySummary: ASTRAAnalysis = { ...a, narrative: { summary: 'Hi.' } };
    expect(
      resolveAnchorPath('#narrative.findings', onlySummary, 'index'),
    ).toEqual({ url: '#narrative.findings' });
  });
});

describe('resolveNarrativeAnchors', () => {
  it('rewrites in-scope anchor links to crossReference nodes', () => {
    const a = fixtureAnalysis();
    const md = 'See [the finding](#findings.best_model) and [scaling](#decisions.scaling).';
    const resolved = resolveNarrativeAnchors(parseProseBlocks(md), a, 'index');

    const inline = resolved[0].children as any[];
    const xrefs = inline.filter((c) => c.type === 'crossReference');
    expect(xrefs).toHaveLength(2);
    expect(xrefs.map((x) => x.identifier).sort()).toEqual(
      ['decision-scaling', 'finding-best_model'],
    );
    // Children (the link text) survive the rewrite.
    expect(xrefs[0].children[0].value).toBe('the finding');
  });

  it('leaves unresolvable anchors as plain link nodes', () => {
    const a = fixtureAnalysis();
    const md = 'See [missing](#findings.does_not_exist).';
    const resolved = resolveNarrativeAnchors(parseProseBlocks(md), a, 'index');
    const inline = resolved[0].children as any[];
    const links = inline.filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('#findings.does_not_exist');
  });

  it('routes sub-analysis references to relative page URLs (link nodes)', () => {
    const a = fixtureAnalysis();
    const md = 'See [pre](#analyses.preprocessing).';
    const resolved = resolveNarrativeAnchors(parseProseBlocks(md), a, 'index');
    const inline = resolved[0].children as any[];
    const links = inline.filter((c) => c.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('/preprocessing');
  });
});
