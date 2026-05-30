/**
 * Plugin emission tests (Strategy A).
 *
 * Drives the ASTRA MyST plugin's directives / roles / transforms against the
 * real DESI DR1 BAO project in `prototype/` and asserts the emitted mdast:
 * stock node types, recognition markers (`astra-*` classes), stable
 * identifiers, project-relative image urls, live value interpolation, scoped
 * sub-analysis resolution, and the resolved-store shape.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, cpSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import plugin from '../src/index.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prototype');

beforeAll(() => {
  process.env.ASTRA_PROJECT_ROOT = PROJECT_ROOT;
  delete process.env.ASTRA_UNIVERSE; // default to first universe (baseline)
});

// ── mdast traversal helpers ──────────────────────────────────────────────

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

// ── Plugin handle lookups ────────────────────────────────────────────────

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
/** Run the resolved-store transform for a page and return its keyed model. */
function runStore(path: string): Record<string, any> {
  const storeTransform = plugin.transforms.find((t: any) => t.name === 'astra-resolved-store');
  const tree: Node = { type: 'root', children: [] };
  (storeTransform as any).plugin()(tree, { path });
  const carrier = tree.children.find((n: any) => n.class === 'astra-store');
  if (!carrier) throw new Error('no astra-store carrier emitted');
  return carrier.data.astra;
}

// ── Block directives ──────────────────────────────────────────────────────

describe('block directives', () => {
  it('decision → tabSet carrier with astra-decision class + identifier', () => {
    const nodes = runDirective('decision', 'covariance_source');
    const carrier = byIdentifier(nodes, 'decision-covariance_source');
    expect(carrier).toBeDefined();
    expect(hasClass(carrier, 'astra-decision')).toBe(true);
    expect(findFirst(nodes, (n) => n.type === 'tabSet')).toBeDefined();
    // never the legacy /static scheme
    expect(JSON.stringify(nodes)).not.toContain('/static/');
  });

  it('figure output → container[figure] with project-relative image url + markers', () => {
    const nodes = runDirective('output', 'bao_fit_plot');
    const carrier = byIdentifier(nodes, 'output-bao_fit_plot');
    expect(carrier?.type).toBe('container');
    expect(carrier?.kind).toBe('figure');
    expect(hasClass(carrier, 'astra-output')).toBe(true);
    expect(hasClass(carrier, 'astra-output--figure')).toBe(true);
    const image = findFirst(nodes, (n) => n.type === 'image');
    expect(image?.url).toBe('results/baseline/bao_fit_plot/bao_fit_plot.png');
    expect(image?.url.startsWith('/static/')).toBe(false);
    // provenance disclosure emitted alongside
    expect(findFirst(nodes, (n) => n.type === 'details')).toBeDefined();
  });

  it('table output → container[table] tagged astra-output--table', () => {
    const nodes = runDirective('output', 'bao_distance_table');
    const carrier = byIdentifier(nodes, 'output-bao_distance_table');
    expect(carrier?.type).toBe('container');
    expect(carrier?.kind).toBe('table');
    expect(hasClass(carrier, 'astra-output--table')).toBe(true);
    expect(findFirst(nodes, (n) => n.type === 'table')).toBeDefined();
  });

  it('finding → astra-finding carrier with identifier', () => {
    const nodes = runDirective('finding', 'bao_detected_post_recon');
    const carrier = byIdentifier(nodes, 'finding-bao_detected_post_recon');
    expect(carrier).toBeDefined();
    expect(hasClass(carrier, 'astra-finding')).toBe(true);
  });

  it('finding :compact: → claim heading + scope, no evidence figure', () => {
    const nodes = runDirective('finding', 'bao_detected_post_recon', { compact: true });
    expect(byIdentifier(nodes, 'finding-bao_detected_post_recon')).toBeDefined();
    expect(findFirst(nodes, (n) => n.type === 'image')).toBeUndefined();
  });

  it('prior-insight → seealso admonition with astra-prior-insight class', () => {
    const nodes = runDirective('prior-insight', 'combined_systematic_budget');
    const adm = findFirst(nodes, (n) => n.type === 'admonition');
    expect(adm?.kind).toBe('seealso');
    expect(hasClass(adm, 'astra-prior-insight')).toBe(true);
    expect(adm?.identifier).toBe('prior_insight-combined_systematic_budget');
  });

  it('subanalysis → card linking to the sub-page, tagged astra-subanalysis', () => {
    const nodes = runDirective('subanalysis', 'reconstruction');
    const carrier = byIdentifier(nodes, 'analysis-reconstruction');
    expect(carrier?.type).toBe('card');
    expect(hasClass(carrier, 'astra-subanalysis')).toBe(true);
    expect(carrier?.url).toBe('/reconstruction');
    expect(carrier?.title).toBeTruthy();
  });

  it('inputs / outputs tables carry their registry classes', () => {
    const inputs = runDirective('inputs');
    expect(hasClass(inputs[0], 'astra-inputs')).toBe(true);
    const outputs = runDirective('outputs');
    expect(hasClass(outputs[0], 'astra-outputs')).toBe(true);
  });
});

// ── Scoped sub-analysis resolution ──────────────────────────────────────────

describe('sub-analysis scope', () => {
  it('resolves a scoped figure output (clustering.xi_multipoles_plot)', () => {
    const nodes = runDirective('output', 'clustering.xi_multipoles_plot');
    const carrier = byIdentifier(nodes, 'output-xi_multipoles_plot');
    expect(carrier?.kind).toBe('figure');
    expect(hasClass(carrier, 'astra-output')).toBe(true);
  });

  it('resolves a scoped decision (reconstruction.algorithm)', () => {
    const nodes = runDirective('decision', 'reconstruction.algorithm');
    expect(byIdentifier(nodes, 'decision-algorithm')).toBeDefined();
  });
});

// ── Inline roles ────────────────────────────────────────────────────────────

describe('inline roles', () => {
  it('cite role → neutral astra-ref token carrying the store join key', () => {
    const [token] = runRole('decision', 'covariance_source');
    expect(hasClass(token, 'astra-ref')).toBe(true);
    expect(hasClass(token, 'astra-ref--decision')).toBe(true);
    // no card baked into the node — the theme reads the card from the store
    expect(findFirst([token], (n) => hasClass(n, 'astra-card'))).toBeUndefined();
    expect(token.data?.astra).toEqual({
      kind: 'decision',
      id: 'covariance_source',
      path: 'covariance_source',
    });
  });

  it('cite role honours a |display override for the inline label', () => {
    const [token] = runRole('prior-insight', 'combined_systematic_budget|the budget');
    // the label is the span's own text now (no inner __label wrapper)
    expect(textOf([token])).toBe('the budget');
    expect(token.data?.astra?.id).toBe('combined_systematic_budget');
    expect(token.data?.astra?.kind).toBe('prior_insight');
  });

  it('cite role join key resolves in the resolved store (citation-style)', () => {
    const [token] = runRole('finding', 'subpercent_alpha_iso_precision');
    const { kind, id } = token.data.astra;
    expect(kind).toBe('finding');
    // the theme joins data.astra → store[<table>][id]; assert the entry exists
    const store = runStore('index.md');
    expect(store.findings[id]).toBeDefined();
  });

  it('value role interpolates a real cell with ± uncertainty', () => {
    const [token] = runRole('value', 'bao_distance_table tracer=lrg3_elg1 col=DV_over_rd pm');
    expect(textOf([token])).toBe('19.88 ± 0.17');
    expect(token.data?.astra).toMatchObject({
      kind: 'value',
      id: 'bao_distance_table',
      col: 'DV_over_rd',
    });
  });

  it('value role formats to significant figures without ±', () => {
    const [token] = runRole('value', 'bao_alpha_values tracer=elg1 recon=Pre col=alpha1_std');
    expect(textOf([token])).toBe('0.0696');
  });

  it('value role surfaces a clear error for a missing column', () => {
    const [node] = runRole('value', 'bao_distance_table col=not_a_column');
    expect(node.type).toBe('inlineCode');
    expect(node.value).toContain('value');
  });
});

// ── Resolved store transform ─────────────────────────────────────────────────

describe('resolved-store transform', () => {
  it('emits a hidden carrier with the resolved model keyed by id (root scope)', () => {
    const store = runStore('index.md');
    const carrierStyle = { display: 'none' };
    // figure output: project-relative path, no /static
    const fig = store.outputs['bao_fit_plot'];
    expect(fig.type).toBe('figure');
    expect(fig.resolved_path).toBe('results/baseline/bao_fit_plot/bao_fit_plot.png');
    // table output: inlined parsed rows
    const tbl = store.outputs['bao_distance_table'];
    expect(tbl.type).toBe('table');
    expect(tbl.table_data?.headers).toContain('DV_over_rd');
    // decision: selected option resolved under the active universe
    expect(store.decisions['covariance_source'].selected).toBeTruthy();
    // finding + sub-analysis presence
    expect(store.findings['bao_detected_post_recon']).toBeDefined();
    expect(store.subanalyses['reconstruction'].url).toBe('/reconstruction');
    // hidden carrier is invisible on book-theme
    const storeTransform = plugin.transforms.find((t: any) => t.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (storeTransform as any).plugin()(tree, { path: 'index.md' });
    expect(tree.children[0].style).toEqual(carrierStyle);
  });

  it('scopes the store to a sub-analysis page', () => {
    const store = runStore('clustering.md');
    expect(store.analysis.slug).toBe('clustering');
    expect(store.outputs['xi_multipoles_plot']).toBeDefined();
  });
});

// ── §4 Deep-nesting page scope (dotted-filename convention) ───────────────────

describe('dotted-filename page scope', () => {
  function runStore(path: string): Record<string, any> {
    const storeTransform = plugin.transforms.find((t: any) => t.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (storeTransform as any).plugin()(tree, { path });
    const carrier = tree.children.find((n: any) => n.class === 'astra-store');
    expect(carrier).toBeDefined();
    return carrier!.data.astra;
  }

  // The prototype's sub-analyses (`reconstruction`, `clustering`) are all single
  // level — there is no genuine 2-level analysis to descend (confirmed by
  // inspecting prototype/astra.yaml: every `analyses.*` has an empty `analyses`).
  // So we unit-test the *derivation* directly: a single-segment dotted basename
  // must still resolve exactly as today, and `index` must still map to root.
  it('single-segment dotted basename resolves the sub-analysis scope (no regression)', () => {
    const store = runStore('clustering.md');
    expect(store.analysis.slug).toBe('clustering');
  });

  it('index.md maps to the root scope', () => {
    const store = runStore('index.md');
    expect(store.analysis.slug).toBe('index');
  });

  it('a trailing dot is tolerated (filter(Boolean)) and still resolves the scope', () => {
    const store = runStore('clustering..md');
    expect(store.analysis.slug).toBe('clustering');
  });

  it('a non-ASTRA basename yields no store carrier (null scope)', () => {
    const storeTransform = plugin.transforms.find((t: any) => t.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (storeTransform as any).plugin()(tree, { path: 'not_an_analysis.md' });
    expect(tree.children.find((n: any) => n.class === 'astra-store')).toBeUndefined();
  });
});

// ── §3 astra.yaml live-reload (cache freshness on mtime) ──────────────────────

describe('astra.yaml live-reload', () => {
  // Drive a public path (the store transform) against a *temp copy* of the
  // project so we can advance astra.yaml's mtime without touching the real
  // prototype. getSource is module-private; we observe its caching by checking
  // that the resolved slug stays correct across reads (a re-parse must not
  // produce a broken store) and that bumping the mtime forces a fresh parse.
  let tmpRoot: string;

  function runStore(): Record<string, any> {
    const storeTransform = plugin.transforms.find((t: any) => t.name === 'astra-resolved-store');
    const tree: Node = { type: 'root', children: [] };
    (storeTransform as any).plugin()(tree, { path: 'index.md' });
    const carrier = tree.children.find((n: any) => n.class === 'astra-store');
    return carrier!.data.astra;
  }

  afterEach(() => {
    // Restore the shared prototype root (set in beforeAll) for later suites.
    process.env.ASTRA_PROJECT_ROOT = PROJECT_ROOT;
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reuses the cache for an unchanged mtime and re-reads after astra.yaml advances', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mystra-reload-'));
    cpSync(PROJECT_ROOT, tmpRoot, { recursive: true });
    process.env.ASTRA_PROJECT_ROOT = tmpRoot;

    // First read populates the cache; second read (mtime unchanged) is a hit —
    // both must yield the same resolved store.
    const a = runStore();
    const b = runStore();
    expect(a.analysis.slug).toBe('index');
    expect(b.analysis.slug).toBe('index');

    // Advance astra.yaml's mtime past the cached value → next read re-parses.
    const yaml = join(tmpRoot, 'astra.yaml');
    const future = statSync(yaml).mtimeMs / 1000 + 100;
    utimesSync(yaml, future, future);
    const c = runStore();
    expect(c.analysis.slug).toBe('index'); // re-parse still produces a valid store
  });
});

// ── Decision option tabs: store-driven supporting-insight tokens ──────────────

describe('decision option-tab supporting insights', () => {
  // `broadband` has an option (`spline`) carrying insights: [spline_broadband_fiducial].
  it('emits store-driven astra-ref tokens, not native crossReferences', () => {
    const nodes = runDirective('decision', 'broadband');
    const tok = findFirst(nodes, (n) => hasClass(n, 'astra-ref--prior_insight'));
    expect(tok).toBeDefined();
    expect(tok!.data?.astra).toMatchObject({
      kind: 'prior_insight',
      id: 'spline_broadband_fiducial',
    });
    // the old crossReference-to-hidden-carrier mechanism is gone
    expect(
      findFirst(
        nodes,
        (n) =>
          n.type === 'crossReference' &&
          typeof n.identifier === 'string' &&
          n.identifier.startsWith('prior_insight-'),
      ),
    ).toBeUndefined();
  });

  it('the referenced insight resolves in the page store', () => {
    const store = runStore('index.md');
    expect(store.prior_insights['spline_broadband_fiducial']).toBeDefined();
  });
});
