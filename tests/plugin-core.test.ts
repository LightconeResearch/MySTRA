/**
 * Plugin-core emission tests — self-contained, no external fixture.
 *
 * Builds a tiny but complete ASTRA project in a temp dir (its own astra.yaml,
 * universe, and result artifacts), then drives the plugin's directives, roles
 * and transforms against it and asserts the emitted mdast. Mirrors the temp-dir
 * pattern in `loader-validation.test.ts` so the suite is green in any clean
 * checkout (no `prototype/` dependency).
 *
 * The fixture exercises every surface the Strategy-A refactor introduced:
 * the seven block directives, the cite + value roles, the resolved store
 * (outputs/inputs/decisions/findings/insights/subanalyses, inlined table_data
 * and metric, project-relative image urls, universe-resolved selections), the
 * transitive provenance tracer (cross-scope inputs_root / decisions_transitive
 * with universe narrowing), and the astra.yaml/universe mtime cache.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import plugin from '../src/index.js';
import { buildResolvedStore } from '../src/transform/resolved-store.js';
import { traceProvenance, pageFrames } from '../src/transform/provenance.js';

// ── Fixture project ──────────────────────────────────────────────────────

// Decisions: `method` is overridden by the universe to `grid` (≠ its `mcmc`
// default) so we can prove the universe selection wins. The sub-analysis owns
// `sub_decision` (narrowed to `beta` only inside the sub scope) and an
// `inherited_method` aliased to the root via `from: ../method`.
const ASTRA_YAML = `version: "1.0"
name: Test Analysis
authors: [Tester]
narrative:
  summary: |
    A minimal analysis for tests. ![Scatter](#outputs.scatter_plot)
  inputs: |
    Uses the [raw catalog](#inputs.raw_catalog).
  methods: |
    Driven by the [fit method](#decisions.method); see
    [the sub-analysis](#analyses.sub).
  outputs: |
    Produces [measurements](#outputs.measurements).
  findings: |
    We report [a detection](#findings.signal_detected).
decisions:
  method:
    label: "Fit method"
    rationale: |
      Why we pick this estimator.
    default: mcmc
    options:
      mcmc:
        label: "MCMC sampling"
        insights: [prior_literature_result]
      grid:
        label: "Grid search"
prior_insights:
  prior_literature_result:
    label: "Prior literature result"
    claim: "An earlier paper established the effect."
    evidence:
      - id: e1
        doi: "10.1234/example.doi"
        quote:
          exact: "The effect is established at high significance."
inputs:
  - id: raw_catalog
    type: data
    label: "Raw catalog"
    description: "The raw input catalog."
    source: "data/raw.fits"
outputs:
  - id: scatter_plot
    type: figure
    label: "Scatter plot"
    description: "Scatter of the measurements."
    inputs: [raw_catalog]
    decisions: [method]
    recipe:
      command: "python plot.py {output}"
      container: "astro:1"
  - id: measurements
    type: table
    label: "Measurement table"
    description: "Best-fit values per tracer."
    inputs: [sub.sub_table]
    decisions: [method]
    recipe:
      command: "python measure.py {output}"
  - id: summary_metric
    type: metric
    label: "Summary metric"
    description: "A single summary number."
    inputs: [measurements]
    recipe:
      command: "python summarize.py {output}"
  - id: aliased_plot
    type: figure
    from: sub.sub_plot
findings:
  signal_detected:
    label: "Signal detected"
    claim: "We detect the signal at high significance."
    notes: |
      The peak is clear in every realisation.
    scope: "baseline universe"
    evidence:
      - id: f1
        artifact: scatter_plot
        quote:
          exact: "A clear peak appears."
analyses:
  sub:
    name: "Sub Analysis"
    narrative:
      summary: |
        A nested sub-analysis.
    decisions:
      sub_decision:
        label: "Sub decision"
        default: alpha
        options:
          alpha: { label: "Alpha", insights: [prior_literature_result] }
          beta: { label: "Beta" }
      inherited_method:
        from: ../method
    inputs:
      - id: sub_raw
        type: data
        from: raw_catalog
    outputs:
      - id: sub_table
        type: table
        label: "Sub table"
        inputs: [sub_raw]
        decisions: [sub_decision, inherited_method]
        recipe:
          command: "python sub.py {output}"
      - id: sub_plot
        type: figure
        label: "Sub plot"
        inputs: [sub_raw]
        decisions: [sub_decision]
        recipe:
          command: "python subplot.py {output}"
`;

// Universe: `method` → grid (overrides the mcmc default); `sub_decision` is
// alpha at the root level but narrowed to beta inside the sub scope, so we can
// prove per-scope universe narrowing in the provenance tracer.
const BASELINE_YAML = `id: baseline
description: Baseline test universe.
decisions:
  method: grid
  sub_decision: alpha
analyses:
  sub:
    decisions:
      sub_decision: beta
`;

const MEASUREMENTS_CSV = `tracer,value,value_std
lrg,19.88,0.17
elg,0.0696,0.002
`;

/** Write `dir/results/baseline/<id>/<file>` with `content`. */
function writeResult(root: string, id: string, file: string, content: string): void {
  const dir = join(root, 'results', 'baseline', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** Build the full fixture project under a fresh temp dir and return its path. */
function buildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'mystra-core-'));
  writeFileSync(join(root, 'astra.yaml'), ASTRA_YAML);
  mkdirSync(join(root, 'universes'), { recursive: true });
  writeFileSync(join(root, 'universes', 'baseline.yaml'), BASELINE_YAML);
  // Result artifacts. PNG bytes are irrelevant (only the path is read for
  // figures); the CSV/JSON are parsed for table_data / metric / value.
  writeResult(root, 'scatter_plot', 'scatter_plot.png', 'PNG');
  writeResult(root, 'measurements', 'measurements.csv', MEASUREMENTS_CSV);
  writeResult(root, 'summary_metric', 'summary_metric.json', JSON.stringify({ value: 1.5, uncertainty: 0.3, unit: 'Mpc' }));
  writeResult(root, 'aliased_plot', 'aliased_plot.png', 'PNG');
  writeResult(root, 'sub_table', 'sub_table.csv', MEASUREMENTS_CSV);
  writeResult(root, 'sub_plot', 'sub_plot.png', 'PNG');
  return root;
}

let PROJECT_ROOT: string;

beforeAll(() => {
  PROJECT_ROOT = buildFixture();
  process.env.ASTRA_PROJECT_ROOT = PROJECT_ROOT;
  delete process.env.ASTRA_UNIVERSE;
});

afterAll(() => {
  if (PROJECT_ROOT) rmSync(PROJECT_ROOT, { recursive: true, force: true });
  delete process.env.ASTRA_PROJECT_ROOT;
});

// ── mdast helpers ─────────────────────────────────────────────────────────

type Node = Record<string, any>;

function walk(nodes: Node[] | Node, visit: (n: Node) => void): void {
  const arr = Array.isArray(nodes) ? nodes : [nodes];
  for (const n of arr) {
    if (!n || typeof n !== 'object') continue;
    visit(n);
    if (Array.isArray(n.children)) walk(n.children, visit);
  }
}
function findFirst(nodes: Node[], pred: (n: Node) => boolean): Node | undefined {
  let found: Node | undefined;
  walk(nodes, (n) => {
    if (!found && pred(n)) found = n;
  });
  return found;
}
function hasClass(n: Node | undefined, cls: string): boolean {
  return typeof n?.class === 'string' && n.class.split(/\s+/).includes(cls);
}
function byIdentifier(nodes: Node[], id: string): Node | undefined {
  return findFirst(nodes, (n) => n.identifier === id);
}
function textOf(nodes: Node[] | Node): string {
  let out = '';
  walk(nodes, (n) => {
    if (n.type === 'text' && typeof n.value === 'string') out += n.value;
  });
  return out;
}

function directive(name: string) {
  const d = plugin.directives.find((x: any) => x.name === `astra:${name}`);
  if (!d) throw new Error(`no directive astra:${name}`);
  return d;
}
function role(name: string) {
  const r = plugin.roles.find((x: any) => x.name === `astra:${name}`);
  if (!r) throw new Error(`no role astra:${name}`);
  return r;
}
function runDirective(name: string, arg?: string, options: Record<string, any> = {}): Node[] {
  return (directive(name) as any).run({ arg, options }) as Node[];
}
function runRole(name: string, body: string): Node[] {
  return (role(name) as any).run({ body }) as Node[];
}
function runStore(path: string): Record<string, any> {
  const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
  const tree: Node = { type: 'root', children: [] };
  (t as any).plugin()(tree, { path });
  const carrier = tree.children.find((n: any) => n.class === 'astra-store');
  if (!carrier) throw new Error('no astra-store carrier emitted');
  return carrier.data.astra;
}

// ── Block directives ──────────────────────────────────────────────────────

describe('block directives', () => {
  it('decision → tabSet carrier tagged astra-decision with identifier', () => {
    const nodes = runDirective('decision', 'method');
    const carrier = byIdentifier(nodes, 'decision-method');
    expect(carrier).toBeDefined();
    expect(hasClass(carrier, 'astra-decision')).toBe(true);
    expect(findFirst(nodes, (n) => n.type === 'tabSet')).toBeDefined();
    // selected option (grid, per universe) is reordered to the first tab
    const firstTab = findFirst(nodes, (n) => n.type === 'tabItem');
    expect(firstTab?.title).toContain('Grid search');
    expect(JSON.stringify(nodes)).not.toContain('/static/');
  });

  it('figure output → container[figure] with project-relative image url + markers', () => {
    const nodes = runDirective('output', 'scatter_plot');
    const carrier = byIdentifier(nodes, 'output-scatter_plot');
    expect(carrier?.type).toBe('container');
    expect(carrier?.kind).toBe('figure');
    expect(hasClass(carrier, 'astra-output')).toBe(true);
    expect(hasClass(carrier, 'astra-output--figure')).toBe(true);
    const image = findFirst(nodes, (n) => n.type === 'image');
    expect(image?.url).toBe('results/baseline/scatter_plot/scatter_plot.png');
    expect(image?.url.startsWith('/static/')).toBe(false);
  });

  it('table output → container[table] tagged astra-output--table', () => {
    const nodes = runDirective('output', 'measurements');
    const carrier = byIdentifier(nodes, 'output-measurements');
    expect(carrier?.type).toBe('container');
    expect(carrier?.kind).toBe('table');
    expect(hasClass(carrier, 'astra-output--table')).toBe(true);
    expect(findFirst(nodes, (n) => n.type === 'table')).toBeDefined();
  });

  it('metric output → carrier tagged astra-output--metric with identifier', () => {
    const nodes = runDirective('output', 'summary_metric');
    const carrier = byIdentifier(nodes, 'output-summary_metric');
    expect(carrier).toBeDefined();
    expect(hasClass(carrier, 'astra-output--metric')).toBe(true);
  });

  it('aliased output (from: sub.sub_plot) resolves the source type → figure', () => {
    const nodes = runDirective('output', 'aliased_plot');
    const carrier = byIdentifier(nodes, 'output-aliased_plot');
    expect(carrier?.kind).toBe('figure');
    expect(hasClass(carrier, 'astra-output--figure')).toBe(true);
  });

  it('finding → astra-finding carrier; evidence image is project-relative', () => {
    const nodes = runDirective('finding', 'signal_detected');
    const carrier = byIdentifier(nodes, 'finding-signal_detected');
    expect(carrier).toBeDefined();
    expect(hasClass(carrier, 'astra-finding')).toBe(true);
    // evidence figure went through rewriteStaticImages → no /static scheme
    expect(JSON.stringify(nodes)).not.toContain('/static/');
  });

  it('finding :compact: → heading + scope, no evidence figure', () => {
    const nodes = runDirective('finding', 'signal_detected', { compact: true });
    expect(byIdentifier(nodes, 'finding-signal_detected')).toBeDefined();
    expect(findFirst(nodes, (n) => n.type === 'image')).toBeUndefined();
    expect(textOf(nodes)).toContain('baseline universe');
  });

  it('prior-insight → seealso admonition tagged astra-prior-insight', () => {
    const nodes = runDirective('prior-insight', 'prior_literature_result');
    const adm = findFirst(nodes, (n) => n.type === 'admonition');
    expect(adm?.kind).toBe('seealso');
    expect(hasClass(adm, 'astra-prior-insight')).toBe(true);
    expect(adm?.identifier).toBe('prior_insight-prior_literature_result');
  });

  it('subanalysis → card linking to the sub-page, tagged astra-subanalysis', () => {
    const nodes = runDirective('subanalysis', 'sub');
    const carrier = byIdentifier(nodes, 'analysis-sub');
    expect(carrier?.type).toBe('card');
    expect(hasClass(carrier, 'astra-subanalysis')).toBe(true);
    expect(carrier?.url).toBe('/sub');
    expect(carrier?.title).toBe('Sub Analysis');
  });

  it('inputs / outputs tables carry their registry classes', () => {
    expect(hasClass(runDirective('inputs')[0], 'astra-inputs')).toBe(true);
    expect(hasClass(runDirective('outputs')[0], 'astra-outputs')).toBe(true);
  });

  it('a bare from-reference decision yields an error admonition (not a render)', () => {
    const nodes = runDirective('decision', 'sub.inherited_method');
    expect(nodes[0].type).toBe('admonition');
    expect(nodes[0].kind).toBe('error');
  });

  it('an unknown component id yields an error admonition', () => {
    const nodes = runDirective('output', 'no_such_output');
    expect(nodes[0].kind).toBe('error');
  });
});

// ── Scoped sub-analysis resolution ──────────────────────────────────────────

describe('sub-analysis scope', () => {
  it('resolves a scoped table output (sub.sub_table)', () => {
    const nodes = runDirective('output', 'sub.sub_table');
    expect(byIdentifier(nodes, 'output-sub_table')?.kind).toBe('table');
  });

  it('resolves a scoped decision (sub.sub_decision)', () => {
    const nodes = runDirective('decision', 'sub.sub_decision');
    expect(byIdentifier(nodes, 'decision-sub_decision')).toBeDefined();
  });
});

// ── Inline roles ────────────────────────────────────────────────────────────

describe('inline roles', () => {
  it('cite role → neutral astra-ref token carrying the store join key', () => {
    const [token] = runRole('decision', 'method');
    expect(hasClass(token, 'astra-ref')).toBe(true);
    expect(hasClass(token, 'astra-ref--decision')).toBe(true);
    expect(token.data?.astra).toEqual({ kind: 'decision', id: 'method', path: 'method' });
  });

  it('output cite carries the output subtype modifier class', () => {
    const [token] = runRole('output', 'scatter_plot');
    expect(hasClass(token, 'astra-ref--output')).toBe(true);
    expect(hasClass(token, 'astra-ref--figure')).toBe(true);
  });

  it('cite role honours a |display override for the inline label', () => {
    const [token] = runRole('prior-insight', 'prior_literature_result|the prior');
    expect(textOf([token])).toBe('the prior');
    expect(token.data?.astra?.id).toBe('prior_literature_result');
    expect(token.data?.astra?.kind).toBe('prior_insight');
  });

  it('analysis cite resolves to the subanalyses store table', () => {
    const [token] = runRole('analysis', 'sub');
    expect(token.data?.astra).toMatchObject({ kind: 'analysis', id: 'sub' });
    expect(runStore('index.md').subanalyses['sub']).toBeDefined();
  });

  it('finding cite join key resolves in the store', () => {
    const [token] = runRole('finding', 'signal_detected');
    expect(runStore('index.md').findings[token.data.astra.id]).toBeDefined();
  });

  it('scoped cite (sub.sub_table) keeps the dotted path', () => {
    const [token] = runRole('output', 'sub.sub_table');
    expect(token.data?.astra).toMatchObject({ id: 'sub_table', path: 'sub.sub_table' });
  });
});

// ── Value interpolation role ────────────────────────────────────────────────

describe('value role', () => {
  it('interpolates a real cell with ± uncertainty (pm convention)', () => {
    const [token] = runRole('value', 'measurements tracer=lrg col=value pm');
    expect(textOf([token])).toBe('19.88 ± 0.17');
    expect(token.data?.astra).toMatchObject({ kind: 'value', id: 'measurements', col: 'value' });
  });

  it('honours an explicit err=<col>', () => {
    const [token] = runRole('value', 'measurements tracer=lrg col=value err=value_std');
    expect(textOf([token])).toBe('19.88 ± 0.17');
  });

  it('formats to significant figures without ±', () => {
    expect(textOf(runRole('value', 'measurements tracer=elg col=value'))).toBe('0.0696');
  });

  it('respects sig=N', () => {
    expect(textOf(runRole('value', 'measurements tracer=lrg col=value sig=2'))).toBe('20');
  });

  it('resolves a scoped product (sub.sub_table)', () => {
    expect(textOf(runRole('value', 'sub.sub_table tracer=lrg col=value'))).toBe('19.88');
  });

  it('surfaces a clear error for a missing column', () => {
    const [node] = runRole('value', 'measurements tracer=lrg col=not_a_column');
    expect(node.type).toBe('inlineCode');
    expect(node.value).toContain('value');
  });

  it('surfaces a clear error for a non-matching row filter', () => {
    const [node] = runRole('value', 'measurements tracer=ghost col=value');
    expect(node.type).toBe('inlineCode');
  });
});

// ── Resolved store transform ─────────────────────────────────────────────────

describe('resolved-store transform', () => {
  it('emits a hidden carrier with the resolved model keyed by id (root scope)', () => {
    const store = runStore('index.md');

    const fig = store.outputs['scatter_plot'];
    expect(fig.type).toBe('figure');
    expect(fig.resolved_path).toBe('results/baseline/scatter_plot/scatter_plot.png');
    expect(fig.recipe).toMatchObject({ command: 'python plot.py {output}', container: 'astro:1' });

    const tbl = store.outputs['measurements'];
    expect(tbl.type).toBe('table');
    expect(tbl.table_data?.headers).toContain('value');

    const metric = store.outputs['summary_metric'];
    expect(metric.metric).toMatchObject({ value: 1.5, uncertainty: 0.3, unit: 'Mpc' });

    // universe selection wins over the declared default (mcmc → grid)
    expect(store.decisions['method'].selected).toBe('grid');
    expect(store.decisions['method'].options).toMatchObject({ grid: 'Grid search' });

    // input, finding, insight, subanalysis presence
    expect(store.inputs['raw_catalog'].label).toBe('Raw catalog');
    expect(store.findings['signal_detected']).toBeDefined();
    expect(store.prior_insights['prior_literature_result'].doi).toBe('10.1234/example.doi');
    expect(store.subanalyses['sub'].url).toBe('/sub');
  });

  it('serializes finding evidence and strips the universe clause from scope', () => {
    const finding = runStore('index.md').findings['signal_detected'];
    expect(finding.evidence).toEqual([
      { artifact: 'scatter_plot', doi: undefined, quote: 'A clear peak appears.' },
    ]);
    // the authored scope was ONLY the universe clause → dropped entirely
    expect(finding.scope).toBeUndefined();
  });

  it('serializes option insights on decisions that cite them', () => {
    const sub = runStore('sub.md');
    // beta cites nothing → omitted from the record entirely
    expect(sub.decisions['sub_decision'].option_insights).toEqual({
      alpha: ['prior_literature_result'],
    });
    // the root `method` decision cites an insight on its mcmc option
    const root = runStore('index.md');
    expect(root.decisions['method'].option_insights).toEqual({
      mcmc: ['prior_literature_result'],
    });
  });

  it('emits a hidden astra-assets carrier routing result images through the asset pipeline', () => {
    const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (t as any).plugin()(tree, { path: 'index.md' });
    const assets = tree.children.find((n: any) => n.class === 'astra-assets');
    expect(assets?.style).toEqual({ display: 'none' });
    const img = assets!.children.find((n: any) => n.data?.astraAsset === 'scatter_plot');
    expect(img).toMatchObject({
      type: 'image',
      url: 'results/baseline/scatter_plot/scatter_plot.png',
    });
  });

  it('the carrier is an invisible div on book-theme', () => {
    const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (t as any).plugin()(tree, { path: 'index.md' });
    const carrier = tree.children.find((n: any) => n.class === 'astra-store');
    expect(carrier?.style).toEqual({ display: 'none' });
  });

  it('emits a hidden astra-cites carrier with narrative + parenthetical cites per DOI', () => {
    const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (t as any).plugin()(tree, { path: 'index.md' });
    const cites = tree.children.find((n: any) => n.class === 'astra-cites');
    expect(cites?.style).toEqual({ display: 'none' });
    const nodes = cites!.children[0].children;
    expect(nodes.map((c: any) => [c.label, c.kind])).toEqual([
      ['10.1234/example.doi', 'narrative'],
      ['10.1234/example.doi', 'parenthetical'],
    ]);
    expect(nodes.every((c: any) => c.type === 'cite')).toBe(true);
  });

  it('scopes the store to a sub-analysis page (dotted basename)', () => {
    const store = runStore('sub.md');
    expect(store.analysis.slug).toBe('sub');
    expect(store.outputs['sub_table']).toBeDefined();
    // sub_decision is narrowed to beta inside the sub scope
    expect(store.decisions['sub_decision'].selected).toBe('beta');
    // the bare-from inherited_method has no carrier → not in the store
    expect(store.decisions['inherited_method']).toBeUndefined();
  });
});

// ── Dotted-filename page-scope derivation ────────────────────────────────────

describe('dotted-filename page scope', () => {
  it('index.md maps to the root scope', () => {
    expect(runStore('index.md').analysis.slug).toBe('index');
  });
  it('a trailing dot is tolerated and still resolves the scope', () => {
    expect(runStore('sub..md').analysis.slug).toBe('sub');
  });
  it('a non-ASTRA basename yields no store carrier (null scope)', () => {
    const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (t as any).plugin()(tree, { path: 'not_an_analysis.md' });
    expect(tree.children.find((n: any) => n.class === 'astra-store')).toBeUndefined();
  });
});

// ── Decision option-tab supporting insights (store-driven refs) ──────────────

describe('decision option-tab supporting insights', () => {
  it('emits store-driven astra-ref tokens, not native crossReferences', () => {
    const nodes = runDirective('decision', 'method');
    const tok = findFirst(nodes, (n) => hasClass(n, 'astra-ref--prior_insight'));
    expect(tok?.data?.astra).toMatchObject({ kind: 'prior_insight', id: 'prior_literature_result' });
    expect(
      findFirst(nodes, (n) => n.type === 'crossReference' && String(n.identifier).startsWith('prior_insight-')),
    ).toBeUndefined();
  });
});

// ── Transitive provenance (through the store) ────────────────────────────────

describe('transitive provenance', () => {
  it('traces inputs_root and decisions_transitive across scopes with narrowing', () => {
    const out = runStore('index.md').outputs['measurements'];

    // root input reached through the dotted cross-link (sub.sub_table) and the
    // sub's `from: raw_catalog` input alias
    expect(out.inputs_root.map((i: any) => i.id)).toEqual(['raw_catalog']);

    const byId = Object.fromEntries(out.decisions_transitive.map((d: any) => [d.id, d]));
    // direct decision on the output: no `via`, universe selection resolved
    expect(byId['method']).toMatchObject({ via: undefined, selection: 'Grid search' });
    // picked up inside the sub scope: `via` set, narrowed selection (beta)
    expect(byId['sub_decision']).toMatchObject({ via: 'sub', selection: 'Beta' });
    // method appears exactly once despite also being reached via ../method alias
    expect(out.decisions_transitive.filter((d: any) => d.id === 'method')).toHaveLength(1);
  });
});

// ── Provenance unit: multi-level ../ decision alias ──────────────────────────

describe('traceProvenance ../ traversal', () => {
  it('climbs one scope per ../ for a multi-level decision alias', () => {
    const root: any = {
      decisions: { deep: { label: 'Deep', default: 'd1', options: { d1: { label: 'Deep One' } } } },
      inputs: [],
      outputs: [],
      analyses: {},
    };
    const mid: any = { decisions: {}, inputs: [], outputs: [], analyses: {} };
    const leaf: any = {
      decisions: { esc: { from: '../../deep' } },
      inputs: [],
      outputs: [{ id: 'leaf_out', type: 'metric', decisions: ['esc'], inputs: [], recipe: { command: 'x' } }],
      analyses: {},
    };
    const rootU: any = {
      decisions: { deep: 'd1' },
      analyses: { mid: { decisions: {}, analyses: { leaf: { decisions: {} } } } },
    };
    const frame = pageFrames([root, mid, leaf], rootU, ['mid', 'leaf']);
    const traced = traceProvenance(leaf.outputs[0], frame);

    // `../../deep` must resolve in root (two levels up), not collapse to one climb
    expect(traced.decisions_transitive).toEqual([
      { id: 'deep', label: 'Deep', selection: 'Deep One', via: 'root' },
    ]);
  });
});

// ── buildResolvedStore direct call (no transform / no env) ───────────────────

describe('buildResolvedStore (direct)', () => {
  it('builds a keyed store from a minimal Analysis with no result files', () => {
    const analysis: any = {
      id: 'mini',
      name: 'Mini',
      decisions: { d: { label: 'D', default: 'x', options: { x: { label: 'X' }, y: { label: 'Y' } } } },
      inputs: [{ id: 'in', type: 'data', label: 'In' }],
      outputs: [{ id: 'o', type: 'figure', label: 'O', inputs: ['in'], decisions: ['d'], recipe: { command: 'c' } }],
      findings: {},
      prior_insights: {},
      analyses: {},
    };
    const universe: any = { id: 'u', decisions: { d: 'y' } };
    const store = buildResolvedStore(analysis, universe, () => undefined, 'index', (p) => p);
    expect(store.outputs['o'].resolved_path).toBeUndefined(); // no artifact on disk
    expect(store.outputs['o'].decisions).toEqual(['d']);
    expect(store.decisions['d'].selected).toBe('y'); // universe override
    expect(store.inputs['in'].label).toBe('In');
  });
});

// ── astra.yaml / universe mtime cache freshness ──────────────────────────────

describe('source cache freshness', () => {
  let tmpRoot: string;

  afterEach(() => {
    process.env.ASTRA_PROJECT_ROOT = PROJECT_ROOT;
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function storeSlug(): string {
    return runStore('index.md').analysis.slug;
  }

  it('reuses the cache for an unchanged mtime and re-reads after the universe file advances', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mystra-reload-'));
    cpSync(PROJECT_ROOT, tmpRoot, { recursive: true });
    process.env.ASTRA_PROJECT_ROOT = tmpRoot;

    expect(storeSlug()).toBe('index'); // populate
    expect(storeSlug()).toBe('index'); // cache hit

    // Advancing the *universe* file (not astra.yaml) must also bust the cache.
    const uni = join(tmpRoot, 'universes', 'baseline.yaml');
    const future = statSync(uni).mtimeMs / 1000 + 100;
    utimesSync(uni, future, future);
    expect(storeSlug()).toBe('index'); // re-parse still yields a valid store
  });
});
