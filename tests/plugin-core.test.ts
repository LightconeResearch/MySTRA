/**
 * Plugin-core emission tests — self-contained, no external fixture.
 *
 * Builds a tiny but complete ASTRA project in a temp dir (its own astra.yaml,
 * universe, and result artifacts), then drives the plugin's single `{astra}`
 * directive, the inline roles ({astra}, {astra:ref}, {astra:cite[:t]},
 * {astra:value}), and the transforms against it, asserting the emitted mdast.
 *
 * Exercises the unified path grammar: elements, children (options / evidence),
 * collections (registries), bare sub-analyses, scoped paths, directive options,
 * the resolved store, the transitive provenance tracer, and the cache.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VFile } from 'vfile';
import { mystParse } from 'myst-parser';

import plugin from '../src/index.js';
import { buildResolvedStore } from '../src/transform/resolved-store.js';
import { traceProvenance, pageFrames } from '../src/transform/provenance.js';

// ── Fixture project ──────────────────────────────────────────────────────

// `method` is overridden by the universe to `grid` (≠ its `mcmc` default) so we
// can prove the universe selection wins. The sub-analysis owns `sub_decision`
// (narrowed to `beta` inside the sub scope) and an `inherited_method` aliased to
// the root via `from: ../method`. ASTRA no longer carries a `narrative` section.
const ASTRA_YAML = `version: "1.0"
name: Test Analysis
authors: [Tester]
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
  - id: unproduced_metric
    type: metric
    label: "Unproduced metric"
    description: "Declared but not yet materialised."
    recipe:
      command: "python later.py {output}"
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
  writeResult(root, 'scatter_plot', 'scatter_plot.png', 'PNG');
  writeResult(root, 'measurements', 'measurements.csv', MEASUREMENTS_CSV);
  writeResult(root, 'summary_metric', 'summary_metric.json', JSON.stringify({ value: 1.5, uncertainty: 0.3, unit: 'Mpc' }));
  writeResult(root, 'aliased_plot', 'aliased_plot.png', 'PNG');
  writeResult(root, 'sub_table', 'sub_table.csv', MEASUREMENTS_CSV);
  writeResult(root, 'sub_plot', 'sub_plot.png', 'PNG');
  return root;
}

let PROJECT_ROOT: string;
const ORIGINAL_CWD = process.cwd();

beforeAll(() => {
  PROJECT_ROOT = buildFixture();
  // The plugin resolves the ASTRA project from the working directory (the
  // same convention as running `myst` from the project dir).
  process.chdir(PROJECT_ROOT);
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (PROJECT_ROOT) rmSync(PROJECT_ROOT, { recursive: true, force: true });
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

const astraDirective = () => {
  const d = plugin.directives.find((x: any) => x.name === 'astra');
  if (!d) throw new Error('no {astra} directive');
  return d as any;
};
function runAstra(arg?: string, options: Record<string, any> = {}): Node[] {
  return astraDirective().run({ arg, options }) as Node[];
}
function role(name: string) {
  // Match by name or alias, mirroring how MyST resolves role invocations.
  const r = plugin.roles.find((x: any) => x.name === name || x.alias?.includes(name));
  if (!r) throw new Error(`no role ${name}`);
  return r as any;
}
function runRole(name: string, body: string, options?: Record<string, any>, vfile?: VFile): Node[] {
  return role(name).run({ body, options }, vfile) as Node[];
}
function runStoreTree(path: string): Node {
  const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
  const tree: Node = { type: 'root', children: [] };
  (t as any).plugin()(tree, new VFile({ path }));
  return tree;
}
function runStore(path: string): Record<string, any> {
  const carrier = runStoreTree(path).children.find((n: any) => n.class === 'astra-store');
  if (!carrier) throw new Error('no astra-store carrier emitted');
  return carrier.data.astra;
}

// ── Block directive: elements ───────────────────────────────────────────────

describe('directive — elements', () => {
  it('decisions.<id> → div carrier tagged astra-decision, fallback nested inside', () => {
    const nodes = runAstra('decisions.method');
    const carrier = byIdentifier(nodes, 'decision-method');
    expect(carrier).toBeDefined();
    expect(carrier?.type).toBe('div');
    expect(hasClass(carrier, 'astra-decision')).toBe(true);
    // the whole neutral fallback (heading + details dropdown) is nested inside
    // the carrier, so a rich theme replacing it can't double-render (issue #9)
    expect(findFirst(carrier!.children as Node[], (n) => n.type === 'heading')).toBeDefined();
    expect(findFirst(carrier!.children as Node[], (n) => n.type === 'details')).toBeDefined();
    expect(findFirst(nodes, (n) => n.type === 'tabSet')).toBeDefined();
    // selected option (grid, per universe) reordered to the first tab
    expect(findFirst(nodes, (n) => n.type === 'tabItem')?.title).toContain('Grid search');
    expect(JSON.stringify(nodes)).not.toContain('/static/');
  });

  it('outputs.<id> figure → container[figure] with project-relative image url', () => {
    const nodes = runAstra('outputs.scatter_plot');
    const carrier = byIdentifier(nodes, 'output-scatter_plot');
    expect(carrier?.type).toBe('container');
    expect(carrier?.kind).toBe('figure');
    expect(hasClass(carrier, 'astra-output')).toBe(true);
    expect(hasClass(carrier, 'astra-output--figure')).toBe(true);
    const image = findFirst(nodes, (n) => n.type === 'image');
    expect(image?.url).toBe('results/baseline/scatter_plot/scatter_plot.png');
  });

  it('outputs.<id> table → container[table] tagged astra-output--table', () => {
    const nodes = runAstra('outputs.measurements');
    const carrier = byIdentifier(nodes, 'output-measurements');
    expect(carrier?.kind).toBe('table');
    expect(hasClass(carrier, 'astra-output--table')).toBe(true);
    expect(findFirst(nodes, (n) => n.type === 'table')).toBeDefined();
  });

  it('outputs.<id> metric → carrier tagged astra-output--metric', () => {
    expect(hasClass(byIdentifier(runAstra('outputs.summary_metric'), 'output-summary_metric'), 'astra-output--metric')).toBe(true);
  });

  it('aliased output (from: sub.sub_plot) resolves the source type → figure', () => {
    expect(byIdentifier(runAstra('outputs.aliased_plot'), 'output-aliased_plot')?.kind).toBe('figure');
  });

  it('findings.<id> → div carrier tagged astra-finding, fallback nested inside; no /static scheme leaks', () => {
    const nodes = runAstra('findings.signal_detected');
    const carrier = byIdentifier(nodes, 'finding-signal_detected');
    expect(carrier?.type).toBe('div');
    expect(hasClass(carrier, 'astra-finding')).toBe(true);
    // claim heading + notes/scope/evidence are the carrier's children, not
    // siblings — a rich theme replacing the carrier replaces the fallback too
    expect(findFirst(carrier!.children as Node[], (n) => n.type === 'heading')).toBeDefined();
    expect(findFirst(carrier!.children as Node[], (n) => n.type === 'paragraph')).toBeDefined();
    expect(JSON.stringify(nodes)).not.toContain('/static/');
  });

  it('prior_insights.<id> → seealso admonition tagged astra-prior-insight', () => {
    const adm = findFirst(runAstra('prior_insights.prior_literature_result'), (n) => n.type === 'admonition');
    expect(adm?.kind).toBe('seealso');
    expect(hasClass(adm, 'astra-prior-insight')).toBe(true);
    expect(adm?.identifier).toBe('prior_insight-prior_literature_result');
  });

  it('inputs.<id> → one-row registry table tagged astra-input', () => {
    const nodes = runAstra('inputs.raw_catalog');
    expect(hasClass(nodes[0], 'astra-input')).toBe(true);
    expect(textOf(nodes)).toContain('Raw catalog');
  });

  it('bare sub-analysis → card linking to the sub-page, tagged astra-subanalysis', () => {
    const carrier = byIdentifier(runAstra('sub'), 'analysis-sub');
    expect(carrier?.type).toBe('card');
    expect(hasClass(carrier, 'astra-subanalysis')).toBe(true);
    expect(carrier?.url).toBe('/sub');
    expect(carrier?.title).toBe('Sub Analysis');
  });

  it('universes.<id> → selections table tagged astra-universe', () => {
    const nodes = runAstra('universes.baseline');
    expect(hasClass(byIdentifier(nodes, 'universe-baseline'), 'astra-universe')).toBe(true);
    expect(textOf(nodes)).toContain('Grid search');
  });
});

// ── Block directive: children ────────────────────────────────────────────────

describe('directive — children', () => {
  it('decisions.<id>.options.<opt> → one option, selected marker, astra-option', () => {
    const nodes = runAstra('decisions.method.options.grid');
    const head = byIdentifier(nodes, 'option-method-grid');
    expect(hasClass(head, 'astra-option')).toBe(true);
    expect(textOf(nodes)).toContain('Grid search');
    expect(textOf(nodes)).toContain('(selected)'); // grid is the universe selection
  });

  it('findings.<id>.evidence.<id> → the single evidence record', () => {
    const nodes = runAstra('findings.signal_detected.evidence.f1');
    expect(textOf(nodes)).toContain('A clear peak appears.');
    // the source artifact id renders as inline code
    expect(findFirst(nodes, (n) => n.type === 'inlineCode' && n.value === 'scatter_plot')).toBeDefined();
  });

  it('accepts the short child form (options / evidence implied)', () => {
    expect(byIdentifier(runAstra('decisions.method.grid'), 'option-method-grid')).toBeDefined();
    expect(textOf(runAstra('findings.signal_detected.f1'))).toContain('A clear peak appears.');
    // …and inline: the option ref resolves the same as the long form
    expect(textOf(runRole('astra', 'decisions.method.grid'))).toBe('Grid search');
  });
});

// ── Block directive: collections (registries) ────────────────────────────────

describe('directive — registries', () => {
  it('inputs / outputs registries carry their classes', () => {
    expect(hasClass(runAstra('inputs')[0], 'astra-inputs')).toBe(true);
    expect(hasClass(runAstra('outputs')[0], 'astra-outputs')).toBe(true);
  });

  it('decisions registry renders each rendered decision', () => {
    expect(byIdentifier(runAstra('decisions'), 'decision-method')).toBeDefined();
  });

  it('findings registry renders each finding', () => {
    expect(byIdentifier(runAstra('findings'), 'finding-signal_detected')).toBeDefined();
  });

  it('analyses registry renders a card per sub-analysis', () => {
    expect(byIdentifier(runAstra('analyses'), 'analysis-sub')?.type).toBe('card');
  });
});

// ── Block directive: options ─────────────────────────────────────────────────

describe('directive — options', () => {
  it(':caption: overrides an output caption', () => {
    const nodes = runAstra('outputs.scatter_plot', { caption: 'Custom caption text' });
    const cap = findFirst(nodes, (n) => n.type === 'caption');
    expect(textOf(cap as Node)).toBe('Custom caption text');
  });

  it(':label: overrides the carrier identifier', () => {
    const nodes = runAstra('outputs.scatter_plot', { label: 'fig-custom' });
    expect(byIdentifier(nodes, 'fig-custom')).toBeDefined();
  });

  it(':class: adds a CSS class to the carrier', () => {
    const nodes = runAstra('findings.signal_detected', { class: 'highlight' });
    expect(hasClass(byIdentifier(nodes, 'finding-signal_detected'), 'highlight')).toBe(true);
  });

  it(':compact: / :hide: evidence trims a finding to claim + scope (no figure)', () => {
    const nodes = runAstra('findings.signal_detected', { compact: true });
    expect(findFirst(nodes, (n) => n.type === 'image')).toBeUndefined();
    expect(textOf(nodes)).toContain('baseline universe');
    expect(findFirst(runAstra('findings.signal_detected', { hide: 'evidence' }), (n) => n.type === 'image')).toBeUndefined();
  });
});

// ── Block directive: scoping + errors ────────────────────────────────────────

describe('directive — scoping & errors', () => {
  it('resolves a scoped table output (sub.outputs.sub_table)', () => {
    expect(byIdentifier(runAstra('sub.outputs.sub_table'), 'output-sub_table')?.kind).toBe('table');
  });

  it('resolves a scoped decision (sub.decisions.sub_decision)', () => {
    expect(byIdentifier(runAstra('sub.decisions.sub_decision'), 'decision-sub_decision')).toBeDefined();
  });

  it('a bare from-reference decision yields an error admonition', () => {
    const nodes = runAstra('sub.decisions.inherited_method');
    expect(nodes[0].type).toBe('admonition');
    expect(nodes[0].kind).toBe('error');
  });

  it('an unknown component id yields an error admonition', () => {
    expect(runAstra('outputs.no_such_output')[0].kind).toBe('error');
  });
});

// ── Inline role: {astra} ─────────────────────────────────────────────────────

describe('role {astra}', () => {
  it('→ neutral astra-ref token carrying the store join key', () => {
    const [token] = runRole('astra', 'decisions.method');
    expect(hasClass(token, 'astra-ref')).toBe(true);
    expect(hasClass(token, 'astra-ref--decision')).toBe(true);
    expect(token.data?.astra).toEqual({ kind: 'decision', id: 'method', path: 'method' });
  });

  it('an output ref carries the output subtype modifier class', () => {
    const [token] = runRole('astra', 'outputs.scatter_plot');
    expect(hasClass(token, 'astra-ref--output')).toBe(true);
    expect(hasClass(token, 'astra-ref--figure')).toBe(true);
  });

  it('honours MyST display text <path> override', () => {
    const [token] = runRole('astra', 'the prior <prior_insights.prior_literature_result>');
    expect(textOf([token])).toBe('the prior');
    expect(token.data?.astra).toMatchObject({ kind: 'prior_insight', id: 'prior_literature_result' });
  });

  it('an input ref resolves to the inputs kind', () => {
    expect(runRole('astra', 'inputs.raw_catalog')[0].data?.astra).toMatchObject({ kind: 'input', id: 'raw_catalog' });
  });

  it('an option ref resolves to the option label + kind', () => {
    const [token] = runRole('astra', 'decisions.method.options.grid');
    expect(token.data?.astra).toMatchObject({ kind: 'option', id: 'grid' });
    expect(textOf([token])).toBe('Grid search');
  });

  it('a bare sub-analysis ref resolves to the subanalyses store table', () => {
    const [token] = runRole('astra', 'sub');
    expect(token.data?.astra).toMatchObject({ kind: 'analysis', id: 'sub' });
    expect(runStore('index.md').subanalyses['sub']).toBeDefined();
  });

  it('a scoped ref keeps the dotted store path', () => {
    expect(runRole('astra', 'sub.outputs.sub_table')[0].data?.astra).toMatchObject({
      id: 'sub_table',
      path: 'sub.sub_table',
    });
  });

  it('an unresolvable ref falls back with a collection-elided key, marked unresolved', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const vf = new VFile({ path: 'index.md' });
    const [token] = runRole('astra', 'ghost.outputs.xi', undefined, vf);
    // Same key format as resolved refs (no collection segment), and flagged so
    // the store transform skips the cross-scope merge for it.
    expect(token.data?.astra).toMatchObject({ id: 'xi', path: 'ghost.xi', unresolved: true });
    // The diagnostic routes through MyST's vfile channel, not the console.
    expect(vf.messages.some((m) => String(m.message).includes('ghost'))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── Inline role: {astra:ref} (alias {astra:numref}) ─────────────────────────

describe('role {astra:ref}', () => {
  // Emits a link to the output identifier (not a crossReference node): MyST's
  // own resolver fills the "Figure N" number for link nodes, but leaves
  // plugin-injected crossReferences unresolved.
  it('emits a link to the output carrier identifier', () => {
    const [node] = runRole('astra:ref', 'outputs.scatter_plot');
    expect(node.type).toBe('link');
    expect(node.url).toBe('#output-scatter_plot');
    expect(node.children).toEqual([]); // empty → MyST fills "Figure N"
  });

  it('carries %s display text through', () => {
    const [node] = runRole('astra:ref', 'see Fig. %s <outputs.scatter_plot>');
    expect(node.type).toBe('link');
    expect(node.url).toBe('#output-scatter_plot');
    expect(textOf([node])).toBe('see Fig. %s');
  });

  it('keeps astra:numref as an alias', () => {
    expect(role('astra:ref').alias).toContain('astra:numref');
    const [node] = runRole('astra:numref', 'outputs.scatter_plot');
    expect(node.url).toBe('#output-scatter_plot');
  });
});

// ── Inline roles: {astra:cite} / {astra:cite:t} ──────────────────────────────

describe('roles {astra:cite} / {astra:cite:t}', () => {
  it('cite → a parenthetical cite from the insight DOI', () => {
    const [node] = runRole('astra:cite', 'prior_insights.prior_literature_result');
    expect(node.type).toBe('cite');
    expect(node.kind).toBe('parenthetical');
    expect(node.label).toBe('10.1234/example.doi');
  });

  it('cite:t → a narrative cite from the insight DOI', () => {
    expect(runRole('astra:cite:t', 'prior_insights.prior_literature_result')[0].kind).toBe('narrative');
  });

  it('falls back to a plain reference when there is no DOI', () => {
    const [node] = runRole('astra:cite', 'findings.signal_detected');
    expect(hasClass(node, 'astra-ref--finding')).toBe(true);
  });
});

// ── Inline role: {astra:value} ───────────────────────────────────────────────

describe('role {astra:value}', () => {
  it('interpolates a real cell with ± uncertainty (pm option)', () => {
    const [token] = runRole('astra:value', 'outputs.measurements', { col: 'value', where: 'tracer=lrg', pm: true });
    expect(textOf([token])).toBe('19.88 ± 0.17');
    expect(token.data?.astra).toMatchObject({ kind: 'value', id: 'measurements', col: 'value' });
  });

  it('honours an explicit err=<col>', () => {
    expect(textOf(runRole('astra:value', 'outputs.measurements', { col: 'value', where: 'tracer=lrg', err: 'value_std' }))).toBe('19.88 ± 0.17');
  });

  it('formats to significant figures and respects sig=N', () => {
    expect(textOf(runRole('astra:value', 'outputs.measurements', { col: 'value', where: 'tracer=elg' }))).toBe('0.0696');
    expect(textOf(runRole('astra:value', 'outputs.measurements', { col: 'value', where: 'tracer=lrg', sig: 2 }))).toBe('20');
  });

  it('parses role options through the MyST inline-attribute syntax', () => {
    const tree = mystParse(
      '{astra:value col=value where="tracer=lrg" pm=true}`outputs.measurements`',
      { roles: plugin.roles as any },
    );
    expect(textOf(tree as any)).toBe('19.88 ± 0.17');
  });

  it('resolves a scoped product (sub.outputs.sub_table)', () => {
    expect(textOf(runRole('astra:value', 'sub.outputs.sub_table', { col: 'value', where: 'tracer=lrg' }))).toBe('19.88');
  });

  it('a decision value resolves to the selected option label', () => {
    expect(textOf(runRole('astra:value', 'decisions.method'))).toBe('Grid search');
  });

  it('interpolates a metric output directly — no col= needed', () => {
    expect(textOf(runRole('astra:value', 'outputs.summary_metric'))).toBe('1.5');
    expect(textOf(runRole('astra:value', 'outputs.summary_metric', { pm: true }))).toBe('1.5 ± 0.3');
  });

  it('rejects the retired space-separated body grammar with a pointer to options', () => {
    const vf = new VFile({ path: 'index.md' });
    const [token] = runRole('astra:value', 'outputs.measurements tracer=lrg col=value ±', undefined, vf);
    expect(token.type).toBe('inlineCode');
    expect(vf.messages.some((m) => String(m.message).includes('role options'))).toBe(true);
  });

  it('surfaces clear errors for a missing column / bad filter / non-matching row', () => {
    expect(runRole('astra:value', 'outputs.measurements', { col: 'nope', where: 'tracer=lrg' })[0].type).toBe('inlineCode');
    expect(runRole('astra:value', 'outputs.measurements', { col: 'value', where: 'tracer=ghost' })[0].type).toBe('inlineCode');
    expect(runRole('astra:value', 'outputs.measurements', { col: 'value', where: 'notapair' })[0].type).toBe('inlineCode');
  });

  it('treats an unproduced result as a warning, not an error (pending state)', () => {
    const vf = new VFile({ path: 'index.md' });
    const [token] = runRole('astra:value', 'outputs.unproduced_metric', { col: 'x' }, vf);
    expect(token.type).toBe('inlineCode');
    // A vfile warning (fatal: false), not a vfile error — pending outputs
    // must not fail strict builds.
    const pending = vf.messages.filter((m) => String(m.message).includes('unproduced_metric'));
    expect(pending).toHaveLength(1);
    expect(pending[0].fatal).not.toBe(true);
  });
});

// ── Resolved store transform ─────────────────────────────────────────────────

describe('resolved-store transform', () => {
  it('emits a hidden carrier with the resolved model keyed by id (root scope)', () => {
    const store = runStore('index.md');

    expect(store.outputs['scatter_plot'].type).toBe('figure');
    expect(store.outputs['scatter_plot'].resolved_path).toBe('results/baseline/scatter_plot/scatter_plot.png');
    expect(store.outputs['measurements'].table_data?.headers).toContain('value');
    expect(store.outputs['summary_metric'].metric).toMatchObject({ value: 1.5, uncertainty: 0.3, unit: 'Mpc' });

    // universe selection wins over the declared default (mcmc → grid)
    expect(store.decisions['method'].selected).toBe('grid');
    expect(store.inputs['raw_catalog'].label).toBe('Raw catalog');
    expect(store.findings['signal_detected']).toBeDefined();
    expect(store.prior_insights['prior_literature_result'].doi).toBe('10.1234/example.doi');
    expect(store.subanalyses['sub'].url).toBe('/sub');
  });

  it('serializes finding evidence and strips the universe clause from scope', () => {
    const finding = runStore('index.md').findings['signal_detected'];
    expect(finding.evidence).toEqual([{ artifact: 'scatter_plot', doi: undefined, quote: 'A clear peak appears.' }]);
    expect(finding.scope).toBeUndefined();
  });

  it('serializes option insights on decisions that cite them', () => {
    expect(runStore('sub.md').decisions['sub_decision'].option_insights).toEqual({ alpha: ['prior_literature_result'] });
    expect(runStore('index.md').decisions['method'].option_insights).toEqual({ mcmc: ['prior_literature_result'] });
  });

  it('routes result images through a hidden astra-assets carrier', () => {
    const tree = runStoreTree('index.md');
    const assets = tree.children.find((n: any) => n.class === 'astra-assets');
    expect(assets?.style).toEqual({ display: 'none' });
    expect(assets!.children.find((n: any) => n.data?.astraAsset === 'scatter_plot')).toMatchObject({
      type: 'image',
      url: 'results/baseline/scatter_plot/scatter_plot.png',
    });
  });

  it('the store carrier is invisible on book-theme', () => {
    const tree = runStoreTree('index.md');
    expect(tree.children.find((n: any) => n.class === 'astra-store')?.style).toEqual({ display: 'none' });
  });

  it('emits a hidden astra-cites carrier with narrative + parenthetical cites per DOI', () => {
    const tree = runStoreTree('index.md');
    const cites = tree.children.find((n: any) => n.class === 'astra-cites');
    const nodes = cites!.children[0].children;
    expect(nodes.map((c: any) => [c.label, c.kind])).toEqual([
      ['10.1234/example.doi', 'narrative'],
      ['10.1234/example.doi', 'parenthetical'],
    ]);
  });

  it('scopes the store to a sub-analysis page (dotted basename)', () => {
    const store = runStore('sub.md');
    expect(store.analysis.slug).toBe('sub');
    expect(store.outputs['sub_table']).toBeDefined();
    expect(store.decisions['sub_decision'].selected).toBe('beta'); // narrowed in sub
    expect(store.decisions['inherited_method']).toBeUndefined(); // bare-from, no carrier
  });
});

// ── Dotted-filename page-scope derivation ────────────────────────────────────

describe('dotted-filename page scope', () => {
  it('index.md maps to the root scope', () => {
    expect(runStore('index.md').analysis.slug).toBe('index');
  });
  it('a non-ASTRA basename yields no store carrier (null scope)', () => {
    const tree = runStoreTree('not_an_analysis.md');
    expect(tree.children.find((n: any) => n.class === 'astra-store')).toBeUndefined();
  });
});

// ── astra_scope frontmatter override + store-less page warning (#10) ─────────

/** Run the store transform against `tree` for `path`, returning the vfile. */
function runTransform(path: string, tree: Node = { type: 'root', children: [] }): VFile {
  const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
  const vfile = new VFile({ path });
  (t as any).plugin()(tree, vfile);
  return vfile;
}

describe('astra_scope frontmatter override (#10)', () => {
  it('reads the override from the RAW source file (MyST strips the key from vfile frontmatter)', () => {
    // "" selects the root analysis for a basename that maps to no scope.
    writeFileSync(
      join(PROJECT_ROOT, 'gallery.md'),
      '---\ntitle: Element gallery\nastra_scope: ""\n---\n\nBody.\n',
    );
    expect(runStore('gallery.md').analysis.slug).toBe('index');
  });

  it('honors dotted-string and list forms', () => {
    writeFileSync(join(PROJECT_ROOT, 'methods_dotted.md'), '---\nastra_scope: sub\n---\n');
    expect(runStore('methods_dotted.md').analysis.slug).toBe('sub');
    writeFileSync(join(PROJECT_ROOT, 'methods_list.md'), '---\nastra_scope:\n  - sub\n---\n');
    expect(runStore('methods_list.md').analysis.slug).toBe('sub');
  });

  it('validated vfile frontmatter still wins when a future MyST passes the key through', () => {
    const tree: Node = { type: 'root', children: [] };
    const t = plugin.transforms.find((x: any) => x.name === 'astra-resolved-store');
    const vfile = new VFile({ path: 'no_such_file_on_disk.md' });
    (vfile.data as any).frontmatter = { astra_scope: 'sub' };
    (t as any).plugin()(tree, vfile);
    const carrier: any = tree.children.find((n: any) => n.class === 'astra-store');
    expect(carrier?.data?.astra?.analysis?.slug).toBe('sub');
  });

  it('reports an explicit override that fails to resolve, and emits no store', () => {
    writeFileSync(join(PROJECT_ROOT, 'broken_scope.md'), '---\nastra_scope: no_such_scope\n---\n');
    const tree: Node = { type: 'root', children: [] };
    const vfile = runTransform('broken_scope.md', tree);
    expect(tree.children.find((n: any) => n.class === 'astra-store')).toBeUndefined();
    expect(vfile.messages.some((m: any) => /astra_scope "no_such_scope"/.test(m.message))).toBe(true);
  });
});

describe('store-less page warning (#10)', () => {
  it('warns when a page outside the scope map carries astra elements', () => {
    const tree: Node = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'span', class: 'astra-ref astra-ref--decision', children: [] }],
        },
      ],
    } as any;
    const vfile = runTransform('not_an_analysis.md', tree);
    expect(vfile.messages.some((m: any) => /neutral fallbacks/.test(m.message))).toBe(true);
    // and no store was emitted
    expect((tree.children as any[]).find((n: any) => n.class === 'astra-store')).toBeUndefined();
  });

  it('stays silent on a page outside the scope map with no astra content', () => {
    const vfile = runTransform('not_an_analysis.md');
    expect(vfile.messages).toHaveLength(0);
  });
});

// ── Decision option-tab supporting insights (store-driven refs) ──────────────

describe('decision option-tab supporting insights', () => {
  it('emits store-driven astra-ref tokens, not native crossReferences', () => {
    const nodes = runAstra('decisions.method');
    const tok = findFirst(nodes, (n) => hasClass(n, 'astra-ref--prior_insight'));
    expect(tok?.data?.astra).toMatchObject({ kind: 'prior_insight', id: 'prior_literature_result' });
  });
});

// ── Transitive provenance (through the store) ────────────────────────────────

describe('transitive provenance', () => {
  it('traces inputs_root and decisions_transitive across scopes with narrowing', () => {
    const out = runStore('index.md').outputs['measurements'];
    expect(out.inputs_root.map((i: any) => i.id)).toEqual(['raw_catalog']);
    const byId = Object.fromEntries(out.decisions_transitive.map((d: any) => [d.id, d]));
    expect(byId['method']).toMatchObject({ via: undefined, selection: 'Grid search' });
    expect(byId['sub_decision']).toMatchObject({ via: 'sub', selection: 'Beta' });
    expect(out.decisions_transitive.filter((d: any) => d.id === 'method')).toHaveLength(1);
  });
});

describe('traceProvenance ../ traversal', () => {
  it('climbs one scope per ../ for a multi-level decision alias', () => {
    const root: any = {
      decisions: { deep: { label: 'Deep', default: 'd1', options: { d1: { label: 'Deep One' } } } },
      inputs: [], outputs: [], analyses: {},
    };
    const mid: any = { decisions: {}, inputs: [], outputs: [], analyses: {} };
    const leaf: any = {
      decisions: { esc: { from: '../../deep' } },
      inputs: [],
      outputs: [{ id: 'leaf_out', type: 'metric', decisions: ['esc'], inputs: [], recipe: { command: 'x' } }],
      analyses: {},
    };
    const rootU: any = { decisions: { deep: 'd1' }, analyses: { mid: { decisions: {}, analyses: { leaf: { decisions: {} } } } } };
    const frame = pageFrames([root, mid, leaf], rootU, ['mid', 'leaf']);
    expect(traceProvenance(leaf.outputs[0], frame).decisions_transitive).toEqual([
      { id: 'deep', label: 'Deep', selection: 'Deep One', via: 'root' },
    ]);
  });
});

// ── buildResolvedStore direct call ───────────────────────────────────────────

describe('buildResolvedStore (direct)', () => {
  it('builds a keyed store from a minimal Analysis with no result files', () => {
    const analysis: any = {
      id: 'mini', name: 'Mini',
      decisions: { d: { label: 'D', default: 'x', options: { x: { label: 'X' }, y: { label: 'Y' } } } },
      inputs: [{ id: 'in', type: 'data', label: 'In' }],
      outputs: [{ id: 'o', type: 'figure', label: 'O', inputs: ['in'], decisions: ['d'], recipe: { command: 'c' } }],
      findings: {}, prior_insights: {}, analyses: {},
    };
    const universe: any = { id: 'u', decisions: { d: 'y' } };
    const store = buildResolvedStore(analysis, universe, () => undefined, 'index', (p) => p);
    expect(store.outputs['o'].resolved_path).toBeUndefined();
    expect(store.decisions['d'].selected).toBe('y');
    expect(store.inputs['in'].label).toBe('In');
  });
});

// ── Cache freshness ──────────────────────────────────────────────────────────

describe('source cache freshness', () => {
  let tmpRoot: string;

  afterEach(() => {
    process.chdir(PROJECT_ROOT);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reuses the cache for an unchanged mtime and re-reads after the universe file advances', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mystra-reload-'));
    cpSync(PROJECT_ROOT, tmpRoot, { recursive: true });
    process.chdir(tmpRoot);

    const slug = () => runStore('index.md').analysis.slug;
    expect(slug()).toBe('index');
    expect(slug()).toBe('index');

    const uni = join(tmpRoot, 'universes', 'baseline.yaml');
    const future = statSync(uni).mtimeMs / 1000 + 100;
    utimesSync(uni, future, future);
    expect(slug()).toBe('index');
  });
});
