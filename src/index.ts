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
  inlineCode,
  makeTabItem,
  paragraph,
  strong,
  summary,
  text,
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

const projectCache = new Map<string, Source>();

function getSource(root: string, universe?: string): Source {
  const key = `${root}::${universe ?? ''}`;
  let src = projectCache.get(key);
  if (!src) {
    src = loadASTRASource(root, universe);
    projectCache.set(key, src);
  }
  return src;
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
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'image' && typeof n.url === 'string' && n.url.startsWith('/static/')) {
      const stem = n.url.slice('/static/'.length).replace(/\.[^.]+$/, '');
      const abs = scope.results(stem);
      if (abs) n.url = projectRelative(scope.root, abs);
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  nodes.forEach(walk);
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

const priorInsightDirective = componentDirective('prior-insight', (id, scope) => {
  const insight = scope.analysis.prior_insights?.[id] ?? scope.priorInsights[id];
  if (!insight) throw new Error(`no prior_insight "${id}" in this scope`);
  // MySTRA's renderPriorInsight emits a `container[kind=prior-insight]`,
  // which the stock theme rejects ("no valid content besides caption").
  // For stock rendering we wrap the same content (claim + evidence) in a
  // `seealso` admonition — a node every MyST theme renders cleanly — and
  // carry the `prior_insight-<id>` identifier so cross-references resolve.
  const titleBits = ['Prior insight'];
  if (insight.label) titleBits.push(insight.label);
  else if (insight.scope) titleBits.push(insight.scope);
  const body = [
    paragraph(scope.prose.inline(insight.claim)),
    ...renderInsightEvidence(insight),
  ];
  const node: any = admonition('seealso', [admonitionTitle([text(titleBits.join(' — '))]), ...body], {
    class: 'astra-prior-insight',
  });
  node.identifier = `prior_insight-${id}`;
  node.label = node.identifier;
  return [node];
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

// ── Inline reference tokens with hover preview cards (Tier 1/2) ──
//
// Each inline ASTRA reference renders as a small token — a kind glyph + the
// element's label — carrying a self-contained hover card built from
// `astra.yaml`. The card is plain inline `span` nodes (which the stock theme
// renders) revealed on hover by custom CSS (`prototype/custom.css`): no theme
// fork, no graph views, just a focused preview of the referenced element.

type CiteKind = 'decision' | 'output' | 'finding' | 'prior_insight' | 'analysis';

const KIND_NAME: Record<string, string> = {
  decision: 'Decision',
  finding: 'Finding',
  prior_insight: 'Prior insight',
  analysis: 'Sub-analysis',
  output: 'Output',
  value: 'Value',
};

function span(cls: string, children: any[]): any {
  return { type: 'span', class: cls, children };
}
function tspan(cls: string, value: string): any {
  return span(cls, [text(value)]);
}
function clip(s: string | undefined, n = 220): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
/** snake_case id → readable words, for the inline label when nothing better. */
function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

// Neutral by design: tokens and cards carry ONLY semantic classes
// (`astra-ref`/`astra-card` + `--<kind>` / `--<subtype>` modifiers) and text.
// No glyphs, colours, or inline styles are baked into the AST — all appearance
// is left to CSS keyed on these classes, so any theme can restyle the overlays.

/** A hover preview card: eyebrow + title + optional labelled body lines. */
function refCard(
  kinds: string[],
  kindName: string,
  id: string,
  title: string,
  lines: Array<{ cls: string; text: string }>,
): any {
  const cls = ['astra-card', ...kinds.map((k) => `astra-card--${k}`)].join(' ');
  const kids: any[] = [
    tspan('astra-card__eyebrow', `${kindName} · ${id}`),
    tspan('astra-card__title', title),
  ];
  for (const l of lines) if (l.text) kids.push(tspan(l.cls, l.text));
  const node: any = span(cls, kids);
  // Hidden by default so a bare viewer (plugin only, no theme CSS) shows just
  // the clean label — never the card content inline. A theme/stylesheet reveals
  // it on hover (overriding this with `display:… !important`). `style` must be
  // an object — the React renderer rejects a string.
  node.style = { display: 'none' };
  return node;
}

/** An inline token: label + hover card; kind/subtype carried as classes. */
function refToken(kinds: string[], label: string, card: any): any {
  const cls = ['astra-ref', ...kinds.map((k) => `astra-ref--${k}`)].join(' ');
  return span(cls, [tspan('astra-ref__label', label), card]);
}

/** Build the inline token + preview card for one cited element. */
function buildCite(kind: CiteKind, id: string, scope: Scope, display?: string | null): any {
  if (kind === 'decision') {
    const dec = scope.analysis.decisions?.[id];
    if (!dec) return tspan('astra-ref astra-ref--decision', display ?? humanize(id));
    const sel = scope.universe.decisions?.[id] ?? dec.default;
    const selLabel = sel ? dec.options?.[sel]?.label ?? sel : null;
    const label = display ?? dec.label ?? humanize(id);
    const card = refCard(['decision'], KIND_NAME['decision'], id, label, [
      { cls: 'astra-card__pick', text: selLabel ? `Selected: ${selLabel}` : '' },
      { cls: 'astra-card__body', text: clip(dec.rationale) },
    ]);
    return refToken(['decision'], label, card);
  }
  if (kind === 'finding') {
    const f = scope.analysis.findings?.[id];
    if (!f) return tspan('astra-ref astra-ref--finding', display ?? humanize(id));
    const label = display ?? f.label ?? humanize(id);
    const card = refCard(['finding'], KIND_NAME['finding'], id, clip(f.claim, 160), [
      { cls: 'astra-card__body', text: clip(f.notes, 200) },
      { cls: 'astra-card__meta', text: f.scope ? `Scope: ${f.scope}` : '' },
    ]);
    return refToken(['finding'], label, card);
  }
  if (kind === 'prior_insight') {
    const ins = scope.analysis.prior_insights?.[id] ?? scope.priorInsights[id];
    if (!ins) return tspan('astra-ref astra-ref--prior_insight', display ?? humanize(id));
    const label = display ?? ins.label ?? humanize(id);
    const ev = (ins.evidence ?? []).find((e) => e.doi && e.quote?.exact);
    // Citation hint is the bare DOI; MyST owns author–year resolution.
    const card = refCard(['prior_insight'], KIND_NAME['prior_insight'], id, label, [
      { cls: 'astra-card__body', text: clip(ins.claim, 200) },
      { cls: 'astra-card__quote', text: ev?.quote?.exact ? `“${ev.quote.exact}”` : '' },
      { cls: 'astra-card__meta', text: ev?.doi ?? '' },
    ]);
    return refToken(['prior_insight'], label, card);
  }
  if (kind === 'analysis') {
    const sub = scope.analysis.analyses?.[id];
    if (!sub) return tspan('astra-ref astra-ref--analysis', display ?? humanize(id));
    const label = display ?? sub.name ?? humanize(id);
    const counts = [
      Object.keys(sub.decisions ?? {}).length
        ? `${Object.keys(sub.decisions ?? {}).length} decisions`
        : '',
      (sub.outputs ?? []).length ? `${(sub.outputs ?? []).length} outputs` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const card = refCard(['analysis'], KIND_NAME['analysis'], id, label, [
      { cls: 'astra-card__body', text: clip(firstParagraphText(sub.narrative?.summary), 200) },
      { cls: 'astra-card__meta', text: counts },
    ]);
    return refToken(['analysis'], label, card);
  }
  // output — `subtype` (figure/table/metric/…) is a second modifier class so a
  // theme can give each output type its own glyph/treatment.
  const o = scope.outputsById.get(id);
  if (!o) return tspan('astra-ref astra-ref--output', display ?? humanize(id));
  const subtype = o.type ?? 'output';
  const label = display ?? o.label ?? humanize(id);
  const card = refCard(['output', subtype], KIND_NAME['output'], id, label, [
    { cls: 'astra-card__body', text: clip(o.description, 200) },
    { cls: 'astra-card__meta', text: `${o.type ?? 'output'} product` },
  ]);
  return refToken(['output', subtype], label, card);
}

/** Inline citation → glyph token + hover preview card. */
function citeRole(name: string, kind: CiteKind) {
  return {
    name: `astra:${name}`,
    doc: `Inline reference to an ASTRA ${name}, with a hover preview card.`,
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
      try {
        const scope = resolveScope(projectRoot(), universeName(), analysisPath);
        return [buildCite(kind, id, scope, display)];
      } catch {
        return [tspan(`astra-ref astra-ref--${kind}`, display ?? humanize(id))];
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
      // Render the number as a token with a focused hover card naming its
      // source product, column, and row — so the reader sees the value is
      // sourced data and exactly where it comes from (no whole-table overlay).
      const output = scope.outputsById.get(id);
      const subtype = output?.type ?? 'table';
      const filterDesc = filters.map(([k, v]) => `${k}=${v as string}`).join(', ');
      const card = refCard(['value', subtype], KIND_NAME['value'], id, out, [
        { cls: 'astra-card__pick', text: `Column ${col}` },
        { cls: 'astra-card__body', text: filterDesc ? `Row: ${filterDesc}` : '' },
        {
          cls: 'astra-card__meta',
          text: `${output?.type ?? 'table'} product${output?.label ? ` · ${output.label}` : ''}`,
        },
      ]);
      return [refToken(['value', subtype], out, card)];
    } catch (err) {
      return [valueError((err as Error).message)];
    }
  },
};

// ── Transform: ASTRA anchor grammar in author prose ──────────────────────────

/**
 * The ASTRA scope a page maps to, or `null` for non-ASTRA pages (e.g. an
 * `about.md`). Scope is derived from the file's basename: `index` → root,
 * `<name>` → the `<name>` sub-analysis. (For deeper nesting, declare scope
 * explicitly via paths in roles/directives.)
 */
function scopeForFile(vfile: any): Scope | null {
  const base = basename(vfile?.path ?? '', '.md');
  const analysisPath = base && base !== 'index' ? [base] : [];
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
    );
    const carrier: any = {
      type: 'div',
      class: 'astra-store',
      identifier: 'astra-store',
      style: { display: 'none' },
      data: { astra: store },
      children: [],
    };
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
