/**
 * Page-shape tests: ensure the top-level transform emits a flat
 * sequence of addressable blocks with no programmatic section
 * headings (Findings/Methods/Data Sources/Verification/Sub-Analyses).
 * The narrative drives the linear story; structural elements come
 * out as bare blocks.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { astraToMystAST, buildAllPages } from '../src/transform/index.js';
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

  it('does not infer finding↔decision relations from tag overlap', () => {
    // Tag-overlap-as-link was the same shape as the deleted
    // TAG_TO_SECTION ontology — implicit relational inference baked
    // into the renderer. Tags survive on the heading's mdast `data`
    // slot for consumers; the renderer no longer synthesises
    // crossReferences from overlap. The "depends on:" glue and
    // Methodology admonition wrapper are likewise gone.
    const a: ASTRAAnalysis = {
      ...fixture(),
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          tags: ['preprocessing'],
          options: { standard: { label: 'Standard' } },
        },
      },
      findings: {
        best_model: {
          id: 'best_model',
          claim: 'SVM wins',
          created_at: '2024-01-01',
          tags: ['preprocessing'],
          evidence: [],
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
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('This finding depends on');
    expect(flat).not.toContain('"Methodology"');

    function findAll(predicate: (n: any) => boolean): any[] {
      const out: any[] = [];
      const stack: any[] = [...ast.children];
      while (stack.length) {
        const n = stack.pop();
        if (predicate(n)) out.push(n);
        if (Array.isArray(n.children)) stack.push(...n.children);
      }
      return out;
    }
    expect(findAll((n) => n.type === 'admonition' && n.kind === 'seealso')).toHaveLength(0);

    // No tag-overlap-derived crossReference. The finding's heading
    // is the only thing rendered for the finding; the decision
    // heading still exists separately. The author wires explicit
    // relations through narrative anchors, not tag overlap.
    const findingHeading = findAll(
      (n) => n.type === 'heading' && n.identifier === 'finding-best_model',
    )[0];
    expect(findingHeading).toBeTruthy();
    expect(findingHeading.data?.tags).toEqual(['preprocessing']);

    // Walk only finding-block siblings between finding heading and
    // the next h3 / decision heading: there should be no crossRef
    // whose identifier starts with `decision-` (the previous
    // tag-overlap output).
    const idx = ast.children.indexOf(findingHeading);
    expect(idx).toBeGreaterThanOrEqual(0);
    const findingBlock: any[] = [];
    for (let i = idx; i < ast.children.length; i++) {
      const n = ast.children[i];
      if (i > idx && n.type === 'heading') break;
      findingBlock.push(n);
    }
    function collectXRefs(stack: any[]): any[] {
      const out: any[] = [];
      const queue = [...stack];
      while (queue.length) {
        const n = queue.pop();
        if (n?.type === 'crossReference') out.push(n);
        if (Array.isArray(n?.children)) queue.push(...n.children);
      }
      return out;
    }
    const xrefsInBlock = collectXRefs(findingBlock);
    expect(xrefsInBlock.every((x) => !x.identifier?.startsWith('decision-'))).toBe(true);
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

describe('tab key stability (per-transform counter)', () => {
  it('two consecutive transforms produce identical tabItem keys', () => {
    // Module-global tabKeyCounter would mint different keys each
    // call — downstream consumers diffing AST JSON saw spurious
    // changes. Per-transform closure-scoped counter fixes that.
    const a: ASTRAAnalysis = {
      name: 'WithTabs',
      decisions: {
        scaling: {
          label: 'Scaling',
          options: { a: { label: 'A' }, b: { label: 'B' } },
        },
        normalization: {
          label: 'Normalization',
          options: { x: { label: 'X' }, y: { label: 'Y' } },
        },
      },
      prior_insights: {},
      findings: {},
    };
    const args = {
      analysis: a,
      universe: { id: 'u', decisions: {} } as ASTRAUniverse,
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    };
    const ast1 = astraToMystAST(args);
    const ast2 = astraToMystAST(args);

    function collectKeys(root: any): string[] {
      const out: string[] = [];
      const stack: any[] = [...root.children];
      while (stack.length) {
        const n = stack.pop();
        if (n.type === 'tabItem' && n.key) out.push(n.key);
        if (Array.isArray(n.children)) stack.push(...n.children);
      }
      return out.sort();
    }

    expect(collectKeys(ast1)).toEqual(collectKeys(ast2));
    // Sanity: tabs were actually emitted.
    expect(collectKeys(ast1).length).toBeGreaterThan(0);
  });
});

describe('xref index (collectIdentifiers)', () => {
  // collectIdentifiers' contract: every published id has a real
  // carrier in the rendered AST. These tests pin that contract for
  // the cases that previously broke it.

  it('does not publish methods-* tag-section ids (decisions render flat)', () => {
    // Tag-as-structure ontology was deleted; renderMethodsSections
    // emits flat per-decision blocks with no h3 group headings.
    const a: ASTRAAnalysis = {
      name: 'Tagged',
      decisions: {
        scaling: {
          label: 'Scaling',
          tags: ['reddening', 'extinction'],
          options: { a: { label: 'A' } },
        },
      },
      prior_insights: {},
      findings: {},
    };
    const pages = buildAllPages(a, { id: 'u', decisions: {} }, new Map(), '/tmp');
    const ids = pages[0].identifiers.map((e) => e.identifier);
    // Old emitter would have published `reddening-extinction` and/or
    // tag-derived slugs — none of those should appear.
    expect(ids.every((id) => !id.startsWith('reddening'))).toBe(true);
    expect(ids).not.toContain('reddening-extinction');
    expect(ids).not.toContain('reddening');
  });

  it('publishes decision-<id> only for rendered decisions (skips bare from-refs)', () => {
    const a: ASTRAAnalysis = {
      name: 'Mixed',
      decisions: {
        local: { label: 'Local', options: { a: { label: 'A' } } },
        inherited: { from: 'parent.local' },
      },
      prior_insights: {},
      findings: {},
    };
    const pages = buildAllPages(a, { id: 'u', decisions: {} }, new Map(), '/tmp');
    const ids = pages[0].identifiers.map((e) => e.identifier);
    expect(ids).toContain('decision-local');
    expect(ids).not.toContain('decision-inherited');
  });

  it('publishes decision-<id> only for rendered decisions (skips when-unmet)', () => {
    // Bug D: previously `collectIdentifiers` published every
    // declared decision, but `renderDecision` dropped ones whose
    // `when` predicate wasn't satisfied — anchors landed on nothing.
    const a: ASTRAAnalysis = {
      name: 'Conditional',
      decisions: {
        always: { label: 'Always', options: { a: { label: 'A' } } },
        only_if_x: {
          label: 'Conditional',
          when: ['always.b'],
          options: { a: { label: 'A' } },
        },
      },
      prior_insights: {},
      findings: {},
    };
    // Universe selects always.a → the `when: always.b` predicate is unmet.
    const universe: ASTRAUniverse = { id: 'u', decisions: { always: 'a' } };
    const pages = buildAllPages(a, universe, new Map(), '/tmp');
    const ids = pages[0].identifiers.map((e) => e.identifier);
    expect(ids).toContain('decision-always');
    expect(ids).not.toContain('decision-only_if_x');
  });

  it('does not publish verification-* ids (success_criteria removed)', () => {
    // success_criteria was a MySTRA-private extension carried over
    // from earlier internal work; v0.0.6 doesn't define it. Ensure
    // even an analysis carrying the field at runtime (extra
    // properties tolerated) produces no verification-* xrefs.
    const a: ASTRAAnalysis = {
      name: 'WithStaleField',
      decisions: {},
      prior_insights: {},
      findings: {},
      ...({ success_criteria: [{ claim: 'x', output: 'foo' }] } as any),
    };
    const pages = buildAllPages(a, { id: 'u', decisions: {} }, new Map(), '/tmp');
    const ids = pages[0].identifiers.map((e) => e.identifier);
    expect(ids.every((id) => !id.startsWith('verification-'))).toBe(true);
  });

  it('publishes decision-<id> for when-met conditional decisions', () => {
    const a: ASTRAAnalysis = {
      name: 'Conditional',
      decisions: {
        always: { label: 'Always', options: { a: { label: 'A' } } },
        only_if_x: {
          label: 'Conditional',
          when: ['always.a'],
          options: { a: { label: 'A' } },
        },
      },
      prior_insights: {},
      findings: {},
    };
    const universe: ASTRAUniverse = { id: 'u', decisions: { always: 'a' } };
    const pages = buildAllPages(a, universe, new Map(), '/tmp');
    const ids = pages[0].identifiers.map((e) => e.identifier);
    expect(ids).toContain('decision-only_if_x');
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

  it('carries decision.tags as data.tags on the decision heading', () => {
    // Tags are no longer used as renderer-imposed grouping
    // structure; they survive on the heading's mdast `data` slot
    // for downstream consumers that want to compose grouping.
    const a: ASTRAAnalysis = {
      ...fixture(),
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          tags: ['reddening', 'extinction'],
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
    function find(predicate: (n: any) => boolean): any | undefined {
      const stack: any[] = [...ast.children];
      while (stack.length) {
        const n = stack.pop();
        if (predicate(n)) return n;
        if (Array.isArray(n.children)) stack.push(...n.children);
      }
    }
    const decisionHeading = find((n) => n.type === 'heading' && n.identifier === 'decision-scaling');
    expect(decisionHeading).toBeTruthy();
    expect(decisionHeading.data?.tags).toEqual(['reddening', 'extinction']);
  });

  it('does not emit any h3 tag-group section heading', () => {
    // tag-sections.ts is gone; "Reddening & Extinction" /
    // "TRGB Detection Algorithm" / "General" / "Other" headings
    // must not appear anywhere on the page.
    const a: ASTRAAnalysis = {
      ...fixture(),
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          tags: ['reddening'],
          options: { standard: { label: 'Standard' } },
        },
        untagged: {
          label: 'Untagged',
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
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('Reddening & Extinction');
    expect(flat).not.toContain('"General"');
    expect(flat).not.toContain('"Other"');
    // No h3 with a tag-derived id either.
    function findAll(predicate: (n: any) => boolean): any[] {
      const out: any[] = [];
      const stack: any[] = [...ast.children];
      while (stack.length) {
        const n = stack.pop();
        if (predicate(n)) out.push(n);
        if (Array.isArray(n.children)) stack.push(...n.children);
      }
      return out;
    }
    const h3s = findAll((n) => n.type === 'heading' && n.depth === 3);
    expect(h3s.every((h) => !h.identifier?.startsWith('reddening'))).toBe(true);
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

  it('sub-analysis card omits the renderer-synthesised stats string', () => {
    // "N decisions · M inputs · K outputs" was renderer-imposed
    // narration of structural data the destination page already
    // exposes. The card now contains only the sub-analysis's own
    // narrative summary (author prose).
    const a: ASTRAAnalysis = {
      ...fixture(),
      analyses: {
        preprocessing: {
          name: 'Pre',
          decisions: { x: { label: 'X', options: { a: { label: 'A' } } } },
          prior_insights: {},
          findings: {},
          inputs: [{ id: 'foo', type: 'data' }],
          outputs: [{ id: 'bar', type: 'metric' }],
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
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('decisions ·');
    expect(flat).not.toContain('inputs ·');
    expect(flat).not.toContain('outputs"');
  });

  it('does not pin renderer-imposed subtitle in page frontmatter', () => {
    // "ASTRA Analysis" subtitle was the renderer asserting content
    // type in metadata. astra-spec defines no analysis-level
    // subtitle slot; pages don't carry one unless the data does.
    const pages = buildAllPages(
      fixture(),
      { id: 'u', decisions: {} },
      new Map(),
      '/tmp',
    );
    expect(pages[0].frontmatter.subtitle).toBeUndefined();
  });

  it('sub-analysis card URL respects the host slug for nested pages', () => {
    // Bug C: parent slug `foo` → sub `bar` lives at `/foo/bar`,
    // not `/bar`. The card URL must match the recursive page
    // builder's path.
    const a: ASTRAAnalysis = {
      ...fixture(),
      analyses: {
        preprocessing: {
          name: 'Pre',
          decisions: {},
          prior_insights: {},
          findings: {},
        },
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'foo/bar',
    });
    const cards: any[] = [];
    function walk(n: any) {
      if (n.type === 'card') cards.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(cards).toHaveLength(1);
    expect(cards[0].url).toBe('/foo/bar/preprocessing');
  });

  it('sub-analysis card URL on the index slug omits the host segment', () => {
    const a: ASTRAAnalysis = {
      ...fixture(),
      analyses: {
        preprocessing: {
          name: 'Pre',
          decisions: {},
          prior_insights: {},
          findings: {},
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
    const cards: any[] = [];
    function walk(n: any) {
      if (n.type === 'card') cards.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(cards).toHaveLength(1);
    expect(cards[0].url).toBe('/preprocessing');
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

  it('end-to-end: anchor + markdown in figure-output description render and resolve', () => {
    // Figure rendering is driven by Output.type === 'figure'; the
    // caption-equivalent metadata lives on Output.description (it
    // parses with the narrative anchor grammar like every other
    // prose surface). There is no Evidence.figure selector — the
    // 'what kind' concern lives on Output, not Evidence.
    const a: ASTRAAnalysis = {
      ...fixture(),
      outputs: [
        {
          id: 'best_fit_plot',
          type: 'figure',
          label: 'Fig. 3',
          description: 'Performance versus the [iris baseline](#inputs.iris_data).',
        },
      ],
      findings: {
        best_model: {
          id: 'best_model',
          claim: 'SVM wins',
          created_at: '2024-01-01',
          evidence: [
            { id: 'ev1', artifact: 'best_fit_plot' },
          ],
        },
      },
    };
    const ast = astraToMystAST({
      analysis: a,
      universe: emptyUniverse(),
      results: new Map([['best_fit_plot', '/tmp/best_fit_plot.png']]),
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
    const flat = JSON.stringify(ast);
    expect(flat).not.toContain('[iris baseline](#inputs.iris_data)');
    expect(flat).toContain('Performance versus the');
  });
});

describe('artifact evidence dispatches on Output.type', () => {
  // Drop-in spec alignment: figure / table rendering is driven by
  // Output.type, not by an Evidence selector. label / description
  // on Output carry the caption-equivalent metadata.

  function withOutput(o: { id: string; type: 'figure' | 'table' | 'metric' | 'data' | 'report'; label?: string; description?: string }): ASTRAAnalysis {
    return {
      name: 'WithOutput',
      decisions: {},
      prior_insights: {},
      findings: {
        f1: {
          id: 'f1',
          claim: 'Result',
          created_at: '2024-01-01',
          evidence: [{ id: 'ev1', artifact: o.id }],
        },
      },
      outputs: [o],
    };
  }

  it('Output.type=figure renders an image+caption container', () => {
    const a = withOutput({
      id: 'plot',
      type: 'figure',
      label: 'Plot',
      description: 'A figure caption.',
    });
    const ast = astraToMystAST({
      analysis: a,
      universe: { id: 'u', decisions: {} },
      results: new Map([['plot', '/tmp/plot.png']]),
      projectDir: '/tmp',
      slug: 'index',
    });
    const figures: any[] = [];
    function walk(n: any) {
      if (n.type === 'container' && n.kind === 'figure') figures.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(figures).toHaveLength(1);
    const flat = JSON.stringify(figures[0]);
    expect(flat).toContain('A figure caption.');
    expect(flat).toContain('/static/plot.png');
  });

  it('Output.type=table renders a JSON file as a collapsible table', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'mystra-test-'));
    const file = join(tmpDir, 'metrics.json');
    writeFileSync(file, JSON.stringify({ accuracy: 0.95, precision: 0.92 }));
    const a = withOutput({ id: 'metrics', type: 'table', label: 'Metrics' });
    const ast = astraToMystAST({
      analysis: a,
      universe: { id: 'u', decisions: {} },
      results: new Map([['metrics', file]]),
      projectDir: tmpDir,
      slug: 'index',
    });
    const detailsNodes: any[] = [];
    function walk(n: any) {
      if (n.type === 'details') detailsNodes.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(detailsNodes.length).toBeGreaterThan(0);
    const flat = JSON.stringify(detailsNodes);
    expect(flat).toContain('accuracy');
    expect(flat).toContain('Metrics');
  });

  it('broken evidence.artifact reference (output id not declared) emits console.warn', () => {
    const a: ASTRAAnalysis = {
      name: 'Broken',
      decisions: {},
      prior_insights: {},
      findings: {
        f1: {
          id: 'f1',
          claim: 'Whatever',
          created_at: '2024-01-01',
          evidence: [{ id: 'ev1', artifact: 'nonexistent' }],
        },
      },
      outputs: [],
    };
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: any) => { warns.push(String(msg)); };
    try {
      astraToMystAST({
        analysis: a,
        universe: { id: 'u', decisions: {} },
        results: new Map(),
        projectDir: '/tmp',
        slug: 'index',
      });
    } finally {
      console.warn = orig;
    }
    expect(warns.some((w) => w.includes('nonexistent'))).toBe(true);
  });

  it('declared output but unproduced artifact still renders a Pending Output admonition', () => {
    const a = withOutput({ id: 'pending_plot', type: 'figure' });
    const ast = astraToMystAST({
      analysis: a,
      universe: { id: 'u', decisions: {} },
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const flat = JSON.stringify(ast);
    expect(flat).toContain('Pending Output');
    expect(flat).toContain('pending_plot');
  });
});

describe('prior_insights as minimal addressable carriers', () => {
  // The xref contract just requires every published id to have a
  // rendered carrier. Whether prior_insights surface as visible
  // sections, sidebars, hovers, or hide entirely is downstream's
  // call. Carrier shape: a single `container` with kind
  // `prior-insight`, identifier `prior_insight-<id>`, and
  // structured `data` — no heading, no thematic-break separators,
  // no 'Scope:' label paragraph.

  function withPriors(): ASTRAAnalysis {
    return {
      name: 'WithPriors',
      decisions: {
        scaling: {
          label: 'Feature Scaling',
          options: {
            standard: {
              label: 'Standard',
              insights: ['scaling_helps'],
            },
            minmax: {
              label: 'MinMax',
              insights: ['ghost_insight'],
            },
          },
        },
      },
      prior_insights: {
        scaling_helps: {
          id: 'scaling_helps',
          label: 'Scaling helps',
          claim: 'Standardization improves SVM convergence.',
          created_at: '2024-01-01',
          scope: 'feature_engineering',
          tags: ['preprocessing', 'svm'],
          evidence: [],
        },
        unreferenced_prior: {
          id: 'unreferenced_prior',
          claim: 'Unrelated background knowledge.',
          created_at: '2024-01-01',
          evidence: [],
        },
      },
      findings: {},
    };
  }

  it('emits a `prior-insight` container carrier for every declared prior_insight', () => {
    const ast = astraToMystAST({
      analysis: withPriors(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const carriers: any[] = [];
    function walk(n: any) {
      if (
        n.type === 'container' &&
        n.kind === 'prior-insight' &&
        n.identifier?.startsWith('prior_insight-')
      ) {
        carriers.push(n);
      }
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    const ids = carriers.map((c) => c.identifier).sort();
    expect(ids).toEqual(['prior_insight-scaling_helps', 'prior_insight-unreferenced_prior']);
  });

  it('carrier holds no heading, no thematic-break separators, no `Scope:` paragraph', () => {
    const ast = astraToMystAST({
      analysis: withPriors(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const carriers: any[] = [];
    function walk(n: any) {
      if (n.type === 'container' && n.kind === 'prior-insight') carriers.push(n);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    // No heading inside any prior_insight carrier.
    for (const c of carriers) {
      const flat = JSON.stringify(c);
      expect(flat).not.toContain('"type":"heading"');
      expect(flat).not.toContain('"type":"thematicBreak"');
      // The `Scope: …` rendered prefix is gone — scope rides on
      // `data.scope` for renderers that want to surface it.
      expect(flat).not.toContain('Scope:');
    }
    // No thematic-break sibling between the carriers either —
    // separators are a layout opinion the transform shouldn't make.
    const topLevel = ast.children.filter(
      (n: any) => n.type === 'container' && n.kind === 'prior-insight',
    );
    const idx0 = ast.children.indexOf(topLevel[0]);
    const idx1 = ast.children.indexOf(topLevel[1]);
    for (let i = idx0 + 1; i < idx1; i++) {
      expect(ast.children[i].type).not.toBe('thematicBreak');
    }
  });

  it('carrier carries structured `data` (astraKind, id, label, scope, tags, derived)', () => {
    const ast = astraToMystAST({
      analysis: withPriors(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const carriers = new Map<string, any>();
    function walk(n: any) {
      if (n.type === 'container' && n.kind === 'prior-insight') {
        carriers.set(n.identifier, n);
      }
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);

    const scaled = carriers.get('prior_insight-scaling_helps');
    expect(scaled).toBeTruthy();
    expect(scaled.class).toBe('astra astra-prior-insight');
    expect(scaled.data).toEqual({
      astraKind: 'prior_insight',
      id: 'scaling_helps',
      label: 'Scaling helps',
      scope: 'feature_engineering',
      tags: ['preprocessing', 'svm'],
      derived: false,
    });

    const unref = carriers.get('prior_insight-unreferenced_prior');
    expect(unref).toBeTruthy();
    // Optional fields collapse to `null` (not `undefined`) so the
    // shape survives a JSON round-trip without keys disappearing.
    expect(unref.data.label).toBeNull();
    expect(unref.data.scope).toBeNull();
    expect(unref.data.tags).toBeNull();
    expect(unref.data.derived).toBe(false);
  });

  it('carrier children are [claim paragraph, …evidence body]', () => {
    const ast = astraToMystAST({
      analysis: withPriors(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    let scaled: any;
    function walk(n: any) {
      if (
        n.type === 'container' &&
        n.kind === 'prior-insight' &&
        n.identifier === 'prior_insight-scaling_helps'
      ) {
        scaled = n;
      }
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(scaled).toBeTruthy();
    // First child is a paragraph wrapping the claim's inline phrasing.
    expect(scaled.children[0].type).toBe('paragraph');
    const claimText = JSON.stringify(scaled.children[0]);
    expect(claimText).toContain('Standardization improves SVM convergence');
    // Evidence body is empty for this fixture (evidence: []), so
    // children length is exactly 1. Keeps the carrier minimal.
    expect(scaled.children).toHaveLength(1);
  });

  it('an unreferenced prior_insight has a rendered carrier (xref contract)', () => {
    const a = withPriors();
    const pages = buildAllPages(a, { id: 'u', decisions: {} }, new Map(), '/tmp');
    const ids = pages[0].identifiers.map((e) => e.identifier);
    expect(ids).toContain('prior_insight-unreferenced_prior');
    // Sanity: the carrier truly exists in the AST, not just in the index.
    const ast = pages[0].ast;
    const found = JSON.stringify(ast).includes('"prior_insight-unreferenced_prior"');
    expect(found).toBe(true);
  });

  it('option.insights renders as crossReference, not inline expansion', () => {
    const ast = astraToMystAST({
      analysis: withPriors(),
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
    expect(xrefs.some((x) => x.identifier === 'prior_insight-scaling_helps')).toBe(true);

    // Only one container carrier per insight (no inline expansion
    // duplicating the identifier inside the option tab).
    const carriers: any[] = [];
    function walkCarrier(n: any) {
      if (
        n.type === 'container' &&
        n.kind === 'prior-insight' &&
        n.identifier === 'prior_insight-scaling_helps'
      ) {
        carriers.push(n);
      }
      for (const c of n.children ?? []) walkCarrier(c);
    }
    for (const n of ast.children) walkCarrier(n);
    expect(carriers).toHaveLength(1);
  });

  it('broken option.insights reference emits a console.warn (no silent drop)', () => {
    // The `ghost_insight` ref on the minmax option points at no
    // declared prior_insight — log a visible warning and skip the
    // crossReference rather than silently dropping.
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: any) => { warns.push(String(msg)); };
    try {
      astraToMystAST({
        analysis: withPriors(),
        universe: emptyUniverse(),
        results: new Map(),
        projectDir: '/tmp',
        slug: 'index',
      });
    } finally {
      console.warn = orig;
    }
    expect(warns.some((w) => w.includes('ghost_insight'))).toBe(true);
  });

  it('option-tab crossReference resolves to the carrier id (container, not heading)', () => {
    // End-to-end: a click on the supporting-insight ref should land
    // on the prior_insight container rendered elsewhere on the page.
    const ast = astraToMystAST({
      analysis: withPriors(),
      universe: emptyUniverse(),
      results: new Map(),
      projectDir: '/tmp',
      slug: 'index',
    });
    const carrierIds = new Set<string>();
    const refs = new Set<string>();
    function walk(n: any) {
      if (
        n.type === 'container' &&
        n.kind === 'prior-insight' &&
        n.identifier
      ) {
        carrierIds.add(n.identifier);
      }
      if (n.type === 'crossReference') refs.add(n.identifier);
      for (const c of n.children ?? []) walk(c);
    }
    for (const n of ast.children) walk(n);
    expect(carrierIds.has('prior_insight-scaling_helps')).toBe(true);
    expect(refs.has('prior_insight-scaling_helps')).toBe(true);
  });
});
