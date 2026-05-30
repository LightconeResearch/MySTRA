/**
 * MySTRA — the package entry point and the MyST plugin itself.
 *
 * The **default export is the plugin** (reference this package from `myst.yml`'s
 * `project.plugins`); named exports at the bottom expose the loader + resolved
 * store for programmatic use.
 *
 * The author writes a normal MyST Markdown report and pulls in ASTRA components
 * by id; this plugin reads `astra.yaml` at build time and emits standard MyST
 * AST, running on the stock `myst` CLI and themes:
 *
 *   Block "import" (directives):
 *     :::{astra:decision} covariance_source
 *     :::
 *     :::{astra:output} bao_fit_plot
 *     :::
 *     :::{astra:finding} bao_detected_post_recon
 *     :::
 *     :::{astra:prior-insight} recon_sharpens_bao_peak
 *     :::
 *     :::{astra:inputs}
 *     :::                              # full inputs registry table (root scope)
 *     :::{astra:outputs} clustering
 *     :::                              # outputs table for the clustering sub-analysis
 *     :::{astra:subanalysis} reconstruction
 *     :::                              # nav card to the sub-analysis page
 *
 *   Inline "cite" (roles):
 *     {astra:decision}`covariance_source`
 *     {astra:output}`hubble_diagram_plot`
 *     {astra:finding}`subpercent_alpha_iso_precision`
 *     {astra:prior-insight}`recon_sharpens_bao_peak`
 *
 * Scoping: a component path is `<id>` (root analysis) or `<sub>.<id>`
 * (sub-analysis), e.g. `reconstruction.algorithm`. Sub-analysis paths can
 * nest (`a.b.id`). Table directives take a bare scope path (`reconstruction`)
 * or nothing (root).
 *
 * The plugin reads the ASTRA project once (cached) and renders each component
 * via the per-component helpers in `./transform/`.
 *
 * The project root defaults to `process.cwd()` (run `myst start` from the
 * project dir). Override with `ASTRA_PROJECT_ROOT`; pick a universe with
 * `ASTRA_UNIVERSE` (defaults to the first in `universes/`).
 */

import { basename, join, relative, sep } from 'node:path';
import { statSync } from 'node:fs';
import { loadASTRASource, resolveArtifact, type ArtifactResolver } from './loader.js';
import type { Analysis, Input, Insight, Output, Universe } from '@astra-spec/sdk';
import {
  makeProseParser,
  resolveNarrativeAnchors,
  firstParagraphText,
} from './transform/prose.js';
import type {
  AnalysisScope,
  PriorInsightScope,
  ProseParser,
} from './transform/prose.js';
import {
  admonition,
  admonitionTitle,
  card,
  code,
  crossReference,
  details,
  emphasis,
  heading,
  hiddenDiv,
  inlineCode,
  makeTabItem,
  paragraph,
  refNode,
  strong,
  summary,
  text,
  walkNodes,
} from './transform/ast-helpers.js';
import { renderDecision, isDecisionRendered } from './transform/render-methods.js';
import { renderFinding } from './transform/render-findings.js';
import { renderOneOutput, renderInsightEvidence } from './transform/render-evidence.js';
import { renderInputsTable, renderOutputsTable } from './transform/render-data-sources.js';
import { parseTableData } from './transform/parse-table-data.js';
import { resolveOutputs } from './transform/resolve-output.js';
import { buildResolvedStore } from './transform/resolved-store.js';

// ── Project loading + cache ─────────────────────────────────────────────

function projectRoot(): string {
  return process.env['ASTRA_PROJECT_ROOT'] || process.cwd();
}

function universeName(): string | undefined {
  return process.env['ASTRA_UNIVERSE'] || undefined;
}

type Source = ReturnType<typeof loadASTRASource>;

/** Cached project source + the `astra.yaml` mtime it was parsed from. */
interface CachedSource {
  source: Source;
  mtimeMs: number;
}

const projectCache = new Map<string, CachedSource>();

function getSource(root: string, universe?: string): Source {
  const key = `${root}::${universe ?? ''}`;
  const cached = projectCache.get(key);
  // Freshness check keyed on `astra.yaml`'s mtime: `myst start` watches `.md`
  // files, not the spec, so without this a manual rebuild would keep serving a
  // stale parse after `astra.yaml` is edited. A failed stat (file missing /
  // transient race) falls through to a reload rather than serving stale data.
  let mtimeMs = NaN;
  try {
    mtimeMs = statSync(join(root, 'astra.yaml')).mtimeMs;
  } catch {
    mtimeMs = NaN;
  }
  if (cached && Number.isFinite(mtimeMs) && mtimeMs <= cached.mtimeMs) {
    return cached.source;
  }
  const source = loadASTRASource(root, universe);
  // Overwrite the same key on reload so the cache never grows unbounded.
  projectCache.set(key, { source, mtimeMs });
  return source;
}

// ── Scope resolution ────────────────────────────────────────────────────

interface Scope {
  root: string;
  analysis: Analysis;
  universe: Universe;
  /** Lazily resolves an output id → artifact path within this scope. */
  results: ArtifactResolver;
  prose: ProseParser;
  /** Local prior_insights merged with all ancestor scopes (option-tab refs). */
  priorInsights: Record<string, Insight>;
  outputsById: Map<string, Output>;
  slug: string;
  tabItem: ReturnType<typeof makeTabItem>;
  priorInsightScopes: PriorInsightScope[];
  analysisScopes: AnalysisScope[];
}

/**
 * Walk from the root analysis into `analysisPath`: descend the analyses
 * tree, narrow the universe to each sub-analysis's selections, and
 * accumulate the prior-insight / analysis scope stacks the prose parser
 * needs for cross-scope anchor resolution.
 */
function resolveScope(
  root: string,
  universe: string | undefined,
  analysisPath: string[],
): Scope {
  const source = getSource(root, universe);
  let analysis = source.analysis;
  let activeUniverse = source.universe;
  const priorInsightScopes: PriorInsightScope[] = [];
  const analysisScopes: AnalysisScope[] = [];
  const slugParts: string[] = [];
  // The scope's results root: the project dir, extended by each descended
  // sub-analysis's `path:` (relative to its parent, so nesting composes). An
  // output's artifact then lives at `<resultsBase>/results/<universe>/<id>/`.
  let resultsBase = root;

  for (const seg of analysisPath) {
    const child = analysis.analyses?.[seg];
    if (!child) {
      throw new Error(
        `unknown sub-analysis "${seg}" (path: ${analysisPath.join('.') || '<root>'})`,
      );
    }
    const parentSlug = slugParts.length ? slugParts.join('/') : 'index';
    const localPI = analysis.prior_insights ?? {};
    if (Object.keys(localPI).length > 0) {
      priorInsightScopes.push({ slug: parentSlug, priorInsights: localPI });
    }
    analysisScopes.push({ slug: parentSlug, analysis });

    const subNode = activeUniverse.analyses?.[seg];
    activeUniverse = {
      id: activeUniverse.id,
      description: activeUniverse.description,
      decisions: subNode?.decisions ?? {},
      analyses: subNode?.analyses,
    };
    if (child.path) resultsBase = join(resultsBase, child.path.replace(/^\.\//, ''));
    analysis = child;
    slugParts.push(seg);
  }

  const slug = slugParts.length ? slugParts.join('/') : 'index';
  const universeId = source.universe.id;
  const results: ArtifactResolver = (id) => resolveArtifact(resultsBase, universeId, id);
  const prose = makeProseParser({
    analysis,
    slug,
    priorInsightScopes,
    analysisScopes,
    results,
  });
  const priorInsights = Object.assign(
    {},
    ...priorInsightScopes.map((s) => s.priorInsights),
    analysis.prior_insights ?? {},
  );
  // Resolved view, keyed by declared id: aliased outputs (`from:`) inherit
  // type/description/inputs/decisions/recipe from their source, so the figure/
  // table directive, the provenance disclosure, and inline cards all see the
  // real artifact rather than a bare pointer.
  const outputsById = new Map(
    resolveOutputs(analysis).map(({ resolved }) => [resolved.id, resolved] as const),
  );

  return {
    root,
    analysis,
    universe: activeUniverse,
    results,
    prose,
    priorInsights,
    outputsById,
    slug,
    tabItem: makeTabItem(),
    priorInsightScopes,
    analysisScopes,
  };
}

/** Absolute result path → posix project-relative URL for MyST's asset copy. */
function projectRelative(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

function resultUrl(root: string): (absPath: string) => string {
  return (absPath) => projectRelative(root, absPath);
}

/**
 * Rewrite `/static/<file>` image URLs (the content-server scheme that
 * MySTRA's shared evidence renderer emits) into project-relative result
 * paths so MyST's asset pipeline can copy them. Applied to directive
 * output as a final pass; covers figures embedded as finding evidence.
 */
function rewriteStaticImages(nodes: any[], scope: Scope): any[] {
  walkNodes(nodes, (n) => {
    if (n.type === 'image' && typeof n.url === 'string' && n.url.startsWith('/static/')) {
      const stem = n.url.slice('/static/'.length).replace(/\.[^.]+$/, '');
      const abs = scope.results(stem);
      if (abs) n.url = projectRelative(scope.root, abs);
    }
  });
  return nodes;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function errorNode(message: string): any {
  return {
    type: 'admonition',
    kind: 'error',
    children: [
      { type: 'admonitionTitle', children: [{ type: 'text', value: 'ASTRA plugin' }] },
      { type: 'paragraph', children: [{ type: 'text', value: message }] },
    ],
  };
}

/** Split a component path into [analysisPath, componentId]. */
function splitPath(arg: unknown): { analysisPath: string[]; id: string | null } {
  const parts = String(arg ?? '')
    .trim()
    .split('.')
    .filter(Boolean);
  const id = parts.pop() ?? null;
  return { analysisPath: parts, id };
}

// ── Recognition markers ─────────────────────────────────────────────────────
//
// Every placed ASTRA block carries a stable `astra-<kind>` class (+ optional
// `--<subtype>`) on the node that bears its `<kind>-<id>` identifier. The class
// is harmless to book-theme but lets a rich theme select the element
// (`.astra-output`, `[identifier^="output-"]`) and join it to the resolved
// store by id (STRATEGY-A-REFACTOR.md §5).

/** Add a semantic class to a node, idempotently (space-joined). */
function addClass(node: any, cls: string): void {
  if (!node || typeof node !== 'object') return;
  const have = typeof node.class === 'string' ? node.class.split(/\s+/).filter(Boolean) : [];
  if (!have.includes(cls)) have.push(cls);
  node.class = have.join(' ');
}

/**
 * Tag the carrier node of a rendered component (the one bearing
 * `<idPrefix>-<id>`, else the first node) with `astra-<kind>` and, when given,
 * `astra-<kind>--<subtype>`. Returns the same node array for chaining.
 */
function tagComponent(
  nodes: any[],
  kind: string,
  idPrefix: string,
  id: string,
  subtype?: string,
): any[] {
  const ident = `${idPrefix}-${id}`;
  const carrier = nodes.find((n) => n?.identifier === ident) ?? nodes[0];
  if (carrier) {
    addClass(carrier, `astra-${kind}`);
    if (subtype) addClass(carrier, `astra-${kind}--${subtype}`);
  }
  return nodes;
}

// ── Block directives ("import") ─────────────────────────────────────────────

/** Directive that resolves a `<sub>.<id>` path and renders one component. */
function componentDirective(
  name: string,
  render: (id: string, scope: Scope, options: Record<string, any>) => any[],
  options?: Record<string, any>,
) {
  return {
    name: `astra:${name}`,
    doc: `Import the ASTRA ${name} <id> as a rich block.`,
    arg: { type: String, required: true, doc: 'Component path: <id> or <sub>.<id>' },
    ...(options ? { options } : {}),
    run(data: any): any[] {
      const { analysisPath, id } = splitPath(data?.arg);
      if (!id) return [errorNode(`astra:${name} requires an id`)];
      try {
        const scope = resolveScope(projectRoot(), universeName(), analysisPath);
        return rewriteStaticImages(render(id, scope, data?.options ?? {}), scope);
      } catch (err) {
        return [errorNode(`astra:${name} "${data?.arg}": ${(err as Error).message}`)];
      }
    },
  };
}

/**
 * A collapsed "ASTRA provenance" disclosure for an output: its id + type, the
 * upstream products it was derived from, the decisions that parameterise it,
 * and the recipe command. Emitted as a sibling after the figure/table so the
 * embedded output reads as a first-class, traceable analysis product.
 */
function outputProvenance(output: Output, id: string): any {
  const inner: any[] = [
    summary([strong([text('ASTRA provenance')]), text(` — ${id} · ${output.type ?? 'output'}`)]),
  ];
  const inputs = output.inputs ?? [];
  if (inputs.length > 0) {
    const shown = inputs.slice(0, 6).join(', ') + (inputs.length > 6 ? ', …' : '');
    inner.push(
      paragraph([
        strong([text('Derived from: ')]),
        text(`${inputs.length} upstream product${inputs.length === 1 ? '' : 's'} — `),
        inlineCode(shown),
      ]),
    );
  }
  const decisions = output.decisions ?? [];
  if (decisions.length > 0) {
    const parts: any[] = [strong([text('Decisions: ')])];
    decisions.forEach((d, i) => {
      if (i > 0) parts.push(text(', '));
      parts.push(crossReference(`decision-${d}`, [text(d)]));
    });
    inner.push(paragraph(parts));
  }
  if (output.recipe?.command) {
    inner.push(code('bash', output.recipe.command));
  }
  return details(inner, false);
}

/** Directive whose whole arg is a scope path (no trailing component). */
function tableDirective(name: string, render: (scope: Scope) => any[]) {
  return {
    name: `astra:${name}`,
    doc: `Render the ASTRA ${name} table for an analysis scope (default: root).`,
    arg: { type: String, required: false, doc: 'Sub-analysis scope, e.g. clustering' },
    run(data: any): any[] {
      const analysisPath = String(data?.arg ?? '')
        .trim()
        .split('.')
        .filter(Boolean);
      try {
        const scope = resolveScope(projectRoot(), universeName(), analysisPath);
        return render(scope);
      } catch (err) {
        return [errorNode(`astra:${name} "${data?.arg ?? ''}": ${(err as Error).message}`)];
      }
    },
  };
}

const decisionDirective = componentDirective('decision', (id, scope) => {
  const decision = scope.analysis.decisions?.[id];
  if (!decision) throw new Error(`no decision "${id}" in this scope`);
  if (!isDecisionRendered(decision, scope.universe)) {
    throw new Error(
      `decision "${id}" is a bare from-reference or its \`when\` is unmet under universe "${scope.universe.id}"`,
    );
  }
  return tagComponent(
    renderDecision(
      id,
      decision,
      scope.priorInsights,
      scope.universe,
      scope.prose,
      scope.tabItem,
    ),
    'decision',
    'decision',
    id,
  );
});

const outputDirective = componentDirective('output', (id, scope) => {
  const output = scope.outputsById.get(id);
  if (!output) throw new Error(`no output "${id}" in this scope`);
  const figure = renderOneOutput(output, id, scope.results, scope.prose, {
    resultUrl: resultUrl(scope.root),
  });
  // Rich representation: the rendered artifact + a collapsed ASTRA provenance
  // disclosure (id/type, upstream products, decisions, recipe). The carrier
  // (figure/table) is tagged `astra-output[ --<type>]` for theme recognition.
  return tagComponent([...figure, outputProvenance(output, id)], 'output', 'output', id, output.type);
});

const findingDirective = componentDirective(
  'finding',
  (id, scope, options) => {
    const findings = scope.analysis.findings ?? {};
    const finding = findings[id];
    if (!finding) throw new Error(`no finding "${id}" in this scope`);
    const index = Object.keys(findings).indexOf(id) + 1;
    // `:compact:` renders just the claim heading + notes + scope (no evidence
    // figures) — used for the back-matter hover/click targets so the inline
    // hover overlay stays tight and figures aren't duplicated.
    if (options?.compact) {
      const nodes: any[] = [
        heading(3, [text(`${index}. `), ...scope.prose.inline(finding.claim)], `finding-${id}`),
      ];
      if (finding.notes) nodes.push(...scope.prose.blocks(finding.notes));
      if (finding.scope) nodes.push(paragraph([emphasis([text(`Scope: ${finding.scope}`)])]));
      return tagComponent(nodes, 'finding', 'finding', id);
    }
    return tagComponent(
      renderFinding(
        finding,
        index,
        id,
        scope.results,
        scope.outputsById,
        scope.prose,
      ),
      'finding',
      'finding',
      id,
    );
  },
  { compact: { type: Boolean, doc: 'Render claim + notes + scope only (no evidence figures).' } },
);

/**
 * Render an author-placed prior insight (the `:::{astra:prior-insight}` block):
 * the claim + evidence wrapped in a `seealso` admonition (a node every MyST
 * theme renders cleanly), carrying the `prior_insight-<id>` identifier.
 *
 * A `container[kind=prior-insight]` would be the natural node, but the stock
 * theme rejects it ("no valid content besides caption"); the `seealso`
 * admonition is the stock-friendly equivalent.
 */
function renderPriorInsightBlock(id: string, insight: Insight, prose: ProseParser): any {
  const titleBits = ['Prior insight'];
  if (insight.label) titleBits.push(insight.label);
  else if (insight.scope) titleBits.push(insight.scope);
  const body = [
    paragraph(prose.inline(insight.claim)),
    ...renderInsightEvidence(insight),
  ];
  const node: any = admonition('seealso', [admonitionTitle([text(titleBits.join(' — '))]), ...body], {
    class: 'astra-prior-insight',
  });
  node.identifier = `prior_insight-${id}`;
  node.label = node.identifier;
  return node;
}

const priorInsightDirective = componentDirective('prior-insight', (id, scope) => {
  // `scope.priorInsights` already merges this analysis's own prior_insights over
  // its ancestors' (see resolveScope), so it's the single lookup to use.
  const insight = scope.priorInsights[id];
  if (!insight) throw new Error(`no prior_insight "${id}" in this scope`);
  return [renderPriorInsightBlock(id, insight, scope.prose)];
});

const inputsDirective = tableDirective('inputs', (scope) => {
  const inputs = scope.analysis.inputs ?? [];
  if (inputs.length === 0) return [errorNode('no inputs in this scope')];
  // Inputs are only carried by this table (no rich input block), so the
  // `input-<id>` row identifiers stay as the canonical anchor targets.
  const table = renderInputsTable(inputs, scope.prose);
  addClass(table, 'astra-inputs');
  return [table];
});

const outputsDirective = tableDirective('outputs', (scope) => {
  const outputs = scope.analysis.outputs ?? [];
  if (outputs.length === 0) return [errorNode('no outputs in this scope')];
  const table = renderOutputsTable(outputs, scope.prose);
  // Strip row identifiers: the canonical `output-<id>` carrier is the rich
  // `:::{astra:output}` block. Leaving them here would collide when the
  // report both lists an output in the registry and embeds it as a figure.
  for (const row of table.children ?? []) {
    delete row.identifier;
    delete row.label;
  }
  addClass(table, 'astra-outputs');
  return [table];
});

const subAnalysisDirective = {
  name: 'astra:subanalysis',
  doc: 'Render a navigation card linking to a sub-analysis page.',
  arg: { type: String, required: true, doc: 'Sub-analysis path, e.g. reconstruction' },
  run(data: any): any[] {
    const { analysisPath, id } = splitPath(data?.arg);
    if (!id) return [errorNode('astra:subanalysis requires a sub-analysis id')];
    try {
      const scope = resolveScope(projectRoot(), universeName(), analysisPath);
      const sub = scope.analysis.analyses?.[id];
      if (!sub) throw new Error(`no sub-analysis "${id}" in this scope`);
      const title = sub.name ?? id;
      const url = '/' + [...analysisPath, id].join('/');
      const summary = firstParagraphText(sub.narrative?.summary);
      const children = summary ? [paragraph([text(summary)])] : [];
      const node: any = card(title, children, url);
      node.identifier = `analysis-${id}`;
      node.label = node.identifier;
      addClass(node, 'astra-subanalysis');
      return [node];
    } catch (err) {
      return [errorNode(`astra:subanalysis "${data?.arg}": ${(err as Error).message}`)];
    }
  },
};

// ── Inline reference tokens (store-driven) ──
//
// Each inline ASTRA reference renders as a neutral `astra-ref` span: the best
// available label as text, plus the join key (`kind`/`id`/`path`) on
// `data.astra`. The hover card is NOT baked into the node — a rich theme
// (`lightcone-astra`) joins the key to the resolved store carrier
// (`.astra-store`, keyed by id) and renders the card, the same mechanism MyST
// uses for citations (a `cite` node's label → `references.cite.data`). On a bare
// theme (no renderer) the span degrades to plain label text. See the resolved
// store (`./transform/resolved-store.ts`) for the data the theme reads.

type CiteKind = 'decision' | 'output' | 'finding' | 'prior_insight' | 'analysis';

/** snake_case id → readable words, for the inline label when nothing better. */
function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

// The store-driven inline node (`refNode`, in ast-helpers) carries only semantic
// classes, the label as text, and the join key on `data.astra`; a rich theme
// renders the card from the store. `value` is self-describing — see the value role.

/** Resolve the best inline label (and output subtype) for a cited element. */
function citeLabel(
  kind: CiteKind,
  id: string,
  scope: Scope,
  display?: string | null,
): { label: string; subtype?: string } {
  switch (kind) {
    case 'decision': {
      const dec = scope.analysis.decisions?.[id];
      return { label: display ?? dec?.label ?? humanize(id) };
    }
    case 'finding': {
      const f = scope.analysis.findings?.[id];
      return { label: display ?? f?.label ?? humanize(id) };
    }
    case 'prior_insight': {
      const ins = scope.priorInsights[id]; // already merged over ancestor scopes
      return { label: display ?? ins?.label ?? humanize(id) };
    }
    case 'analysis': {
      const sub = scope.analysis.analyses?.[id];
      return { label: display ?? sub?.name ?? humanize(id) };
    }
    default: {
      // output — `subtype` (figure/table/metric/…) is a second modifier class so
      // a theme can give each output type its own glyph/treatment.
      const o = scope.outputsById.get(id);
      return { label: display ?? o?.label ?? humanize(id), subtype: o?.type ?? 'output' };
    }
  }
}

/** Inline citation → neutral `astra-ref` token carrying the store join key. */
function citeRole(name: string, kind: CiteKind) {
  return {
    name: `astra:${name}`,
    doc: `Inline reference to an ASTRA ${name} (a theme renders its card from the store).`,
    body: {
      type: String,
      required: true,
      doc: 'Path: <id> or <sub>.<id>, optionally `<id>|display text` for the inline label',
    },
    run(data: any): any[] {
      // Optional `|display text` overrides the inline label (the card still
      // shows the element's own label/claim).
      const [pathPart, ...rest] = String(data?.body ?? '').split('|');
      const display = rest.join('|').trim() || null;
      const { analysisPath, id } = splitPath(pathPart);
      if (!id) return [text(String(data?.body ?? ''))];
      const path = [...analysisPath, id].join('.');
      try {
        const scope = resolveScope(projectRoot(), universeName(), analysisPath);
        const { label, subtype } = citeLabel(kind, id, scope, display);
        return [refNode(kind, id, path, label, subtype)];
      } catch {
        return [refNode(kind, id, path, display ?? humanize(id))];
      }
    },
  };
}

// ── Value interpolation role ────────────────────────────────────────────────

/** Format a numeric string to `sig` significant figures, trimming zeros. */
function fmtNum(raw: string, sig: number): string {
  const x = Number(raw);
  if (!isFinite(x)) return String(raw);
  // Round to `sig` figures, then let Number→String drop trailing zeros and
  // normalise the form (e.g. 200000 not 2.000e+5, 0.0696 not 0.06960).
  return String(Number(x.toPrecision(sig)));
}

function valueError(msg: string): any {
  return { type: 'inlineCode', value: `⟨value: ${msg}⟩` };
}

/**
 * `{astra:value}` — interpolate a real number from a materialised result
 * product, so no measured value is ever hard-typed into the prose.
 *
 * Body grammar (whitespace-separated):
 *   <output-path> col=<column> [<key>=<val> ...] [pm] [sig=N]
 *
 *   - `<output-path>`  output id, optionally scoped (`clustering.xi_…`).
 *   - `col=`           the column to read (table outputs).
 *   - `<key>=<val>`    row filters, e.g. `tracer=lrg3_elg1 recon=Post`.
 *   - `pm`             also render `± <col>_std` when that column exists.
 *   - `sig=N`          significant figures (default 4).
 *
 * e.g. ``{astra:value}`bao_distance_table tracer=lrg3_elg1 col=DV_over_rd pm` ``
 * reads `results/<universe>/bao_distance_table/…csv` and renders `19.88 ± 0.17`.
 */
const valueRole = {
  name: 'astra:value',
  doc: 'Interpolate a numeric cell from a table result product (no hard-typed numbers).',
  body: { type: String, required: true, doc: '<output> col=<col> [<key>=<val> ...] [pm] [sig=N]' },
  run(data: any): any[] {
    const tokens = String(data?.body ?? '').trim().split(/\s+/).filter(Boolean);
    const path = tokens.shift();
    if (!path) return [valueError('missing output path')];
    const opts: Record<string, string | true> = {};
    for (const t of tokens) {
      const i = t.indexOf('=');
      if (i < 0) opts[t] = true;
      else opts[t.slice(0, i)] = t.slice(i + 1);
    }
    try {
      const { analysisPath, id } = splitPath(path);
      if (!id) return [valueError(`missing output id in "${path}"`)];
      const scope = resolveScope(projectRoot(), universeName(), analysisPath);
      const abs = scope.results(id);
      if (!abs) return [valueError(`no result file for "${path}"`)];
      const tbl = parseTableData(abs);
      if (!tbl) return [valueError(`"${id}" is not tabular`)];
      const col = typeof opts['col'] === 'string' ? (opts['col'] as string) : null;
      if (!col) return [valueError(`missing col= for "${id}"`)];
      const ci = tbl.headers.indexOf(col);
      if (ci < 0) return [valueError(`no column "${col}" in "${id}"`)];
      const reserved = new Set(['col', 'pm', 'sig', 'err']);
      const filters = Object.entries(opts).filter(([k]) => !reserved.has(k));
      const row = tbl.rows.find((r) =>
        filters.every(([k, v]) => {
          const ki = tbl.headers.indexOf(k);
          return ki >= 0 && String(r[ki]).toLowerCase() === String(v).toLowerCase();
        }),
      );
      if (!row) {
        const desc = filters.map(([k, v]) => `${k}=${v as string}`).join(', ') || '(no filter)';
        return [valueError(`no row [${desc}] in "${id}"`)];
      }
      const sig = typeof opts['sig'] === 'string' ? parseInt(opts['sig'] as string, 10) : 4;
      let out = fmtNum(row[ci], sig);
      // Uncertainty: explicit `err=<col>`, else `pm` uses the `<col>_std`
      // convention (matches the distance table; the α table needs `err=`).
      const errCol =
        typeof opts['err'] === 'string' ? (opts['err'] as string) : opts['pm'] ? `${col}_std` : null;
      if (errCol) {
        const ei = tbl.headers.indexOf(errCol);
        if (ei >= 0 && row[ei] != null && row[ei] !== '' && row[ei] !== '-') {
          out += ` ± ${fmtNum(row[ei], 2)}`;
        }
      }
      // A value isn't a standalone store element, so its node is self-describing:
      // the computed number is the text, and `data.astra` carries the source
      // product id + column + row filter the theme renders as provenance (it can
      // still join `store.outputs[id]` for the product's label/type). No
      // whole-table overlay — just where this number came from.
      const output = scope.outputsById.get(id);
      const subtype = output?.type ?? 'table';
      const filterDesc = filters.map(([k, v]) => `${k}=${v as string}`).join(', ');
      // Same `astra-ref` node shape as the cite roles (built by `refNode`), plus
      // the value-specific provenance the theme renders: column, row filter, and
      // the source product's type/label.
      const node = refNode('value', id, [...analysisPath, id].join('.'), out, subtype);
      Object.assign(node.data.astra, {
        col,
        filter: filterDesc,
        type: output?.type ?? 'table',
        product: output?.label,
      });
      return [node];
    } catch (err) {
      return [valueError((err as Error).message)];
    }
  },
};

// ── Transform: ASTRA anchor grammar in author prose ──────────────────────────

/**
 * The ASTRA scope a page maps to, or `null` for non-ASTRA pages (e.g. an
 * `about.md`). Scope is derived from the file's basename using the
 * **dotted-filename convention**, which composes to any nesting depth with
 * zero config: each `.`-segment is one analysis level, so `index.md` → root,
 * `reconstruction.md` → `[reconstruction]`, and
 * `reconstruction.features.md` → `[reconstruction, features]`. A page may also
 * override this explicitly via the `astra_scope` frontmatter key (a dotted
 * string `'reconstruction.features'` or an already-split `string[]`).
 */
function scopeForFile(vfile: any): Scope | null {
  const base = basename(vfile?.path ?? '', '.md');
  // Dotted basename is the canonical, always-available derivation; `index`
  // maps to the root scope (empty path), every other dot-segment descends one
  // analysis level. `.filter(Boolean)` drops empties from a leading/trailing
  // dot so a stray `.` never yields an unknown-sub-analysis throw.
  let analysisPath = base && base !== 'index' ? base.split('.').filter(Boolean) : [];
  // Best-effort frontmatter override: if the page declares `astra_scope`, prefer
  // it. Guarded defensively — the transform harness passes a bare `{ path }`
  // vfile with no `data`/`frontmatter`, so this stays a bonus over the basename.
  const explicit = vfile?.data?.frontmatter?.astra_scope;
  if (Array.isArray(explicit)) {
    analysisPath = explicit.map((s) => String(s)).filter(Boolean);
  } else if (typeof explicit === 'string') {
    analysisPath = explicit.split('.').filter(Boolean);
  }
  try {
    return resolveScope(projectRoot(), universeName(), analysisPath);
  } catch {
    return null;
  }
}

/**
 * Rewrite ASTRA tree-path anchor links (`[text](#decisions.x)`,
 * `#outputs.y`, `#analyses.sub.outputs.z`, …) that appear in the *author's*
 * prose into `crossReference` nodes (same page) or sub-page links — reusing
 * MySTRA's `resolveNarrativeAnchors`. Directives already resolve anchors in
 * the prose they render; this covers anchors the author writes directly.
 * Author-written output-image anchors gain a `/static/` url here, so the
 * same `rewriteStaticImages` pass the directives use rewrites them to a
 * project-relative path MyST can copy.
 */
const anchorTransform = {
  name: 'astra-anchor-grammar',
  doc: 'Resolve ASTRA #path.to.element anchor links to cross-references.',
  stage: 'document',
  plugin: () => (tree: any, vfile: any) => {
    const scope = scopeForFile(vfile);
    if (!scope) return;
    const resolved = resolveNarrativeAnchors(
      tree.children ?? [],
      scope.analysis,
      scope.slug,
      scope.priorInsightScopes,
      scope.results,
      scope.analysisScopes,
    );
    tree.children = rewriteStaticImages(resolved, scope);
  },
};

// ── Transform: emit the resolved ASTRA store for rich themes ─────────────────
//
// The theme cannot read `astra.yaml` (it only sees the build output), so the
// plugin bakes a *resolved* projection of the page's analysis scope — keyed by
// id — onto a hidden carrier node's `data`. A rich theme selects the carrier
// (`.astra-store`) and joins each placed element's identifier (`output-<id>`,
// `decision-<id>`, …) to its store entry, enabling cards / dependency graphs /
// alternative layouts without re-implementing ASTRA semantics. The carrier is
// an empty `display:none` div, so it is invisible on book-theme.
// See STRATEGY-A-REFACTOR.md §5.

/** Ancestor input maps (innermost-last) for resolving aliased `from:` inputs. */
function parentInputMaps(scope: Scope): Map<string, Input>[] {
  return scope.analysisScopes.map(
    (s) => new Map((s.analysis.inputs ?? []).map((i) => [i.id, i] as const)),
  );
}

const storeTransform = {
  name: 'astra-resolved-store',
  doc: 'Emit the resolved ASTRA data store (keyed by id) for rich themes.',
  stage: 'document',
  plugin: () => (tree: any, vfile: any) => {
    const scope = scopeForFile(vfile);
    if (!scope) return;
    const store = buildResolvedStore(
      scope.analysis,
      scope.universe,
      scope.results,
      scope.slug,
      resultUrl(scope.root),
      parentInputMaps(scope),
      scope.priorInsights,
    );
    const carrier: any = hiddenDiv('astra-store');
    carrier.identifier = 'astra-store';
    carrier.data = { astra: store };
    (tree.children ??= []).push(carrier);
  },
};

// ── Plugin export ─────────────────────────────────────────────────────────

const plugin = {
  name: 'astra',
  directives: [
    decisionDirective,
    outputDirective,
    findingDirective,
    priorInsightDirective,
    inputsDirective,
    outputsDirective,
    subAnalysisDirective,
  ],
  roles: [
    citeRole('decision', 'decision'),
    citeRole('output', 'output'),
    citeRole('finding', 'finding'),
    citeRole('prior-insight', 'prior_insight'),
    citeRole('analysis', 'analysis'),
    valueRole,
  ],
  transforms: [anchorTransform, storeTransform],
};

export default plugin;

// ── Library exports (for programmatic use) ──────────────────────────────────
export { loadASTRASource } from './loader.js';
export type { ASTRASource } from './loader.js';
export { buildResolvedStore } from './transform/resolved-store.js';
export type {
  ResolvedStore,
  SerializedOutput,
  SerializedInput,
  SerializedDecision,
  SerializedFinding,
  SerializedInsight,
  SerializedSubAnalysis,
  SerializedMetric,
  SerializedRecipe,
} from './transform/resolved-store.js';
