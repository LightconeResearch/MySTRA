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
    expect(xrefs.some((x) => x.identifier === 'scaling')).toBe(true);
  });
});
