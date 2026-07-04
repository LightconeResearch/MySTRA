/**
 * MySTRA — the package entry point and the MyST plugin itself.
 *
 * The **default export is the plugin** (reference this package from `myst.yml`'s
 * `project.plugins`); named exports at the bottom expose the loader + resolved
 * store for programmatic use.
 *
 * Authors reference any part of an ASTRA analysis through a single, unified
 * **path grammar** that mirrors `astra.yaml` (see `./path.ts`). One name —
 * `astra` — drives both surfaces, the MyST way (`{math}` is likewise a role and
 * a directive):
 *
 *   Inline reference (role):
 *     {astra}`outputs.hubble_diagram`              link + hover card
 *     {astra}`our method <decisions.algorithm>`    custom display text
 *     {astra:ref}`outputs.hubble_diagram`             numbered ("Figure 3")
 *     {astra:value col=DV where="tracer=lrg3" pm=true}`outputs.bao_table`   live number
 *     {astra:cite}`prior_insights.recon`           parenthetical citation
 *     {astra:cite:t}`prior_insights.recon`         textual citation
 *
 *   Block embed (directive):
 *     :::{astra} decisions.algorithm    :::        the decision + its options
 *     :::{astra} outputs.hubble_diagram :::        the figure / table / metric
 *     :::{astra} findings.signal        :::        claim + scope + evidence
 *     :::{astra} reconstruction         :::        a sub-analysis nav card
 *     :::{astra} outputs                :::        the outputs registry
 *
 * Paths always resolve from the **root analysis** (a leading `/` is tolerated).
 * See README.md for the authoring guide.
 *
 * The plugin reads the ASTRA project once (cached) and renders each element via
 * the per-kind helpers in `./transform/`.
 *
 * The project root is `process.cwd()` (run `myst start` from the project
 * dir). Decision selections come from the project's universe file (the first
 * in `universes/`).
 */

import { basename, join, relative, sep } from 'node:path';
import { statSync } from 'node:fs';
import {
  loadASTRASource,
  resolveArtifact,
  sourceDependencyPaths,
  type ArtifactResolver,
  type ASTRASource,
} from './loader.js';
import type { Analysis, Decision, Input, Insight, Output, Universe } from '@astra-spec/sdk';
import { reportError, reportWarn } from './diagnostics.js';
import { proseParser } from './transform/prose.js';
import type { ProseParser } from './transform/prose.js';
import {
  admonition,
  admonitionTitle,
  card,
  cite,
  citeGroup,
  emphasis,
  heading,
  hiddenDiv,
  inlineCode,
  link,
  makeTabItem,
  paragraph,
  refNode,
  strong,
  table,
  tableCell,
  tableRow,
  text,
  walkNodes,
} from './transform/ast-helpers.js';
import {
  renderDecision,
  isDecisionRendered,
  selectedOptionId,
  supportingInsightsParagraph,
} from './transform/render-methods.js';
import { renderFinding } from './transform/render-findings.js';
import { renderOneOutput, renderInsightEvidence } from './transform/render-evidence.js';
import { renderInputsTable, renderOutputsTable } from './transform/render-data-sources.js';
import { parseTableData } from './transform/parse-table-data.js';
import { resolveOutputs } from './transform/resolve-output.js';
import { buildResolvedStore, readMetric } from './transform/resolved-store.js';
import { pageFrames, narrow, type ProvFrame } from './transform/provenance.js';
import {
  parseAstraPath,
  pathIdentifier,
  splitDisplay,
  dottedKey,
  type AstraPath,
  type Collection,
} from './path.js';

// ── Project loading + cache ─────────────────────────────────────────────

/** The ASTRA project root: the directory `myst` runs from. */
function projectRoot(): string {
  return process.cwd();
}

/** Cached project source + the `astra.yaml` mtime it was parsed from. */
interface CachedSource {
  source: ASTRASource;
  mtimeMs: number;
}

const projectCache = new Map<string, CachedSource>();

/**
 * Newest mtime across the files a parse depends on (the loader owns the list:
 * `astra.yaml` and the active universe file). `myst start` watches `.md` files,
 * not the spec, so without this a manual rebuild would keep serving a stale
 * parse after either is edited — and editing a `universes/*.yaml` file changes
 * decision selections just as much as editing `astra.yaml` does. A failed stat
 * (file missing / transient race) contributes nothing, so a vanished file falls
 * through to a reload rather than pinning the cache. (Result artifacts are not
 * watched: they are many small files and a rebuild that regenerates them is the
 * expected re-entry point.)
 */
function sourceMtimeMs(root: string): number {
  let newest = -Infinity;
  for (const p of sourceDependencyPaths(root)) {
    try {
      newest = Math.max(newest, statSync(p).mtimeMs);
    } catch {
      // ignore — a missing dependency leaves `newest` as-is
    }
  }
  return newest;
}

function getSource(root: string, vfile?: any): ASTRASource {
  const cached = projectCache.get(root);
  const mtimeMs = sourceMtimeMs(root);
  if (cached && Number.isFinite(mtimeMs) && mtimeMs <= cached.mtimeMs) {
    return cached.source;
  }
  const source = loadASTRASource(root, vfile);
  projectCache.set(root, { source, mtimeMs });
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
  /** The scope's sub-analysis ids (`[]` at root) — the slug, pre-split. */
  slugParts: string[];
  tabItem: ReturnType<typeof makeTabItem>;
  /** Ancestor analyses walked through, outermost first (root … parent). */
  ancestors: Analysis[];
  /** The invoking surface's vfile — renderers route diagnostics through it. */
  vfile?: any;
}

/** A memoizable scope: everything but the per-pass tabItem and per-call vfile. */
type ScopeCore = Omit<Scope, 'tabItem' | 'vfile'>;

/**
 * Memoized scope cores — a {@link Scope} minus its per-pass `tabItem` factory
 * and per-call `vfile` — keyed by `root::path` and invalidated by source
 * identity (`getSource` returns a new object when `astra.yaml` or the
 * universe file change). Roles and directives resolve the same handful of
 * scopes once per `{astra…}` occurrence, so this turns O(refs × outputs)
 * alias resolution into O(outputs) per build.
 */
const scopeCache = new Map<string, { source: ASTRASource; core: ScopeCore }>();

/**
 * Walk from the root analysis into `analysisPath`: descend the analyses
 * tree, narrow the universe to each sub-analysis's selections, merge the
 * prior insights inherited from ancestor scopes, and keep the ancestor
 * stack for aliased-input resolution and provenance tracing.
 */
function resolveScope(root: string, analysisPath: string[], vfile?: any): Scope {
  const source = getSource(root, vfile);
  const cacheKey = `${root}::${analysisPath.join('.')}`;
  const cached = scopeCache.get(cacheKey);
  if (cached && cached.source === source) {
    return { ...cached.core, tabItem: makeTabItem(), vfile };
  }

  let analysis = source.analysis;
  let activeUniverse = source.universe;
  const ancestors: Analysis[] = [];
  const inheritedPriorInsights: Record<string, Insight>[] = [];
  const slugParts: string[] = [];
  let resultsBase = root;

  for (const seg of analysisPath) {
    const child = analysis.analyses?.[seg];
    if (!child) {
      throw new Error(
        `unknown sub-analysis "${seg}" (path: ${analysisPath.join('.') || '<root>'})`,
      );
    }
    if (analysis.prior_insights) inheritedPriorInsights.push(analysis.prior_insights);
    ancestors.push(analysis);

    activeUniverse = {
      id: activeUniverse.id,
      description: activeUniverse.description,
      ...narrow(activeUniverse, seg),
    };
    if (child.path) resultsBase = join(resultsBase, child.path.replace(/^\.\//, ''));
    analysis = child;
    slugParts.push(seg);
  }

  const slug = slugParts.length ? slugParts.join('/') : 'index';
  const universeId = source.universe.id;
  const results: ArtifactResolver = (id) => resolveArtifact(resultsBase, universeId, id);
  const priorInsights = Object.assign(
    {},
    ...inheritedPriorInsights,
    analysis.prior_insights ?? {},
  );
  const outputsById = new Map(
    resolveOutputs(analysis).map(({ resolved }) => [resolved.id, resolved] as const),
  );

  const core: ScopeCore = {
    root,
    analysis,
    universe: activeUniverse,
    results,
    prose: proseParser,
    priorInsights,
    outputsById,
    slug,
    slugParts,
    ancestors,
  };
  scopeCache.set(cacheKey, { source, core });
  return { ...core, tabItem: makeTabItem(), vfile };
}

/** Absolute result path → posix project-relative URL for MyST's asset copy. */
function projectRelative(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

function resultUrl(root: string): (absPath: string) => string {
  return (absPath) => projectRelative(root, absPath);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function errorNode(message: string): any {
  return admonition('error', [
    admonitionTitle([text('ASTRA plugin')]),
    paragraph([text(message)]),
  ]);
}

/** snake_case id → readable words, for the inline label when nothing better. */
function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

// ── Recognition markers ─────────────────────────────────────────────────────
//
// Every placed ASTRA block carries a stable `astra-<kind>` class (+ optional
// `--<subtype>`) on the node that bears its `<kind>-<id>` identifier, letting a
// rich theme select the element (`.astra-output`, `[identifier^="output-"]`) and
// join it to the resolved store by id.

/** Add a semantic class to a node, idempotently (space-joined). */
function addClass(node: any, cls: string): void {
  if (!node || typeof node !== 'object') return;
  const have = typeof node.class === 'string' ? node.class.split(/\s+/).filter(Boolean) : [];
  if (!have.includes(cls)) have.push(cls);
  node.class = have.join(' ');
}

/**
 * Tag the carrier node of a rendered component (the one bearing `<kind>-<id>`,
 * else the first node) with `astra-<kind>` and, when given,
 * `astra-<kind>--<subtype>`. Returns the same node array for chaining.
 */
function tagComponent(nodes: any[], kind: string, id: string, subtype?: string): any[] {
  const carrier = carrierOf(nodes, `${kind}-${id}`);
  if (carrier) {
    addClass(carrier, `astra-${kind}`);
    if (subtype) addClass(carrier, `astra-${kind}--${subtype}`);
  }
  return nodes;
}

/** The carrier node of a rendered component (for option overrides). */
function carrierOf(nodes: any[], identifier: string): any {
  return nodes.find((n) => n?.identifier === identifier) ?? nodes[0];
}

// ── Block directive: `:::{astra} <path>` ─────────────────────────────────────
//
// One directive renders any addressable element, child, or collection. The
// parsed path decides what — an element by kind, a child (option / evidence), a
// whole collection (a registry), or a bare sub-analysis (a nav card).

interface DirectiveOptions {
  label?: string;
  caption?: string;
  compact?: boolean;
  show?: string;
  hide?: string;
  class?: string;
}

/** Resolve which finding parts to render from compact / show / hide options. */
function findingParts(options: DirectiveOptions): Set<string> {
  const all = ['claim', 'notes', 'scope', 'evidence'];
  let parts = new Set(all);
  if (options.show) parts = new Set(options.show.split(/[,\s]+/).filter(Boolean));
  if (options.hide) for (const p of options.hide.split(/[,\s]+/).filter(Boolean)) parts.delete(p);
  if (options.compact) parts.delete('evidence');
  return parts;
}

/**
 * Render one finding, honouring the requested parts (claim is always kept).
 * `index` is the finding's 1-based ordinal; the registry loop passes it in so
 * a full registry render stays O(n).
 */
function renderFindingParts(
  id: string,
  scope: Scope,
  options: DirectiveOptions,
  index?: number,
): any[] {
  const findings = scope.analysis.findings ?? {};
  const finding = findings[id];
  if (!finding) throw new Error(`no finding "${id}" in this scope`);
  return tagComponent(
    renderFinding(finding, index ?? Object.keys(findings).indexOf(id) + 1, id, scope.results, scope.outputsById, scope.prose, {
      parts: findingParts(options),
      resultUrl: resultUrl(scope.root),
      vfile: scope.vfile,
    }),
    'finding',
    id,
  );
}

/**
 * Render a prior insight (the author-placed block): the claim + evidence wrapped
 * in a `seealso` admonition — a node every MyST theme renders cleanly — carrying
 * the `prior_insight-<id>` identifier.
 */
function renderPriorInsightBlock(id: string, insight: Insight, prose: ProseParser): any {
  const titleBits = ['Prior insight'];
  if (insight.label) titleBits.push(insight.label);
  else if (insight.scope) titleBits.push(insight.scope);
  const body = [paragraph(prose.inline(insight.claim)), ...renderInsightEvidence(insight)];
  const node: any = admonition('seealso', [admonitionTitle([text(titleBits.join(' — '))]), ...body], {
    class: 'astra-prior-insight',
  });
  node.identifier = `prior_insight-${id}`;
  node.label = node.identifier;
  return node;
}

/** Render a single input as a one-row registry table tagged `astra-input`. */
function renderOneInput(id: string, scope: Scope): any[] {
  const input = (scope.analysis.inputs ?? []).find((i) => i.id === id);
  if (!input) throw new Error(`no input "${id}" in this scope`);
  const table = renderInputsTable([input], scope.prose);
  addClass(table, 'astra-input');
  return [table];
}

/** Render one Option of a Decision (label + description + supporting insights). */
function renderOneOption(decisionId: string, optionId: string, scope: Scope): any[] {
  const decision = scope.analysis.decisions?.[decisionId];
  if (!decision?.options?.[optionId]) {
    throw new Error(`no option "${optionId}" on decision "${decisionId}" in this scope`);
  }
  const option = decision.options[optionId];
  const selected = selectedOptionId(decisionId, decision, scope.universe) === optionId;
  const identifier = `option-${decisionId}-${optionId}`;
  const head: any = heading(4, [
    text(option.label),
    ...(selected ? [text(' '), emphasis([text('(selected)')])] : []),
  ], identifier);
  const nodes: any[] = [head];
  if (option.description) nodes.push(...scope.prose.blocks(option.description));
  const insightsPara = supportingInsightsParagraph(option.insights ?? [], scope.priorInsights, scope.vfile);
  if (insightsPara) nodes.push(insightsPara);
  addClass(head, 'astra-option');
  return nodes;
}

/** The finding / prior insight an insight-bearing path points at. */
function insightOwner(p: AstraPath, scope: Scope): Insight | undefined {
  return p.collection === 'findings'
    ? scope.analysis.findings?.[p.id!]
    : scope.priorInsights[p.id!];
}

/** Render one Evidence record of a finding or prior insight. */
function renderOneEvidence(p: AstraPath, scope: Scope): any[] {
  const owner = insightOwner(p, scope);
  if (!owner) throw new Error(`no ${p.collection} "${p.id}" in this scope`);
  const ev = (owner.evidence ?? []).find((e: any) => e.id === p.child!.id);
  if (!ev) throw new Error(`no evidence "${p.child!.id}" on ${p.collection} "${p.id}"`);
  // Reuse the per-insight evidence renderer for a single record.
  return renderInsightEvidence({ evidence: [ev] });
}

/** Render a universe as a table of its decision → selected-option labels. */
function renderUniverse(universeId: string | null, scope: Scope): any[] {
  const u = scope.universe;
  const selections = u.decisions ?? {};
  const headerRow = tableRow(
    [tableCell([text('Decision')], true), tableCell([text('Selected')], true)],
    true,
  );
  const rows = Object.keys(selections).map((decId) => {
    const dec = scope.analysis.decisions?.[decId];
    const optId = selections[decId];
    return tableRow([
      tableCell([strong([text(dec?.label ?? decId)])]),
      tableCell([text(dec?.options?.[optId]?.label ?? optId)]),
    ]);
  });
  const node: any = table([headerRow, ...rows]);
  node.identifier = `universe-${universeId ?? u.id}`;
  node.label = node.identifier;
  addClass(node, 'astra-universe');
  return [node];
}

/** Render a sub-analysis as a navigation card linking to its page. */
function renderSubAnalysisCard(parentScope: string[], subId: string, scope: Scope): any[] {
  const sub = scope.analysis.analyses?.[subId];
  if (!sub) throw new Error(`no sub-analysis "${subId}" in this scope`);
  const title = sub.name ?? subId;
  const url = '/' + [...parentScope, subId].join('/');
  const node: any = card(title, [], url);
  node.identifier = `analysis-${subId}`;
  node.label = node.identifier;
  addClass(node, 'astra-subanalysis');
  return [node];
}

/** Render one decision block (heading + tabbed options), tagged for recognition. */
function renderDecisionBlock(id: string, decision: Decision, scope: Scope): any[] {
  return tagComponent(
    renderDecision(id, decision, scope.priorInsights, scope.universe, scope.prose, scope.tabItem, scope.vfile),
    'decision',
    id,
  );
}

/** Render a whole collection (a registry) for the current scope. */
function renderRegistry(collection: Collection, scope: Scope): any[] {
  switch (collection) {
    case 'inputs': {
      const inputs = scope.analysis.inputs ?? [];
      if (inputs.length === 0) return [errorNode('no inputs in this scope')];
      const table = renderInputsTable(inputs, scope.prose);
      addClass(table, 'astra-inputs');
      return [table];
    }
    case 'outputs': {
      const outputs = scope.analysis.outputs ?? [];
      if (outputs.length === 0) return [errorNode('no outputs in this scope')];
      const table = renderOutputsTable(outputs, scope.prose);
      // Strip row identifiers: the canonical `output-<id>` carrier is the rich
      // output block. Leaving them here would collide when the report both lists
      // an output in the registry and embeds it as a figure.
      for (const row of table.children ?? []) {
        delete row.identifier;
        delete row.label;
      }
      addClass(table, 'astra-outputs');
      return [table];
    }
    case 'decisions': {
      const decisions = scope.analysis.decisions ?? {};
      const nodes: any[] = [];
      for (const [id, decision] of Object.entries(decisions)) {
        if (!isDecisionRendered(decision as Decision, scope.universe)) continue;
        nodes.push(...renderDecisionBlock(id, decision as Decision, scope));
      }
      return nodes.length ? nodes : [errorNode('no rendered decisions in this scope')];
    }
    case 'findings': {
      const findings = scope.analysis.findings ?? {};
      const nodes: any[] = [];
      Object.keys(findings).forEach((id, i) => nodes.push(...renderFindingParts(id, scope, {}, i + 1)));
      return nodes.length ? nodes : [errorNode('no findings in this scope')];
    }
    case 'prior_insights': {
      const insights = scope.analysis.prior_insights ?? {};
      const nodes = Object.entries(insights).map(([id, ins]) =>
        renderPriorInsightBlock(id, ins as Insight, scope.prose),
      );
      return nodes.length ? nodes : [errorNode('no prior insights in this scope')];
    }
    case 'analyses': {
      const subs = scope.analysis.analyses ?? {};
      const nodes = Object.keys(subs).flatMap((id) => renderSubAnalysisCard(scope.slugParts, id, scope));
      return nodes.length ? nodes : [errorNode('no sub-analyses in this scope')];
    }
    case 'universes':
      return renderUniverse(null, scope);
  }
}

/** Render a single addressed element (path has a collection + id, no child). */
function renderElement(p: AstraPath, scope: Scope, options: DirectiveOptions): any[] {
  const id = p.id!;
  switch (p.collection) {
    case 'decisions': {
      const decision = scope.analysis.decisions?.[id];
      if (!decision) throw new Error(`no decision "${id}" in this scope`);
      if (!isDecisionRendered(decision, scope.universe)) {
        throw new Error(
          `decision "${id}" is a bare from-reference or its \`when\` is unmet under universe "${scope.universe.id}"`,
        );
      }
      return renderDecisionBlock(id, decision, scope);
    }
    case 'outputs': {
      const output = scope.outputsById.get(id);
      if (!output) throw new Error(`no output "${id}" in this scope`);
      const nodes = renderOneOutput(output, id, scope.results, scope.prose, {
        resultUrl: resultUrl(scope.root),
        vfile: scope.vfile,
      });
      if (options.caption) applyCaption(nodes, scope, options.caption);
      return tagComponent(nodes, 'output', id, output.type);
    }
    case 'findings':
      return renderFindingParts(id, scope, options);
    case 'prior_insights': {
      const insight = scope.priorInsights[id];
      if (!insight) throw new Error(`no prior_insight "${id}" in this scope`);
      return [renderPriorInsightBlock(id, insight, scope.prose)];
    }
    case 'inputs':
      return renderOneInput(id, scope);
    case 'analyses':
      return renderSubAnalysisCard(scope.slugParts, id, scope);
    case 'universes':
      // Renders the project's active universe (there is no universe choice;
      // the path id only names the identifier carrier).
      return renderUniverse(id, scope);
    default:
      return [errorNode(`astra: cannot render "${dottedKey(p.scope, id)}"`)];
  }
}

/** Replace the first caption's content with the author's override text. */
function applyCaption(nodes: any[], scope: Scope, captionMd: string): void {
  let done = false;
  walkNodes(nodes, (n) => {
    if (!done && n.type === 'caption') {
      n.children = [paragraph(scope.prose.inline(captionMd))];
      done = true;
    }
  });
}

const astraDirective = {
  name: 'astra',
  doc: 'Embed any ASTRA element, child, or collection by its path (e.g. outputs.hubble_diagram).',
  arg: {
    type: String,
    required: true,
    doc: 'A path: <collection>.<id>[.<child-id>], a sub-analysis, or a collection.',
  },
  options: {
    label: { type: String, doc: 'Cross-reference label for the rendered block.' },
    caption: { type: String, doc: 'Caption text (figure / table outputs).' },
    compact: { type: Boolean, doc: 'Findings: claim + notes + scope only (no evidence).' },
    show: { type: String, doc: 'Findings: parts to include (claim, notes, scope, evidence).' },
    hide: { type: String, doc: 'Findings: parts to exclude.' },
    class: { type: String, doc: 'Extra CSS class(es) on the rendered block.' },
  },
  run(data: any, vfile: any): any[] {
    const arg = String(data?.arg ?? '');
    const options: DirectiveOptions = data?.options ?? {};
    const p = parseAstraPath(arg);
    if (!p.collection) {
      reportError(vfile, 'astra: empty path', data?.node);
      return [errorNode('astra: empty path')];
    }

    try {
      const scope = resolveScope(projectRoot(), p.scope, vfile);
      let nodes: any[];
      if (p.child) {
        nodes =
          p.child.collection === 'options'
            ? renderOneOption(p.id!, p.child.id, scope)
            : renderOneEvidence(p, scope);
      } else if (p.id) {
        nodes = renderElement(p, scope, options);
      } else {
        nodes = renderRegistry(p.collection, scope);
      }
      applyBlockOptions(nodes, p, options);
      return nodes;
    } catch (err) {
      const message = `astra "${arg}": ${(err as Error).message}`;
      reportError(vfile, message, data?.node);
      return [errorNode(message)];
    }
  },
};

/** Apply `:label:` / `:class:` to the rendered block's carrier node. */
function applyBlockOptions(nodes: any[], p: AstraPath, options: DirectiveOptions): void {
  if (!nodes.length) return;
  const ident = pathIdentifier(p);
  const carrier = ident ? carrierOf(nodes, ident) : nodes[0];
  if (!carrier) return;
  if (options.class) for (const c of options.class.split(/\s+/).filter(Boolean)) addClass(carrier, c);
  if (options.label) {
    carrier.identifier = options.label;
    carrier.label = options.label;
  }
}

// ── Inline reference roles ───────────────────────────────────────────────────
//
// `{astra}` renders a neutral store-driven `astra-ref` span (best label as text
// + a `data.astra` join key). A rich theme joins the key to the resolved store
// and renders a hover card; a bare theme shows the plain label. `{astra:ref}`
// emits a link MyST numbers natively; `{astra:cite[:t]}` emit MyST citations.

type RefKind =
  | 'decision'
  | 'output'
  | 'finding'
  | 'prior_insight'
  | 'analysis'
  | 'input'
  | 'option'
  | 'evidence'
  | 'universe';

/** Resolve a parsed path to its inline reference kind, label, and store key. */
function resolveInlineRef(
  p: AstraPath,
  scope: Scope,
  display: string | null,
): { kind: RefKind; id: string; path: string; label: string; subtype?: string } {
  // Children first — an option / evidence inline reference.
  if (p.child) {
    const ownerId = p.id!;
    if (p.child.collection === 'options') {
      const opt = scope.analysis.decisions?.[ownerId]?.options?.[p.child.id];
      return {
        kind: 'option',
        id: p.child.id,
        path: dottedKey(p.scope, `${ownerId}.${p.child.id}`),
        label: display ?? opt?.label ?? humanize(p.child.id),
      };
    }
    return {
      kind: 'evidence',
      id: p.child.id,
      path: dottedKey(p.scope, `${ownerId}.${p.child.id}`),
      label: display ?? humanize(p.child.id),
    };
  }

  const id = p.id!;
  const path = dottedKey(p.scope, id);
  switch (p.collection) {
    case 'decisions':
      return { kind: 'decision', id, path, label: display ?? scope.analysis.decisions?.[id]?.label ?? humanize(id) };
    case 'findings':
      return { kind: 'finding', id, path, label: display ?? scope.analysis.findings?.[id]?.label ?? humanize(id) };
    case 'prior_insights':
      return { kind: 'prior_insight', id, path, label: display ?? scope.priorInsights[id]?.label ?? humanize(id) };
    case 'analyses': {
      const sub = scope.analysis.analyses?.[id];
      if (!sub) throw new Error(`no sub-analysis "${id}" in this scope`);
      return { kind: 'analysis', id, path, label: display ?? sub.name ?? humanize(id) };
    }
    case 'inputs':
      return { kind: 'input', id, path, label: display ?? (scope.analysis.inputs ?? []).find((i) => i.id === id)?.label ?? humanize(id) };
    case 'universes':
      return { kind: 'universe', id, path, label: display ?? id };
    case 'outputs':
    default: {
      const o = scope.outputsById.get(id);
      return { kind: 'output', id, path, label: display ?? o?.label ?? humanize(id), subtype: o?.type ?? 'output' };
    }
  }
}

/** `{astra}` — inline store-driven reference to any element. */
const astraRole = {
  name: 'astra',
  doc: 'Inline reference to an ASTRA element by path (a theme renders its hover card).',
  body: { type: String, required: true, doc: 'A path, optionally `display text <path>`.' },
  run(data: any, vfile: any): any[] {
    const { display, path } = splitDisplay(String(data?.body ?? ''));
    const p = parseAstraPath(path);
    if (!p.collection) {
      reportWarn(vfile, `astra: empty path in "${String(data?.body ?? '')}" — rendering plain text`, data?.node);
      return [text(String(data?.body ?? ''))];
    }
    try {
      const scope = resolveScope(projectRoot(), p.scope, vfile);
      const r = resolveInlineRef(p, scope, display);
      return [refNode(r.kind, r.id, r.path, r.label, r.subtype)];
    } catch (err) {
      reportWarn(vfile, `astra "${path}": ${(err as Error).message} — rendering a plain label`, data?.node);
      const id = p.id ?? path;
      // Store key in the same collection-elided format as resolveInlineRef;
      // `unresolved` tells the store transform not to attempt a cross-scope
      // merge for a reference that already failed to resolve.
      const key = p.id ? dottedKey(p.scope, p.id) : path;
      const node = refNode('output', id, key, display ?? humanize(id));
      node.data.astra.unresolved = true;
      return [node];
    }
  },
};

/**
 * `{astra:ref}` — native numbered cross-reference (e.g. "Figure 3").
 * `astra:numref` is kept as an alias (mystmd itself ships `numref` only as a
 * Sphinx-compat alias of `{ref}`).
 *
 * Emits a `link` to the target identifier (NOT a `crossReference` node): MyST's
 * reference resolver fills the number/label for link nodes during its own
 * pipeline, but leaves plugin-injected `crossReference` nodes unresolved
 * (`\ref{undefined}`). The empty/`%s` link text is filled by MyST, matching how
 * a plain `[](#output-id)` link numbers a figure.
 */
const astraRefRole = {
  name: 'astra:ref',
  alias: ['astra:numref'],
  doc: 'Numbered cross-reference to a placed output (like {ref}; supports %s).',
  body: { type: String, required: true, doc: 'A path, optionally `text with %s <path>`.' },
  run(data: any, vfile: any): any[] {
    const { display, path } = splitDisplay(String(data?.body ?? ''));
    const p = parseAstraPath(path);
    const ident = pathIdentifier(p);
    if (!ident) {
      reportWarn(vfile, `astra:ref "${path}" is not a referenceable element — rendering plain text`, data?.node);
      return [text(display ?? path)];
    }
    return [link(`#${ident}`, display ? [text(display)] : [])];
  },
};

/** Gather the DOIs backing a finding or prior insight. */
function refDois(p: AstraPath, scope: Scope): string[] {
  const owner = insightOwner(p, scope);
  const dois = (owner?.evidence ?? []).map((e: any) => e.doi).filter(Boolean) as string[];
  return [...new Set(dois)];
}

/** `{astra:cite}` / `{astra:cite:t}` — bibliographic citation from DOI evidence. */
function citeRole(name: string, kind: 'parenthetical' | 'narrative') {
  return {
    name,
    doc: `Cite a finding/prior-insight as a ${kind} author–year citation from its DOI evidence.`,
    body: { type: String, required: true, doc: 'A path to a finding or prior insight.' },
    run(data: any, vfile: any): any[] {
      const { display, path } = splitDisplay(String(data?.body ?? ''));
      const p = parseAstraPath(path);
      try {
        const scope = resolveScope(projectRoot(), p.scope, vfile);
        if (p.collection !== 'findings' && p.collection !== 'prior_insights') {
          throw new Error('astra:cite expects a finding or prior_insight path');
        }
        const dois = refDois(p, scope);
        if (dois.length === 0) {
          // No DOI to cite — fall back to a plain reference token.
          const r = resolveInlineRef(p, scope, display);
          return [refNode(r.kind, r.id, r.path, r.label)];
        }
        const cites = dois.map((d) => cite(d, [], kind));
        return cites.length === 1 ? cites : [citeGroup(cites, kind)];
      } catch (err) {
        const message = `${name} "${path}": ${(err as Error).message}`;
        reportError(vfile, message, data?.node);
        return [inlineCode(`⟨cite: ${(err as Error).message}⟩`)];
      }
    },
  };
}

// ── Value interpolation role ────────────────────────────────────────────────

/** Format a numeric string to `sig` significant figures, trimming zeros. */
function fmtNum(raw: string, sig: number): string {
  const x = Number(raw);
  if (!isFinite(x)) return String(raw);
  return String(Number(x.toPrecision(sig)));
}

function valueError(msg: string): any {
  return inlineCode(`⟨value: ${msg}⟩`);
}

/** Parse a `where="k=v k2=v2"` filter option into `[key, value]` pairs. */
function parseWhere(where: string | undefined): [string, string][] {
  if (!where) return [];
  return where
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => {
      const i = token.indexOf('=');
      if (i <= 0) throw new Error(`bad where= filter "${token}" (expected key=value)`);
      return [token.slice(0, i), token.slice(i + 1)] as [string, string];
    });
}

/**
 * `{astra:value}` — interpolate a real number from the resolved analysis, so no
 * measured value is ever hard-typed into prose. The body is a path; the cell
 * selection is expressed as role options (MyST inline attributes):
 *
 *   {astra:value}`outputs.chi2_reduced`                             a metric
 *   {astra:value col=DV where="tracer=lrg3" pm=true}`outputs.bao_table`
 *   {astra:value}`decisions.algorithm`                    the selected option
 *
 *   - body       a table/metric output (`outputs.bao_table`, scoped allowed)
 *                or a decision; a metric interpolates its scalar directly.
 *   - col=       the column to read (table outputs).
 *   - where=     row filters — space/comma-separated `key=value` pairs,
 *                matched case-insensitively (e.g. "tracer=lrg3 recon=Post").
 *   - pm=true    also render the uncertainty: `<col>_std` for tables, the
 *                metric's own uncertainty field for metrics.
 *   - err=       explicit uncertainty column (implies pm).
 *   - sig=       significant figures (default 4; uncertainties use 2).
 */
const valueRole = {
  name: 'astra:value',
  doc: 'Interpolate a numeric value (table cell, metric, or a decision selection).',
  body: { type: String, required: true, doc: 'A path to a table/metric output or a decision.' },
  options: {
    col: { type: String, doc: 'Table outputs: the column to read.' },
    where: {
      type: String,
      alias: ['filter'],
      doc: 'Row filters: space/comma-separated key=value pairs (case-insensitive).',
    },
    pm: { type: Boolean, doc: 'Append the ± uncertainty (<col>_std, or the metric’s own).' },
    err: { type: String, doc: 'Explicit uncertainty column (implies pm).' },
    sig: { type: Number, doc: 'Significant figures (default 4).' },
  },
  run(data: any, vfile: any): any[] {
    /** Report through MyST diagnostics and return the visible inline token. */
    const fail = (msg: string): any[] => {
      reportError(vfile, `astra:value: ${msg}`, data?.node);
      return [valueError(msg)];
    };
    const pathStr = String(data?.body ?? '').trim();
    const options: { col?: string; where?: string; pm?: boolean; err?: string; sig?: number } =
      data?.options ?? {};
    if (!pathStr) return fail('missing path');
    if (/\s/.test(pathStr)) {
      // The pre-options body grammar (`<path> col=… tracer=… ±`) — point at
      // the role-options form instead of misparsing the path.
      return fail(
        `unexpected content after the path in "${pathStr}" — pass the selection as role options, ` +
          `e.g. {astra:value col=… where="tracer=…"}\`${pathStr.split(/\s+/)[0]}\``,
      );
    }
    try {
      const p = parseAstraPath(pathStr);
      const id = p.id;
      if (!id) return fail(`missing element id in "${pathStr}"`);
      const scope = resolveScope(projectRoot(), p.scope, vfile);

      // A decision's value is the option selected under the active universe.
      if (p.collection === 'decisions') {
        const dec = scope.analysis.decisions?.[id];
        if (!dec) return fail(`no decision "${id}"`);
        const optId = selectedOptionId(id, dec, scope.universe);
        const label = (optId && dec.options?.[optId]?.label) || optId || '(none)';
        const node = refNode('value', id, dottedKey(p.scope, id), label, 'decision');
        Object.assign(node.data.astra, { selection: optId });
        return [node];
      }

      const abs = scope.results(id);
      if (!abs) {
        // An unproduced output is a supported mid-analysis state (the directive
        // surface renders it as a pending admonition), not an authoring error —
        // warn, don't fail strict builds.
        reportWarn(vfile, `astra:value: no result file for "${pathStr}" (output not produced yet)`, data?.node);
        return [valueError(`no result file for "${pathStr}"`)];
      }
      const sig = options.sig ?? 4;
      const output = scope.outputsById.get(id);

      // A metric output interpolates its scalar directly — no col= needed.
      // A metric whose artifact isn't a readable JSON scalar falls through to
      // the tabular path below.
      if (output?.type === 'metric') {
        const metric = readMetric(abs);
        if (metric?.value !== undefined) {
          let out = fmtNum(String(metric.value), sig);
          const unc = metric.uncertainty ?? metric.error;
          if (options.pm && unc !== undefined && unc !== '') out += ` ± ${fmtNum(String(unc), 2)}`;
          const node = refNode('value', id, dottedKey(p.scope, id), out, 'metric');
          Object.assign(node.data.astra, { type: 'metric', product: output.label });
          return [node];
        }
      }

      const tbl = parseTableData(abs);
      if (!tbl) return fail(`"${id}" is not tabular`);
      const col = options.col;
      if (!col) return fail(`missing col= for "${id}"`);
      const ci = tbl.headers.indexOf(col);
      if (ci < 0) return fail(`no column "${col}" in "${id}"`);
      const filters = parseWhere(options.where);
      // Resolve each filter's column index once, not per row.
      const filterCols = filters.map(
        ([k, v]) => [tbl.headers.indexOf(k), v.toLowerCase()] as const,
      );
      const row = tbl.rows.find((r) =>
        filterCols.every(([ki, v]) => ki >= 0 && String(r[ki]).toLowerCase() === v),
      );
      if (!row) {
        const desc = filters.map(([k, v]) => `${k}=${v}`).join(', ') || '(no filter)';
        return fail(`no row [${desc}] in "${id}"`);
      }
      let out = fmtNum(row[ci], sig);
      const errCol = options.err ?? (options.pm ? `${col}_std` : null);
      if (errCol) {
        const ei = tbl.headers.indexOf(errCol);
        if (ei >= 0 && row[ei] != null && row[ei] !== '' && row[ei] !== '-') {
          out += ` ± ${fmtNum(row[ei], 2)}`;
        }
      }
      const subtype = output?.type ?? 'table';
      const filterDesc = filters.map(([k, v]) => `${k}=${v}`).join(', ');
      const node = refNode('value', id, dottedKey(p.scope, id), out, subtype);
      Object.assign(node.data.astra, { col, filter: filterDesc, type: subtype, product: output?.label });
      return [node];
    } catch (err) {
      return fail((err as Error).message);
    }
  },
};

// ── Transform: emit the resolved ASTRA store for rich themes ─────────────────

/**
 * The ASTRA scope a page maps to, or `null` for non-ASTRA pages. Scope is
 * derived from the file's basename using the dotted-filename convention: each
 * `.`-segment is one analysis level, so `index.md` → root, `reconstruction.md`
 * → `[reconstruction]`, `reconstruction.features.md` → `[reconstruction,
 * features]`. A page may override via the `astra_scope` frontmatter key.
 */
function scopeForFile(vfile: any): Scope | null {
  const base = basename(vfile?.path ?? '', '.md');
  let analysisPath = base && base !== 'index' ? base.split('.').filter(Boolean) : [];
  const explicit = vfile?.data?.frontmatter?.astra_scope;
  if (Array.isArray(explicit)) {
    analysisPath = explicit.map((s) => String(s)).filter(Boolean);
  } else if (typeof explicit === 'string') {
    analysisPath = explicit.split('.').filter(Boolean);
  }
  try {
    return resolveScope(projectRoot(), analysisPath, vfile);
  } catch {
    return null;
  }
}

/** Ancestor input maps (innermost-last) for resolving aliased `from:` inputs. */
function parentInputMaps(scope: Scope): Map<string, Input>[] {
  return scope.ancestors.map(
    (a) => new Map((a.inputs ?? []).map((i) => [i.id, i] as const)),
  );
}

/**
 * The page scope's provenance frame, parent-linked up to the root analysis.
 */
function pageProvFrame(scope: Scope): ProvFrame {
  const rootUniverse = getSource(scope.root, scope.vfile).universe;
  const analyses = [...scope.ancestors, scope.analysis];
  return pageFrames(analyses, rootUniverse, scope.slugParts);
}

/** Inline `astra-ref` kind → resolved-store table (for cross-scope merging). */
const REF_KIND_TO_TABLE: Record<string, keyof ReturnType<typeof buildResolvedStore>> = {
  decision: 'decisions',
  output: 'outputs',
  value: 'outputs',
  finding: 'findings',
  prior_insight: 'prior_insights',
  analysis: 'subanalyses',
  input: 'inputs',
};

/** Collect every inline-ref join key (`data.astra`) in the page tree. */
function collectInlineRefs(node: any, out: { kind: string; id: string; path: string }[]): void {
  walkNodes(node, (n) => {
    const astra = n.data?.astra;
    // Skip fallback tokens the role already failed to resolve — attempting a
    // cross-scope merge for them would only produce a second, phantom warning.
    if (astra?.kind && astra?.id && typeof astra.path === 'string' && !astra.unresolved) out.push(astra);
  });
}

/**
 * Merge the entries that the page's CROSS-SCOPE inline refs point at into the
 * page store, keyed by their full dotted path. Each referenced sub-scope's store
 * is built once (cached) and the named entries are copied over with `id`
 * rewritten to the path key. Secondary joins (a decision's option_insights, a
 * finding's evidence artifacts) ride along path-qualified.
 */
function mergeCrossScopeRefs(
  tree: any,
  store: ReturnType<typeof buildResolvedStore>,
  vfile?: any,
): void {
  const refs: { kind: string; id: string; path: string }[] = [];
  collectInlineRefs(tree, refs);
  const subStores = new Map<string, ReturnType<typeof buildResolvedStore> | null>();

  const subStoreFor = (prefix: string) => {
    if (!subStores.has(prefix)) {
      try {
        const refScope = resolveScope(projectRoot(), prefix.split('.'), vfile);
        subStores.set(
          prefix,
          buildResolvedStore(
            refScope.analysis,
            refScope.universe,
            refScope.results,
            refScope.slug,
            resultUrl(refScope.root),
            parentInputMaps(refScope),
            refScope.priorInsights,
            pageProvFrame(refScope),
          ),
        );
      } catch (err) {
        reportWarn(vfile, `astra: cannot resolve cross-scope reference prefix "${prefix}": ${(err as Error).message}`);
        subStores.set(prefix, null);
      }
    }
    return subStores.get(prefix) ?? null;
  };

  const adopt = (table: keyof ReturnType<typeof buildResolvedStore>, prefix: string, id: string): string => {
    const qualified = `${prefix}.${id}`;
    const target = store[table] as Record<string, any>;
    if (table === 'prior_insights' && target[id]) return id;
    if (!target[qualified]) {
      const entry = (subStoreFor(prefix)?.[table] as Record<string, any> | undefined)?.[id];
      if (!entry) return qualified;
      target[qualified] = { ...entry, id: qualified };
      if (table === 'decisions' && entry.option_insights) {
        target[qualified].option_insights = Object.fromEntries(
          Object.entries(entry.option_insights as Record<string, string[]>).map(
            ([opt, ids]) => [opt, ids.map((ins) => adopt('prior_insights', prefix, ins))],
          ),
        );
      }
      if (table === 'findings' && Array.isArray(entry.evidence)) {
        target[qualified].evidence = entry.evidence.map((ev: any) =>
          ev?.artifact ? { ...ev, artifact: adopt('outputs', prefix, ev.artifact) } : ev,
        );
      }
    }
    return qualified;
  };

  for (const { kind, id, path } of refs) {
    if (path === id || !path.endsWith(`.${id}`)) continue; // in-scope ref
    const table = REF_KIND_TO_TABLE[kind];
    if (!table || (store[table] as Record<string, any>)[path]) continue;
    adopt(table, path.slice(0, -(id.length + 1)), id);
  }
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
      pageProvFrame(scope),
    );
    mergeCrossScopeRefs(tree, store, vfile);
    // The rich theme locates this carrier by its `astra-store` identifier (a
    // provider reads its `data.astra` and feeds every inline `.astra-ref` token
    // for the hover-card join), so the identifier is load-bearing — do NOT drop
    // it. It is the same on every page, which makes MyST log an advisory
    // "Duplicate identifier in project" warning; that is benign (each page keeps
    // its own carrier) and must not be traded away for the hover feature.
    const carrier: any = hiddenDiv('astra-store');
    carrier.identifier = 'astra-store';
    carrier.data = { astra: store };
    (tree.children ??= []).push(carrier);

    // Route output artifacts through MyST's asset pipeline (a JSON path is
    // opaque to it). One hidden image node per image-typed result, tagged with
    // its output id, lets MyST produce a servable hashed URL the theme rejoins.
    const assetImages = Object.values(store.outputs)
      .filter((o) => o.resolved_path && /\.(png|jpe?g|gif|webp|svg)$/i.test(o.resolved_path))
      .map((o) => ({ type: 'image', url: o.resolved_path, alt: o.label ?? o.id, data: { astraAsset: o.id } }));
    if (assetImages.length > 0) {
      (tree.children ??= []).push(hiddenDiv('astra-assets', assetImages));
    }

    // Register every DOI (prior insights + finding evidence) with MyST's
    // citation pipeline: a hidden `cite` node per DOI (label = DOI) lets MyST
    // resolve the formatted author–year citation and the bibliography entry, so
    // both the theme's hover cards and the `{astra:cite[:t]}` roles render real
    // citations. BOTH kinds are registered — narrative for card rows, parenthetical
    // for the auto-append after inline references.
    const insightDois = Object.values(store.prior_insights).map((i) => i.doi);
    const findingDois = Object.values(store.findings).flatMap((f) =>
      (f.evidence ?? []).map((e: any) => e.doi),
    );
    const dois = [...new Set([...insightDois, ...findingDois].filter((d): d is string => !!d))];
    if (dois.length > 0) {
      (tree.children ??= []).push(
        hiddenDiv('astra-cites', [
          paragraph(dois.flatMap((d) => [cite(d, [], 'narrative'), cite(d, [], 'parenthetical')])),
        ]),
      );
    }
  },
};

// ── Plugin export ─────────────────────────────────────────────────────────

const plugin = {
  name: 'astra',
  directives: [astraDirective],
  roles: [
    astraRole,
    astraRefRole,
    citeRole('astra:cite', 'parenthetical'),
    citeRole('astra:cite:t', 'narrative'),
    valueRole,
  ],
  transforms: [storeTransform],
};

export default plugin;

// ── Library exports (for programmatic use) ──────────────────────────────────
export { loadASTRASource } from './loader.js';
export type { ASTRASource } from './loader.js';
export { parseAstraPath } from './path.js';
export type { AstraPath, Collection } from './path.js';
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
