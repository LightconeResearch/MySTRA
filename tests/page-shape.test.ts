/**
 * Page-shape tests: ensure the top-level transform emits a flat
 * sequence of addressable blocks with no programmatic section
 * headings (Findings/Methods/Data Sources/Verification/Sub-Analyses).
 * The narrative drives the linear story; structural elements come
 * out as bare blocks.
 */

import { describe, it, expect } from 'vitest';
import { astraToMystAST } from '../src/transform/index.js';
import type { ASTRAAnalysis, ASTRAUniverse } from '../src/types/astra.js';

function emptyUniverse(): ASTRAUniverse {
  return { id: 'baseline', decisions: {} };
}

function fixture(): ASTRAAnalysis {
  return {
    name: 'Test Analysis',
    narrative: {
      summary: 'A summary paragraph.',
      methods: 'Some methodology prose with [scaling](#decisions.scaling) link.',
    },
    decisions: {
      scaling: {
        label: 'Feature Scaling',
        rationale: 'Why this matters.',
        options: { standard: { label: 'Standard' } },
      },
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
    inputs: [{ id: 'iris_data', type: 'data', description: 'Iris dataset' }],
    outputs: [{ id: 'accuracy', type: 'metric' }],
  };
}

describe('astraToMystAST page shape', () => {
  it('emits no programmatic h2 section headings', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const sectionHeadings = ast.children
      .filter((n: any) => n.type === 'heading' && n.depth === 2)
      .map((n: any) => n.identifier);
    // None of the legacy section identifiers should appear at the
    // top level of the page.
    expect(sectionHeadings).not.toContain('findings');
    expect(sectionHeadings).not.toContain('methods');
    expect(sectionHeadings).not.toContain('data-sources');
    expect(sectionHeadings).not.toContain('verification');
    expect(sectionHeadings).not.toContain('sub-analyses');
  });

  it('renders all narrative sections in declaration order', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    // Narrative chunks come before structural elements; the
    // summary block should appear before any decision/finding
    // heading.
    const firstNarrativeIdx = ast.children.findIndex(
      (n: any) => n.identifier?.startsWith('narrative-'),
    );
    const firstFindingIdx = ast.children.findIndex(
      (n: any) =>
        n.type === 'heading' && n.identifier?.startsWith('finding-'),
    );
    expect(firstNarrativeIdx).toBeGreaterThan(-1);
    expect(firstFindingIdx).toBeGreaterThan(firstNarrativeIdx);
  });

  it('emits each narrative section as an addressable block', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const narrativeIds = ast.children
      .map((n: any) => n.identifier)
      .filter((id: string | undefined) => id?.startsWith('narrative-'));
    // Fixture has summary + methods only; both should appear, no
    // others, in declaration order.
    expect(narrativeIds).toEqual(['narrative-summary', 'narrative-methods']);
  });

  it('does not wrap narrative sections in a container or heading', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    // No `container` node with kind narrative-* — chunks live as
    // bare paragraphs/headings carrying the identifier directly.
    const narrativeContainers = ast.children.filter(
      (n: any) =>
        n.type === 'container' && (n.kind ?? '').startsWith('narrative-'),
    );
    expect(narrativeContainers).toHaveLength(0);
  });

  it('skips empty-state placeholders', () => {
    const empty: ASTRAAnalysis = {
      name: 'Empty',
      decisions: {},
      prior_insights: {},
      findings: {},
    };
    const ast = astraToMystAST({
      analysis: empty,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    // No "No findings recorded" / "No inputs declared" / etc. text.
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('No findings recorded');
    expect(flat).not.toContain('No inputs declared');
    expect(flat).not.toContain('No success criteria defined');
  });

  it('does not emit a renderer-imposed methods intro paragraph', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    // The legacy intro ("The following sections detail each
    // methodological decision…") claimed alternative options
    // could be explored via tabs — no longer true under the flat
    // addressable-elements layout.
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('The following sections detail');
    expect(flat).not.toContain('alternative options can be explored');
  });

  it('resolves narrative anchors against the host analysis', () => {
    // The methods section in the fixture contains a link to
    // `#decisions.scaling`; that should be a crossReference in the
    // emitted AST.
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const xrefs: any[] = [];
    function walk(n: any) {
      if (n.type === 'crossReference') xrefs.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(xrefs.some((x) => x.identifier === 'decision-scaling')).toBe(true);
  });
});

describe('structural-element identifiers (end-to-end)', () => {
  it('emits a finding-<id> heading for each finding', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    function find(predicate: (n: any) => boolean): any | undefined {
      const stack: any[] = [...ast.children];
      while (stack.length) {
        const n = stack.pop();
        if (predicate(n)) return n;
        if (Array.isArray(n.children)) stack.push(...n.children);
      }
    }
    expect(find((n) => n.type === 'heading' && n.identifier === 'finding-best_model')).toBeTruthy();
  });

  it('emits a decision-<id> heading for each decision', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    function find(predicate: (n: any) => boolean): any | undefined {
      const stack: any[] = [...ast.children];
      while (stack.length) {
        const n = stack.pop();
        if (predicate(n)) return n;
        if (Array.isArray(n.children)) stack.push(...n.children);
      }
    }
    expect(find((n) => n.type === 'heading' && n.identifier === 'decision-scaling')).toBeTruthy();
  });

  it('attaches an input-<id> identifier to each input table row', () => {
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const ids: string[] = [];
    function walk(n: any) {
      if (n.type === 'tableRow' && n.identifier) ids.push(n.identifier);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(ids).toContain('input-iris_data');
  });

  it('attaches an output-<id> identifier to each output table row (no evidence)', () => {
    // Bug A: every declared output must have a carrier, even with
    // no evidence pointing at it from a finding.
    const ast = astraToMystAST({
      analysis: fixture(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const ids: string[] = [];
    function walk(n: any) {
      if (n.type === 'tableRow' && n.identifier) ids.push(n.identifier);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(ids).toContain('output-accuracy');
  });

  it('emits output-<id> carrier for non-image artifacts (CSV, JSON, plain)', () => {
    // Bug A: previously only image artifact evidence carried
    // `output-<id>`; JSON/CSV/plain artifacts (and outputs without
    // evidence) had no carrier and broke xrefs.
    const a: ASTRAAnalysis = {
      ...fixture(),
      outputs: [
        { id: 'metrics_json', type: 'data' },
        { id: 'sample_csv', type: 'table' },
        { id: 'plain_blob', type: 'data' },
        { id: 'no_evidence', type: 'metric' },
      ],
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const ids: string[] = [];
    function walk(n: any) {
      if (n.type === 'tableRow' && n.identifier) ids.push(n.identifier);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(ids).toContain('output-metrics_json');
    expect(ids).toContain('output-sample_csv');
    expect(ids).toContain('output-plain_blob');
    expect(ids).toContain('output-no_evidence');
  });

  it('end-to-end: narrative anchor #inputs.<id> resolves to a crossReference on the input identifier', () => {
    const a: ASTRAAnalysis = {
      ...fixture(),
      narrative: {
        methods: 'Use the [iris dataset](#inputs.iris_data) directly.',
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const xrefs: any[] = [];
    function walk(n: any) {
      if (n.type === 'crossReference') xrefs.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(xrefs.some((x) => x.identifier === 'input-iris_data')).toBe(true);
  });

  it('end-to-end: anchor in Option.description resolves into the page output', () => {
    // Option descriptions are non-narrative prose. With the
    // resolution context threaded through every render-* helper,
    // the narrative grammar works here too.
    const a: ASTRAAnalysis = {
      ...fixture(),
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          options: {
            standard: {
              label: 'Standard',
              description: 'Scales features; supports the [SVM finding](#findings.best_model).',
            },
          },
        },
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const xrefs: any[] = [];
    function walk(n: any) {
      if (n.type === 'crossReference') xrefs.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(xrefs.some((x) => x.identifier === 'finding-best_model')).toBe(true);
  });

  it('end-to-end: anchor in Decision.rationale resolves into the page output', () => {
    const a: ASTRAAnalysis = {
      ...fixture(),
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          rationale: 'Driven by the [iris dataset](#inputs.iris_data) characteristics.',
          options: { standard: { label: 'Standard' } },
        },
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const xrefs: any[] = [];
    function walk(n: any) {
      if (n.type === 'crossReference') xrefs.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(xrefs.some((x) => x.identifier === 'input-iris_data')).toBe(true);
  });

  it('end-to-end: anchor + markdown in Option.excluded_reason render and resolve', () => {
    const a: ASTRAAnalysis = {
      ...fixture(),
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          options: {
            minmax: {
              label: 'MinMax',
              excluded: true,
              excluded_reason: 'Conflicts with **SVM**; see [the finding](#findings.best_model).',
            },
          },
        },
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const xrefs: any[] = [];
    const strongs: any[] = [];
    function walk(n: any) {
      if (n.type === 'crossReference') xrefs.push(n);
      if (n.type === 'strong') strongs.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(xrefs.some((x) => x.identifier === 'finding-best_model')).toBe(true);
    expect(strongs.length).toBeGreaterThan(0);
    // Renderer-glued "Excluded:" prefix is gone.
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('Excluded:');
  });

  it('end-to-end: anchor + markdown in figure caption render and resolve', () => {
    const a: ASTRAAnalysis = {
      ...fixture(),
      findings: {
        best_model: {
          id: 'best_model',
          claim: 'SVM wins',
          created_at: '2024-01-01',
          evidence: [
            {
              id: 'ev1',
              doi: '10.1234/foo',
              figure: {
                type: 'FigureSelector',
                label: 'Fig. 3',
                caption: 'Performance versus the [iris baseline](#inputs.iris_data).',
              },
            },
          ],
        },
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const xrefs: any[] = [];
    function walk(n: any) {
      if (n.type === 'crossReference') xrefs.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(xrefs.some((x) => x.identifier === 'input-iris_data')).toBe(true);
    // Caption is no longer glued via string interpolation — the
    // text "Performance versus the [iris baseline]" should
    // never appear as a single text node, because the anchor
    // is now a crossReference. Search for the unsplit phrase
    // including the link syntax to confirm migration.
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('[iris baseline](#inputs.iris_data)');
    // Sanity: the leading caption text is parsed and present.
    expect(flat).toContain('Performance versus the');
  });
});
