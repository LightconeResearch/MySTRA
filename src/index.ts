/**
 * MySTRA — the package entry point and the MyST plugin itself.
 *
 * The **default export is the plugin** (reference this package from `myst.yml`'s
 * `project.plugins`); named exports at the bottom expose the project loader and
 * path helpers for programmatic use.
 *
 * Authors reference any part of an ASTRA analysis through a single, unified
 * **path grammar** that mirrors `astra.yaml` (see `./path.ts`). One name —
 * `astra` — drives both surfaces, the MyST way (`{math}` is likewise a role and
 * a directive):
 *
 *   Inline reference (role):
 *     {astra}`outputs.hubble_diagram`              label + rich-theme dialog
 *     {astra}`our method <decisions.algorithm>`    custom display text
 *     {astra:value col=DV where="tracer=lrg3" pm=true}`outputs.bao_table`   live number
 *     {astra:cite}`prior_insights.recon`           parenthetical citation
 *     {astra:cite:t}`prior_insights.recon`         textual citation
 *
 *   Block embed (directive):
 *     :::{astra} decisions.algorithm    :::        the decision + its options
 *     :::{astra} outputs.hubble_diagram :::        the figure / table / metric
 *     :::{astra} findings.signal        :::        claim + scope + evidence
 *     :::{astra} reconstruction         :::        a sub-analysis summary card
 *     :::{astra} outputs                :::        the outputs registry
 *
 * Paths always resolve from the **root analysis** and use exact dot-separated
 * canonical segments.
 * See README.md for the authoring guide.
 *
 * Roles and directives first emit declarative placeholders. One asynchronous
 * document transform opens the project through the SDK, renders the neutral
 * MyST nodes, and publishes the same resolved bundle for rich themes.
 *
 * The project root is `process.cwd()` (run `myst start` from the project
 * dir). The SDK resolves all authored universes together; the page or request
 * selects one for presentation.
 */

import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
  getDeclaredAnalysis,
  getResult,
  getSelectedOption,
  selectResult,
} from '@astra-spec/sdk';
import {
  createHtmlId,
  isTargetIdentifierNode,
  transferTargetAttrs,
} from 'myst-common';
import { headingLabelTransform } from 'myst-transforms';
import type {
  Analysis,
  Decision,
  Insight,
  Output,
  Input,
  ResolvedAnalysis,
  StatusReport,
  Result,
} from '@astra-spec/sdk';
import {
  formatProjectError,
  loadResolvedProject,
  publishesBytes,
  type ResolvedProject,
} from './project.js';
import { analysisPageHrefs, rawAstraScope, scopeSegments } from './page-map.js';
import { pageMathMacros, rawPageFrontmatter } from './myst-config.js';
import { reportError, reportWarn } from './diagnostics.js';
import { createProseParser } from './transform/prose.js';
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
  makeTabItem,
  paragraph,
  refNode,
  text,
  walkNodes,
} from './transform/ast-helpers.js';
import {
  ASTRA_PUBLICATION_CLASS,
  ASTRA_PUBLICATION_SCHEMA_VERSION,
  ASTRA_RESOURCES_CLASS,
  type AstraArtifactData,
  type AstraNodeIdentity,
  type AstraPublicationData,
} from './publication.js';
import {
  renderDecision,
  supportingInsightsParagraph,
} from './transform/render-methods.js';
import { renderFinding } from './transform/render-findings.js';
import {
  renderOneOutput,
  renderEvidenceBlock,
  type EvidenceRenderOptions,
} from './transform/render-evidence.js';
import {
  renderInputsTable,
  renderOutputsTable,
} from './transform/render-data-sources.js';
import { parseTableData } from './transform/parse-table-data.js';
import { readMetric } from './transform/parse-metric.js';
import {
  parseAstraPath,
  pathIdentifier,
  splitDisplay,
  localId,
  type AstraPath,
  type Collection,
} from './path.js';

// ── Project and scope access ────────────────────────────────────────────

/** The ASTRA project root: the directory `myst` runs from. */
function projectRoot(): string {
  return process.cwd();
}

interface Scope {
  project: ResolvedProject;
  root: string;
  analysis: Analysis;
  universe?: string;
  prose: ProseParser;
  records: ReadonlyMap<string, Insight>;
  outputsById: ReadonlyMap<string, Output>;
  decisionsById: ReadonlyMap<string, Decision>;
  findingsById: ReadonlyMap<string, Insight>;
  insightsById: ReadonlyMap<string, Insight>;
  analysesById: ReadonlyMap<string, Analysis>;
  tabItem: ReturnType<typeof makeTabItem>;
  resultUrl: (absPath: string) => string;
  vfile?: any;
}

function evidenceOptions(scope: Scope): EvidenceRenderOptions {
  return {
    universe: scope.universe,
    resultPath: (resultId) => scope.project.resources.get(resultId)?.path,
    resultUrl: scope.resultUrl,
    vfile: scope.vfile,
  };
}

function citedDois(project: ResolvedProject): readonly string[] {
  return [
    ...new Set(
      project.analysis.analyses.flatMap((analysis) =>
        [...analysis.prior_insights, ...analysis.findings].flatMap((insight) =>
          insight.evidence.flatMap((evidence) =>
            evidence.doi ? [evidence.doi] : [],
          ),
        ),
      ),
    ),
  ];
}

function pageHrefs(project: ResolvedProject): ReadonlyMap<string, string> {
  return analysisPageHrefs(project.root, project.index);
}

function selectedResult(scope: Scope, output: Output): Result | undefined {
  return scope.universe
    ? selectResult(scope.project.index, output.ref, scope.universe)
    : getResult(scope.project.index, output.ref);
}

function selectedOption(scope: Scope, decision: Decision): string | undefined {
  return scope.universe
    ? getSelectedOption(scope.project.index, scope.universe, decision.ref)?.id
    : undefined;
}

function scopedAnalysis(project: ResolvedProject, path: readonly string[]): Analysis | undefined {
  let analysis = project.index.analysisByKey.get('');
  for (const declaration of path) {
    analysis = analysis ? getDeclaredAnalysis(project.index, analysis.key, declaration) : undefined;
  }
  return analysis;
}

function resolveScope(
  project: ResolvedProject,
  analysisPath: string[],
  prose: ProseParser,
  vfile?: any,
  requestedUniverse?: string,
): Scope {
  const analysis = scopedAnalysis(project, analysisPath);
  if (!analysis)
    throw new Error(
      `unknown sub-analysis "${analysisPath.join('.') || '<root>'}"`,
    );
  const configured =
    requestedUniverse ??
    vfile?.data?.frontmatter?.astra_universe ??
    rawPageFrontmatter(vfile?.path)?.astra_universe;
  const universe =
    configured === ''
      ? undefined
      : typeof configured === 'string'
        ? configured
        : (project.index.analysisByKey.get('')?.universes[0]?.ref ??
          analysis.universes[0]?.ref);
  if (
    universe !== undefined &&
    project.index.elementByRef.get(universe)?.collection !== 'universes'
  ) {
    throw new Error(`unknown universe "${universe}"`);
  }
  const records = new Map<string, Insight>();
  for (const entry of project.index.elementByRef.values()) {
    if (
      entry.collection === 'findings' ||
      entry.collection === 'prior_insights'
    )
      records.set(entry.element.ref, entry.element);
  }
  return {
    project,
    root: project.root,
    analysis,
    universe,
    prose,
    records,
    outputsById: new Map(
      analysis.outputs.map((output) => [localId(output), output]),
    ),
    decisionsById: new Map(
      analysis.decisions.map((decision) => [localId(decision), decision]),
    ),
    findingsById: new Map(
      analysis.findings.map((finding) => [localId(finding), finding]),
    ),
    insightsById: new Map(
      analysis.prior_insights.map((insight) => [localId(insight), insight]),
    ),
    analysesById: new Map(
      Object.entries(analysis.declares).flatMap(([id, key]) => {
        const child = project.index.analysisByKey.get(key);
        return child ? [[id, child] as const] : [];
      }),
    ),
    tabItem: makeTabItem(),
    resultUrl: resultUrl(project.root, vfile),
    vfile,
  };
}

/** Actual SDK record ref for an authored route, including declaration aliases. */
function recordRef(path: AstraPath, scope: Scope): string | null {
  const id = path.id;
  if (!id) return null;
  switch (path.collection) {
    case 'outputs':
      return scope.outputsById.get(id)?.ref ?? null;
    case 'decisions':
      return scope.decisionsById.get(id)?.ref ?? null;
    case 'findings':
      return scope.findingsById.get(id)?.ref ?? null;
    case 'prior_insights':
      return scope.insightsById.get(id)?.ref ?? null;
    case 'inputs':
      return (
        scope.analysis.inputs.find((input) => localId(input) === id)?.ref ??
        null
      );
    default:
      return null;
  }
}

/** Absolute result path → POSIX URL relative to the current MyST source page. */
function sourceRelative(
  root: string,
  sourcePath: string | undefined,
  absPath: string,
): string {
  const sourceDirectory = sourcePath
    ? dirname(isAbsolute(sourcePath) ? sourcePath : join(root, sourcePath))
    : root;
  return relative(sourceDirectory, absPath).split(sep).join('/');
}

function resultUrl(root: string, vfile?: any): (absPath: string) => string {
  const sourcePath = typeof vfile?.path === 'string' ? vfile.path : undefined;
  return (absPath) => sourceRelative(root, sourcePath, absPath);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * The one wording for a record excluded by the active universe. Keeps the
 * bundle accessor in a single place across the directive and value surfaces.
 */
function inactiveUnderUniverse(kind: string, id: string, scope: Scope): string {
  return (
    `${kind} "${id}" is inactive under universe ` +
    `"${scope.universe ?? '(none)'}"`
  );
}

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
// join it to the resolved SDK document by canonical path.

/** Add a semantic class to a node, idempotently (space-joined). */
function addClass(node: any, cls: string): void {
  if (!node || typeof node !== 'object') return;
  const have =
    typeof node.class === 'string'
      ? node.class.split(/\s+/).filter(Boolean)
      : [];
  if (!have.includes(cls)) have.push(cls);
  node.class = have.join(' ');
}

/**
 * Attach stable ASTRA identity without disturbing other node data (for
 * example decision/finding tags).
 */
function stampAstra(node: any, identity: AstraNodeIdentity): void {
  if (!node || typeof node !== 'object') return;
  const data = node.data && typeof node.data === 'object' ? node.data : {};
  const astra = data.astra && typeof data.astra === 'object' ? data.astra : {};
  node.data = { ...data, astra: { ...astra, ...identity } };
}

/**
 * Tag the carrier node of a resolved record (the node bearing `<kind>-<id>`,
 * else the first node) with recognition classes and exact SDK identity.
 */
function tagComponent(
  nodes: any[],
  identity: AstraNodeIdentity & { ref: string },
  subtype?: string,
): any[] {
  const { kind, id } = identity;
  const carrier = carrierOf(nodes, `${kind}-${id}`);
  if (carrier) {
    addClass(carrier, `astra-${kind}`);
    if (subtype) addClass(carrier, `astra-${kind}--${subtype}`);
    stampAstra(carrier, identity);
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
// whole collection (a registry), or a bare sub-analysis (a summary card).

interface DirectiveOptions {
  label?: string;
  caption?: string;
  compact?: boolean;
  show?: string;
  hide?: string;
  class?: string;
  universe?: string;
}

/** Resolve which finding parts to render from compact / show / hide options. */
function findingParts(options: DirectiveOptions): Set<string> {
  const all = ['claim', 'description', 'scope', 'evidence'];
  let parts = new Set(all);
  if (options.show)
    parts = new Set(options.show.split(/[,\s]+/).filter(Boolean));
  if (options.hide)
    for (const p of options.hide.split(/[,\s]+/).filter(Boolean))
      parts.delete(p);
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
  const findings = scope.analysis.findings;
  const finding = scope.findingsById.get(id);
  if (!finding) throw new Error(`no finding "${id}" in this scope`);
  return tagComponent(
    renderFinding(
      finding,
      index ?? findings.findIndex((item) => localId(item) === id) + 1,
      id,
      scope.project.index,
      scope.prose,
      {
        parts: findingParts(options),
        ...evidenceOptions(scope),
      },
    ),
    { kind: 'finding', id, ref: finding.ref },
  );
}

/**
 * Render a prior insight (the author-placed block): the claim + evidence wrapped
 * in a `seealso` admonition — a node every MyST theme renders cleanly — carrying
 * the `prior_insight-<id>` identifier.
 */
function renderPriorInsightBlock(
  id: string,
  insight: Insight,
  scope: Scope,
): any {
  const titleBits = ['Prior insight'];
  if (insight.label) titleBits.push(insight.label);
  else if (insight.scope) titleBits.push(insight.scope);
  const body = [
    paragraph(scope.prose.inline(insight.claim)),
    ...insight.evidence.flatMap((_, evidenceIndex) =>
      renderEvidenceBlock(scope.project.index, insight, evidenceIndex, scope.prose, evidenceOptions(scope)),
    ),
  ];
  const node: any = admonition(
    'seealso',
    [admonitionTitle([text(titleBits.join(' — '))]), ...body],
    {
      class: 'astra-prior-insight',
    },
  );
  node.identifier = `prior_insight-${id}`;
  node.label = node.identifier;
  stampAstra(node, {
    kind: 'prior_insight',
    id,
    ref: insight.ref,
  });
  return node;
}

/** Render a single input as a one-row registry table tagged `astra-input`. */
function renderOneInput(id: string, scope: Scope): any[] {
  const input = scope.analysis.inputs.find((item) => localId(item) === id);
  if (!input) throw new Error(`no input "${id}" in this scope`);
  const table = renderInputsTable([input], scope.prose);
  addClass(table, 'astra-input');
  stampAstra(table, { kind: 'input', id, ref: input.ref });
  return [table];
}

/** Render one Option of a Decision (label + description + supporting insights). */
function renderOneOption(
  decisionId: string,
  optionId: string,
  scope: Scope,
): any[] {
  const decision = scope.decisionsById.get(decisionId);
  const option = decision?.options.find((item) => item.id === optionId);
  if (!decision || !option) {
    throw new Error(
      `no option "${optionId}" on decision "${decisionId}" in this scope`,
    );
  }
  const selected = selectedOption(scope, decision) === optionId;
  const identifier = `option-${decisionId}-${optionId}`;
  const head: any = heading(
    4,
    [
      text(option.label ?? option.id),
      ...(selected ? [text(' '), emphasis([text('(selected)')])] : []),
    ],
    identifier,
  );
  const nodes: any[] = [head];
  if (option.description)
    nodes.push(...scope.prose.blocks(option.description, 5));
  const insightsPara = supportingInsightsParagraph(
    option.insights,
    scope.records,
  );
  if (insightsPara) nodes.push(insightsPara);
  addClass(head, 'astra-option');
  stampAstra(head, {
    kind: 'option',
    id: optionId,
    ref: decision.ref,
  });
  return nodes;
}

/** The finding / prior insight an insight-bearing path points at. */
function insightOwner(p: AstraPath, scope: Scope): Insight | undefined {
  return p.collection === 'findings'
    ? scope.findingsById.get(p.id!)
    : scope.insightsById.get(p.id!);
}

/** Render one Evidence record of a finding or prior insight. */
function renderOneEvidence(p: AstraPath, scope: Scope): any[] {
  const owner = insightOwner(p, scope);
  if (!owner) throw new Error(`no ${p.collection} "${p.id}" in this scope`);
  const evidenceIndex = Number(p.child!.id);
  const ev =
    Number.isSafeInteger(evidenceIndex) && evidenceIndex >= 0
      ? owner.evidence[evidenceIndex]
      : undefined;
  if (!ev)
    throw new Error(
      `no evidence "${p.child!.id}" on ${p.collection} "${p.id}"`,
    );
  const nodes = renderEvidenceBlock(scope.project.index, owner, evidenceIndex, scope.prose, evidenceOptions(scope));
  if (nodes[0]) {
    stampAstra(nodes[0], {
      kind: 'evidence',
      id: p.child!.id,
      ref: owner.ref,
      evidenceIndex,
    });
  }
  return nodes;
}

/** Render a sub-analysis as a neutral summary card. */
function renderSubAnalysisCard(subId: string, scope: Scope): any[] {
  const sub = scope.analysesById.get(subId);
  if (!sub) throw new Error(`no sub-analysis "${subId}" in this scope`);
  const title = sub.label ?? subId;
  const node: any = card(title, []);
  node.identifier = `analysis-${subId}`;
  node.label = node.identifier;
  addClass(node, 'astra-subanalysis');
  stampAstra(node, {
    kind: 'analysis',
    id: subId,
    analysisKey: sub.key,
  });
  return [node];
}

/** Render one decision block (heading + tabbed options), tagged for recognition. */
function renderDecisionBlock(
  id: string,
  decision: Decision,
  scope: Scope,
): any[] {
  return tagComponent(
    renderDecision(
      id,
      decision,
      scope.records,
      scope.prose,
      scope.tabItem,
      selectedOption(scope, decision),
    ),
    { kind: 'decision', id, ref: decision.ref },
  );
}

/** Stamp the record rows inside a neutral input/output registry table. */
function stampRegistryRows(
  table: any,
  records: readonly (Input | Output)[],
  kind: 'input' | 'output',
): void {
  const rows = Array.isArray(table?.children) ? table.children.slice(1) : [];
  records.forEach((record, index) => {
    stampAstra(rows[index], {
      kind,
      id: localId(record),
      ref: record.ref,
    });
  });
}

/** Render a whole collection (a registry) for the current scope. */
function renderRegistry(collection: Collection, scope: Scope): any[] {
  switch (collection) {
    case 'inputs': {
      const inputs = scope.analysis.inputs;
      if (inputs.length === 0) return [errorNode('no inputs in this scope')];
      const table = renderInputsTable(inputs, scope.prose);
      stampRegistryRows(table, inputs, 'input');
      addClass(table, 'astra-inputs');
      return [table];
    }
    case 'outputs': {
      const outputs = scope.analysis.outputs.filter((output) =>
        selectedResult(scope, output),
      );
      if (outputs.length === 0) return [errorNode('no outputs in this scope')];
      const table = renderOutputsTable(outputs, scope.prose);
      stampRegistryRows(table, outputs, 'output');
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
      const nodes: any[] = [];
      for (const decision of scope.analysis.decisions) {
        nodes.push(...renderDecisionBlock(localId(decision), decision, scope));
      }
      return nodes.length ? nodes : [errorNode('no decisions in this scope')];
    }
    case 'findings': {
      const nodes: any[] = [];
      scope.analysis.findings.forEach((finding, index) =>
        nodes.push(
          ...renderFindingParts(localId(finding), scope, {}, index + 1),
        ),
      );
      return nodes.length ? nodes : [errorNode('no findings in this scope')];
    }
    case 'prior_insights': {
      const nodes = scope.analysis.prior_insights.map((insight) =>
        renderPriorInsightBlock(localId(insight), insight, scope),
      );
      return nodes.length
        ? nodes
        : [errorNode('no prior insights in this scope')];
    }
    case 'analyses': {
      const nodes = [...scope.analysesById.keys()].flatMap((id) =>
        renderSubAnalysisCard(id, scope),
      );
      return nodes.length
        ? nodes
        : [errorNode('no sub-analyses in this scope')];
    }
  }
}

/** Render a single addressed element (path has a collection + id, no child). */
function renderElement(
  p: AstraPath,
  scope: Scope,
  options: DirectiveOptions,
): any[] {
  const id = p.id!;
  switch (p.collection) {
    case 'decisions': {
      const decision = scope.decisionsById.get(id);
      if (!decision) throw new Error(`no decision "${id}" in this scope`);
      return renderDecisionBlock(id, decision, scope);
    }
    case 'outputs': {
      const output = scope.outputsById.get(id);
      if (!output) throw new Error(`no output "${id}" in this scope`);
      const result = selectedResult(scope, output);
      if (!result) {
        throw new Error(inactiveUnderUniverse('output', id, scope));
      }
      const nodes = renderOneOutput(
        output,
        id,
        result,
        scope.prose,
        evidenceOptions(scope),
      );
      if (options.caption) applyCaption(nodes, scope, options.caption);
      return tagComponent(
        nodes,
        { kind: 'output', id, ref: output.ref },
        output.type,
      );
    }
    case 'findings':
      return renderFindingParts(id, scope, options);
    case 'prior_insights': {
      const insight = scope.insightsById.get(id);
      if (!insight) throw new Error(`no prior_insight "${id}" in this scope`);
      return [renderPriorInsightBlock(id, insight, scope)];
    }
    case 'inputs':
      return renderOneInput(id, scope);
    case 'analyses':
      return renderSubAnalysisCard(id, scope);
    default:
      return [errorNode(`astra: cannot render "${id}"`)];
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

type AstraRequest =
  | { surface: 'directive'; path: string; options: DirectiveOptions }
  | {
      surface: 'role';
      role: 'astra' | 'astra:cite' | 'astra:cite:t' | 'astra:value';
      body: string;
      options?: Record<string, any>;
    };

/** The authored heading level represented by a heading-producing directive. */
function requestHeadingDepth(request: AstraRequest): number | undefined {
  if (request.surface !== 'directive') return undefined;
  try {
    const path = parseAstraPath(request.path);
    if (path.child?.collection === 'options') return 4;
    if (!path.child && (path.collection === 'decisions' || path.collection === 'findings')) {
      return 3;
    }
  } catch {
    // Resolution reports malformed paths later; they need no heading marker.
  }
  return undefined;
}

function headingMarker(rawDepth: number): any {
  return {
    type: 'heading',
    depth: rawDepth,
    data: { astraHeadingMarker: rawDepth },
    children: [],
  };
}

/** Synchronous MyST roles/directives emit requests for the async transform. */
function requestNode(request: AstraRequest, inline: boolean, sourceNode?: any): any {
  const rawHeadingDepth = requestHeadingDepth(request);
  return {
    type: inline ? 'span' : 'div',
    class: 'astra-request',
    data: { astraRequest: request },
    ...(sourceNode?.position ? { position: sourceNode.position } : {}),
    children: rawHeadingDepth == null ? [] : [headingMarker(rawHeadingDepth)],
  };
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
    label: {
      type: String,
      doc: 'Cross-reference label for the rendered block.',
    },
    caption: { type: String, doc: 'Caption text (figure / table outputs).' },
    compact: {
      type: Boolean,
      doc: 'Findings: claim + description + scope only (no evidence).',
    },
    show: {
      type: String,
      doc: 'Findings: parts to include (claim, description, scope, evidence).',
    },
    hide: { type: String, doc: 'Findings: parts to exclude.' },
    class: { type: String, doc: 'Extra CSS class(es) on the rendered block.' },
    universe: {
      type: String,
      doc: 'Resolved universe ref, e.g. universes.baseline.',
    },
  },
  run(data: any): any[] {
    return [
      requestNode(
        {
          surface: 'directive',
          path: String(data?.arg ?? ''),
          options: data?.options ?? {},
        },
        false,
        data?.node,
      ),
    ];
  },
};

/** Apply `:label:` / `:class:` to the rendered block's carrier node. */
function applyBlockOptions(
  nodes: any[],
  p: AstraPath,
  options: DirectiveOptions,
): void {
  if (!nodes.length) return;
  const ident = pathIdentifier(p);
  const carrier = ident ? carrierOf(nodes, ident) : nodes[0];
  if (!carrier) return;
  if (options.class)
    for (const c of options.class.split(/\s+/).filter(Boolean))
      addClass(carrier, c);
  if (options.label) {
    carrier.identifier = options.label;
    carrier.label = options.label;
  }
}

// ── Inline reference roles ───────────────────────────────────────────────────
//
// `{astra}` renders a neutral `astra-ref` span (best label as text plus an
// explicit record or analysis address). A rich theme can open shared UI from
// that identity; a bare theme shows the plain label. `{astra:cite[:t]}` emit
// MyST citations.

type RefKind =
  | 'decision'
  | 'output'
  | 'finding'
  | 'prior_insight'
  | 'analysis'
  | 'input'
  | 'option'
  | 'evidence';

/** Resolve a parsed path to its inline reference kind and label. */
function resolveInlineRef(
  p: AstraPath,
  scope: Scope,
  display: string | null,
): {
  kind: RefKind;
  id: string;
  label: string;
  subtype?: string;
  analysisKey?: string;
} {
  // Children first — an option / evidence inline reference.
  if (p.child) {
    const ownerId = p.id!;
    if (p.child.collection === 'options') {
      const decision = scope.decisionsById.get(ownerId);
      const opt = decision?.options.find((item) => item.id === p.child!.id);
      if (!decision || !opt) {
        throw new Error(`no option "${p.child.id}" on decision "${ownerId}"`);
      }
      return {
        kind: 'option',
        id: p.child.id,
        label: display ?? opt?.label ?? humanize(p.child.id),
      };
    }
    const owner = insightOwner(p, scope);
    if (
      !owner ||
      !/^\d+$/.test(p.child!.id) ||
      !owner.evidence[Number(p.child!.id)]
    ) {
      throw new Error(
        `no evidence "${p.child.id}" on ${p.collection} "${ownerId}"`,
      );
    }
    return {
      kind: 'evidence',
      id: p.child.id,
      label: display ?? humanize(p.child.id),
    };
  }

  const id = p.id!;
  switch (p.collection) {
    case 'decisions': {
      const decision = scope.decisionsById.get(id);
      if (!decision) throw new Error(`no decision "${id}" in this scope`);
      return {
        kind: 'decision',
        id,
        label: display ?? decision.label ?? humanize(id),
      };
    }
    case 'findings': {
      const finding = scope.findingsById.get(id);
      if (!finding) throw new Error(`no finding "${id}" in this scope`);
      return {
        kind: 'finding',
        id,
        label: display ?? finding.label ?? humanize(id),
      };
    }
    case 'prior_insights': {
      const insight = scope.insightsById.get(id);
      if (!insight) throw new Error(`no prior_insight "${id}" in this scope`);
      return {
        kind: 'prior_insight',
        id,
        label: display ?? insight.label ?? humanize(id),
      };
    }
    case 'analyses': {
      const sub = scope.analysesById.get(id);
      if (!sub) throw new Error(`no sub-analysis "${id}" in this scope`);
      return {
        kind: 'analysis',
        id,
        label: display ?? sub.label ?? humanize(id),
        analysisKey: sub.key,
      };
    }
    case 'inputs': {
      const input = scope.analysis.inputs.find((item) => localId(item) === id);
      if (!input) throw new Error(`no input "${id}" in this scope`);
      return {
        kind: 'input',
        id,
        label: display ?? input.label ?? humanize(id),
      };
    }
    case 'outputs':
    default: {
      const o = scope.outputsById.get(id);
      if (!o) throw new Error(`no output "${id}" in this scope`);
      return {
        kind: 'output',
        id,
        label: display ?? o.label ?? humanize(id),
        subtype: o.type,
      };
    }
  }
}

/** `{astra}` — inline SDK-backed reference to any element. */
const astraRole = {
  name: 'astra',
  doc: 'Inline reference to an ASTRA element by path (a rich theme opens its record dialog).',
  body: {
    type: String,
    required: true,
    doc: 'A path, optionally `display text <path>`.',
  },
  options: { universe: { type: String, doc: 'Resolved universe ref.' } },
  run(data: any): any[] {
    return [
      requestNode(
        {
          surface: 'role',
          role: 'astra',
          body: String(data?.body ?? ''),
          options: data?.options ?? {},
        },
        true,
        data?.node,
      ),
    ];
  },
};

/** Gather the DOIs backing a finding or prior insight. */
function refDois(p: AstraPath, scope: Scope): string[] {
  const owner = insightOwner(p, scope);
  const dois = (owner?.evidence ?? [])
    .map((e: any) => e.doi)
    .filter(Boolean) as string[];
  return [...new Set(dois)];
}

/** `{astra:cite}` / `{astra:cite:t}` — bibliographic citation from DOI evidence. */
function citeRole(name: string, kind: 'parenthetical' | 'narrative') {
  return {
    name,
    doc: `Cite a finding/prior-insight as a ${kind} author–year citation from its DOI evidence.`,
    body: {
      type: String,
      required: true,
      doc: 'A path to a finding or prior insight.',
    },
    options: { universe: { type: String, doc: 'Resolved universe ref.' } },
    run(data: any): any[] {
      return [
        requestNode(
          {
            surface: 'role',
            role: name as 'astra:cite' | 'astra:cite:t',
            body: String(data?.body ?? ''),
            options: data?.options ?? {},
          },
          true,
          data?.node,
        ),
      ];
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
      if (i <= 0)
        throw new Error(`bad where= filter "${token}" (expected key=value)`);
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
  body: {
    type: String,
    required: true,
    doc: 'A path to a table/metric output or a decision.',
  },
  options: {
    col: { type: String, doc: 'Table outputs: the column to read.' },
    where: {
      type: String,
      doc: 'Row filters: space/comma-separated key=value pairs (case-insensitive).',
    },
    pm: {
      type: Boolean,
      doc: 'Append the ± uncertainty (<col>_std, or the metric’s own).',
    },
    err: { type: String, doc: 'Explicit uncertainty column (implies pm).' },
    sig: { type: Number, doc: 'Significant figures (default 4).' },
    universe: {
      type: String,
      doc: 'Resolved universe ref, e.g. universes.baseline.',
    },
  },
  run(data: any): any[] {
    return [
      requestNode(
        {
          surface: 'role',
          role: 'astra:value',
          body: String(data?.body ?? ''),
          options: data?.options ?? {},
        },
        true,
        data?.node,
      ),
    ];
  },
};

// ── Async resolution + publication transform ────────────────────────────

/**
 * Resolve the page's active analysis. Unknown conventional basenames fall back
 * to the root because the publication bundle is project-wide; an invalid
 * explicit override is still reported as an authoring error.
 */
function scopeForFile(
  project: ResolvedProject,
  prose: ProseParser,
  vfile: any,
): Scope {
  const explicit = vfile?.data?.frontmatter?.astra_scope ?? rawAstraScope(vfile?.path);
  let path = scopeSegments(explicit, vfile?.path ?? '');
  if (!scopedAnalysis(project, path)) {
    if (explicit != null) {
      reportError(vfile, `unknown astra_scope "${Array.isArray(explicit) ? explicit.join('.') : explicit}" — using the root analysis`);
    }
    path = [];
  }
  try {
    return resolveScope(project, path, prose, vfile);
  } catch (error) {
    reportError(vfile, `ASTRA page context: ${(error as Error).message} — using the root analysis`);
    return resolveScope(project, [], prose, vfile, project.index.analysisByKey.get('')?.universes[0]?.ref ?? '');
  }
}

function renderDirectiveRequest(
  request: Extract<AstraRequest, { surface: 'directive' }>,
  project: ResolvedProject,
  prose: ProseParser,
  vfile: any,
): any[] {
  const p = parseAstraPath(request.path);
  if (!p.collection) throw new Error('empty path');
  const scope = resolveScope(
    project,
    p.scope,
    prose,
    vfile,
    request.options.universe,
  );
  let nodes: any[];
  if (p.child) {
    nodes =
      p.child.collection === 'options'
        ? renderOneOption(p.id!, p.child.id, scope)
        : renderOneEvidence(p, scope);
  } else if (p.id) {
    nodes = renderElement(p, scope, request.options);
  } else {
    nodes = renderRegistry(p.collection, scope);
  }
  applyBlockOptions(nodes, p, request.options);
  if (scope.universe) placeInUniverse(nodes, p, scope.universe);
  return nodes;
}

/**
 * Give every placed element of a block the universe it was rendered in. A
 * registry places one carrier per record, and each must carry the universe
 * itself: a theme reads a carrier without its siblings. Identity already
 * stamped on a node is kept.
 */
function placeInUniverse(nodes: any[], p: AstraPath, universe: string): void {
  walkNodes(nodes, (node) => {
    const astra = node.data?.astra;
    if (astra && typeof astra === 'object' && astra.universe === undefined) {
      node.data = { ...node.data, astra: { ...astra, universe } };
    }
  });
  // A registry table has no record identity of its own; its universe still
  // selects the results of the rows it lists.
  const first = nodes[0];
  if (!p.id && first && !first.data?.astra) {
    stampAstra(first, { kind: p.collection!, id: p.collection!, universe });
  }
}

function renderAstraRefRequest(
  body: string,
  project: ResolvedProject,
  prose: ProseParser,
  vfile: any,
  analysisHrefs: ReadonlyMap<string, string>,
  sourceNode?: any,
  universe?: string,
): any[] {
  const { display, path } = splitDisplay(body);
  try {
    const p = parseAstraPath(path);
    if (!p.collection) {
      reportWarn(
        vfile,
        `astra: empty path in "${body}" — rendering plain text`,
        sourceNode,
      );
      return [text(body)];
    }
    const scope = resolveScope(project, p.scope, prose, vfile, universe);
    const ref = resolveInlineRef(p, scope, display);
    const elementRef = recordRef(p, scope);
    const href =
      ref.analysisKey !== undefined
        ? analysisHrefs.get(ref.analysisKey)
        : undefined;
    const identity =
      ref.kind === 'analysis' && ref.analysisKey !== undefined
        ? {
            analysisKey: ref.analysisKey,
            ...(href ? { href } : {}),
          }
        : elementRef
          ? { ref: elementRef }
          : {};
    return [
      refNode(ref.kind, ref.id, ref.label, ref.subtype, {
        ...identity,
        ...(scope.universe ? { universe: scope.universe } : {}),
        ...(p.child?.collection === 'evidence'
          ? { evidenceIndex: Number(p.child.id) }
          : {}),
      }),
    ];
  } catch (err) {
    reportWarn(
      vfile,
      `astra "${path}": ${(err as Error).message} — rendering a plain label`,
      sourceNode,
    );
    return [text(display ?? humanize(path.split('.').at(-1) || path))];
  }
}

function renderCiteRequest(
  request: Extract<AstraRequest, { surface: 'role' }>,
  project: ResolvedProject,
  prose: ProseParser,
  vfile: any,
  sourceNode?: any,
): any[] {
  const { display, path } = splitDisplay(request.body);
  try {
    const p = parseAstraPath(path);
    const scope = resolveScope(project, p.scope, prose, vfile, request.options?.universe);
    if (p.collection !== 'findings' && p.collection !== 'prior_insights') {
      throw new Error('astra:cite expects a finding or prior_insight path');
    }
    const dois = refDois(p, scope);
    if (dois.length === 0) {
      const ref = resolveInlineRef(p, scope, display);
      const elementRef = recordRef(p, scope);
      return [
        refNode(
          ref.kind,
          ref.id,
          ref.label,
          ref.subtype,
          elementRef ? {
            ref: elementRef,
            ...(scope.universe ? { universe: scope.universe } : {}),
            ...(p.child?.collection === 'evidence' ? { evidenceIndex: Number(p.child.id) } : {}),
          } : undefined,
        ),
      ];
    }
    const kind =
      request.role === 'astra:cite:t' ? 'narrative' : 'parenthetical';
    const cites = dois.map((doi) => cite(doi, [], kind));
    return cites.length === 1 ? cites : [citeGroup(cites, kind)];
  } catch (err) {
    const message = `${request.role} "${path}": ${(err as Error).message}`;
    reportError(vfile, message, sourceNode);
    return [inlineCode(`⟨cite: ${(err as Error).message}⟩`)];
  }
}

function renderValue(
  request: Extract<AstraRequest, { surface: 'role' }>,
  project: ResolvedProject,
  prose: ProseParser,
  vfile: any,
  sourceNode?: any,
): any[] {
  const fail = (message: string): any[] => {
    reportError(vfile, `astra:value: ${message}`, sourceNode);
    return [valueError(message)];
  };
  const path = request.body.trim();
  const options = (request.options ?? {}) as {
    col?: string;
    where?: string;
    pm?: boolean;
    err?: string;
    sig?: number;
    universe?: string;
  };
  if (!path) return fail('missing path');
  if (/\s/.test(path)) {
    return fail(
      `unexpected content after the path in "${path}" — pass the selection as role options, ` +
        `e.g. {astra:value col=… where="tracer=…"}\`${path.split(/\s+/)[0]}\``,
    );
  }
  try {
    const parsed = parseAstraPath(path);
    const id = parsed.id;
    if (!id) return fail(`missing element id in "${path}"`);
    const scope = resolveScope(
      project,
      parsed.scope,
      prose,
      vfile,
      options.universe,
    );
    const elementRef = recordRef(parsed, scope);

    if (parsed.collection === 'decisions') {
      const decision = scope.decisionsById.get(id);
      if (!decision) return fail(`no decision "${id}"`);
      if (!selectedOption(scope, decision)) {
        return fail(
          `decision "${id}" has no selection in universe "${scope.universe ?? '(none)'}"`,
        );
      }
      const optionId = selectedOption(scope, decision);
      const option = decision.options.find((item) => item.id === optionId);
      const label = option?.label ?? optionId ?? '(none)';
      const node = refNode(
        'value',
        id,
        label,
        'decision',
        elementRef ? { ref: elementRef } : undefined,
      );
      Object.assign(node.data.astra, {
        ...(scope.universe ? { universe: scope.universe } : {}),
        type: 'decision',
        ...(optionId ? { selection: optionId } : {}),
      });
      return [node];
    }
    if (parsed.collection !== 'outputs') {
      return fail(`"${path}" is not an output or decision`);
    }
    const output = scope.outputsById.get(id);
    if (!output || !elementRef) return fail(`no output "${id}"`);
    const result = selectedResult(scope, output);
    if (!result) {
      return fail(inactiveUnderUniverse('output', id, scope));
    }
    if (!publishesBytes(output)) {
      return fail(`"${id}" is a data output; values read metric or table outputs`);
    }
    const absolutePath = scope.project.resources.get(result.id)?.path;
    if (!absolutePath) {
      reportWarn(
        vfile,
        `astra:value: no result file for "${path}" (output not produced yet)`,
        sourceNode,
      );
      return [valueError(`no result file for "${path}"`)];
    }
    const sig = options.sig ?? 4;
    if (output.type === 'metric') {
      const metric = readMetric(absolutePath);
      if (metric?.value !== undefined) {
        let value = fmtNum(String(metric.value), sig);
        const uncertainty = metric.uncertainty;
        if (options.pm && uncertainty !== undefined && uncertainty !== '') {
          value += ` ± ${fmtNum(String(uncertainty), 2)}`;
        }
        const node = refNode('value', id, value, 'metric', { ref: elementRef });
        const unit = metric.unit;
        Object.assign(node.data.astra, {
          ...(scope.universe ? { universe: scope.universe } : {}),
          type: 'metric',
          ...(output.label ? { product: output.label } : {}),
          ...(unit ? { unit } : {}),
        });
        return [node];
      }
    }
    const data = parseTableData(absolutePath);
    if (!data) return fail(`"${id}" is not tabular`);
    const column = options.col;
    if (!column) return fail(`missing col= for "${id}"`);
    const columnIndex = data.headers.indexOf(column);
    if (columnIndex < 0) return fail(`no column "${column}" in "${id}"`);
    const filters = parseWhere(options.where);
    const filterColumns = filters.map(
      ([key, value]) =>
        [data.headers.indexOf(key), value.toLowerCase()] as const,
    );
    const row = data.rows.find((candidate) =>
      filterColumns.every(
        ([index, value]) =>
          index >= 0 && String(candidate[index]).toLowerCase() === value,
      ),
    );
    if (!row) {
      const description =
        filters.map(([key, value]) => `${key}=${value}`).join(', ') ||
        '(no filter)';
      return fail(`no row [${description}] in "${id}"`);
    }
    let value = fmtNum(row[columnIndex], sig);
    const errorColumn =
      options.err ?? (options.pm ? `${column}_std` : undefined);
    if (errorColumn) {
      const errorIndex = data.headers.indexOf(errorColumn);
      const uncertainty = row[errorIndex];
      if (
        errorIndex >= 0 &&
        uncertainty != null &&
        uncertainty !== '' &&
        uncertainty !== '-'
      ) {
        value += ` ± ${fmtNum(uncertainty, 2)}`;
      }
    }
    const filter = filters.map(([key, item]) => `${key}=${item}`).join(', ');
    const node = refNode('value', id, value, output.type, { ref: elementRef });
    Object.assign(node.data.astra, {
      ...(scope.universe ? { universe: scope.universe } : {}),
      col: column,
      ...(filter ? { filter } : {}),
      type: output.type,
      ...(output.label ? { product: output.label } : {}),
    });
    return [node];
  } catch (err) {
    return fail((err as Error).message);
  }
}

function renderRequest(
  request: AstraRequest,
  project: ResolvedProject,
  prose: ProseParser,
  vfile: any,
  analysisHrefs: ReadonlyMap<string, string>,
  sourceNode?: any,
): any[] {
  if (request.surface === 'directive') {
    try {
      return renderDirectiveRequest(request, project, prose, vfile);
    } catch (err) {
      const message = `astra "${request.path}": ${(err as Error).message}`;
      reportError(vfile, message, sourceNode);
      return [errorNode(message)];
    }
  }
  switch (request.role) {
    case 'astra':
      return renderAstraRefRequest(
        request.body,
        project,
        prose,
        vfile,
        analysisHrefs,
        sourceNode,
        request.options?.universe,
      );
    case 'astra:cite':
    case 'astra:cite:t':
      return renderCiteRequest(request, project, prose, vfile, sourceNode);
    case 'astra:value':
      return renderValue(request, project, prose, vfile, sourceNode);
  }
}

function replaceRequests(
  node: any,
  render: (request: AstraRequest, sourceNode: any) => any[],
  finalize?: (replacement: any[], sourceNode: any, ownedHtmlId?: string) => void,
  vfile?: any,
): void {
  const children = node?.children;
  if (!Array.isArray(children)) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const request = child?.data?.astraRequest as AstraRequest | undefined;
    if (request) {
      const replacement = render(request, child);
      const ownedHtmlId = nodeHtmlId(child);
      if (replacement[0]) transferTargetAttrs(child, replacement[0], vfile);
      finalize?.(replacement, child, ownedHtmlId);
      children.splice(index, 1, ...replacement);
      index += replacement.length - 1;
    } else {
      replaceRequests(child, render, finalize, vfile);
    }
  }
}

function nodeHtmlId(node: any): string | undefined {
  if (typeof node?.html_id === 'string' && node.html_id) return node.html_id;
  return typeof node?.identifier === 'string' && isTargetIdentifierNode(node)
    ? createHtmlId(node.identifier)
    : undefined;
}

type HtmlIdReservations = Map<string, number>;

function addHtmlId(reserved: HtmlIdReservations, htmlId: string): void {
  reserved.set(htmlId, (reserved.get(htmlId) ?? 0) + 1);
}

function releaseHtmlId(reserved: HtmlIdReservations, htmlId?: string): void {
  if (!htmlId) return;
  const count = reserved.get(htmlId) ?? 0;
  if (count <= 1) reserved.delete(htmlId);
  else reserved.set(htmlId, count - 1);
}

/** Shift late headings by the exact amount MyST applied to their request marker. */
function normalizeReplacementHeadings(nodes: any[], sourceNode: any, vfile?: any): void {
  const marker = (sourceNode?.children ?? []).find(
    (child: any) => typeof child?.data?.astraHeadingMarker === 'number',
  );
  const rawDepth = marker?.data?.astraHeadingMarker;
  if (typeof rawDepth !== 'number' || typeof marker?.depth !== 'number') return;
  const delta = marker.depth - rawDepth;
  let clamped = false;
  walkNodes(nodes, (node) => {
    if (node.type !== 'heading' || typeof node.depth !== 'number') return;
    const shifted = node.depth + delta;
    const depth = Math.max(1, Math.min(6, shifted));
    clamped ||= depth !== shifted;
    node.depth = depth;
  });
  if (clamped) {
    reportWarn(
      vfile,
      'ASTRA replacement heading depth exceeds h6 — clamping to h6',
      sourceNode,
    );
  }
}

/** Host IDs win even when their nodes only have an identifier so far. */
function existingHtmlIds(tree: any): HtmlIdReservations {
  const ids: HtmlIdReservations = new Map();
  const collect = (node: any): void => {
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const htmlId = nodeHtmlId(node);
    if (htmlId) addHtmlId(ids, htmlId);
    // A request's target belongs to the authored page, but its empty heading
    // proxy disappears with the request and must not reserve anything.
    if (node.data?.astraRequest) return;
    if (Array.isArray(node.children)) node.children.forEach(collect);
  };
  collect(tree);
  return ids;
}

/**
 * Make ids introduced by one replacement unique without renaming any anchor
 * that MyST already published for the host page.
 */
function reserveReplacementHtmlIds(
  nodes: any[],
  reserved: HtmlIdReservations,
): any[] {
  walkNodes(nodes, (node) => {
    const original = nodeHtmlId(node);
    if (!original) return;
    let candidate = original;
    let suffix = 1;
    while ((reserved.get(candidate) ?? 0) > 0) {
      candidate = `${original}-${suffix}`;
      suffix += 1;
    }
    node.html_id = candidate;
    addHtmlId(reserved, candidate);
  });
  return nodes;
}

function failedRequest(request: AstraRequest, message: string): any[] {
  if (request.surface === 'directive') return [errorNode(`astra: ${message}`)];
  if (request.role === 'astra') return [text(request.body)];
  if (request.role === 'astra:value') return [valueError(message)];
  return [inlineCode(`⟨cite: ${message}⟩`)];
}

function publicationCarriers(
  project: ResolvedProject,
  activeScope: Scope,
): any[] {
  const artifactUrl = activeScope.resultUrl;
  const carrier: any = hiddenDiv(ASTRA_PUBLICATION_CLASS);
  const publication: AstraPublicationData = {
    schemaVersion: ASTRA_PUBLICATION_SCHEMA_VERSION,
    activeAnalysisKey: activeScope.analysis.key,
    ...(activeScope.universe ? { universe: activeScope.universe } : {}),
    analysis: project.analysis,
    status: project.status,
    resources: Object.fromEntries(
      [...project.resources].map(([id, resource]) => [
        id,
        { cacheToken: resource.cacheToken },
      ]),
    ),
  };
  carrier.data = {
    astraPublication: publication,
  };

  const resources = [...project.resources].map(([resultId, resource]) => ({
    type: 'link' as const,
    url: artifactUrl(resource.path),
    static: true,
    children: [text(resultId)],
    data: {
      astraArtifact: {
        resultId,
        cacheToken: resource.cacheToken,
      } satisfies AstraArtifactData,
    },
  }));
  const nodes: any[] = [carrier];
  if (resources.length) {
    nodes.push(hiddenDiv(ASTRA_RESOURCES_CLASS, resources));
  }
  const dois = citedDois(project);
  if (dois.length) {
    nodes.push(
      hiddenDiv('astra-cites', [
        paragraph(
          dois.flatMap((doi) => [
            cite(doi, [], 'narrative'),
            cite(doi, [], 'parenthetical'),
          ]),
        ),
      ]),
    );
  }
  return nodes;
}

const resolvedAnalysisTransform = {
  name: 'astra-resolved-analysis',
  doc: 'Resolve ASTRA requests and emit the canonical SDK publication bundle.',
  stage: 'document',
  plugin: () => async (tree: any, vfile: any) => {
    let project: ResolvedProject;
    try {
      project = await loadResolvedProject(projectRoot());
    } catch (error) {
      const messages = formatProjectError(error);
      messages.forEach((message) =>
        reportError(vfile, `astra project: ${message}`),
      );
      replaceRequests(
        tree,
        (request) =>
          failedRequest(request, messages[0] ?? 'cannot load project'),
        undefined,
        vfile,
      );
      return;
    }
    const prose = createProseParser(vfile, {
      macros: pageMathMacros(project.root, vfile),
    });
    const analysisHrefs = pageHrefs(project);
    const reservedHtmlIds = existingHtmlIds(tree);
    replaceRequests(
      tree,
      (request, sourceNode) =>
        renderRequest(
          request,
          project,
          prose,
          vfile,
          analysisHrefs,
          sourceNode,
        ),
      (replacement, sourceNode, ownedHtmlId) => {
        releaseHtmlId(reservedHtmlIds, ownedHtmlId);
        normalizeReplacementHeadings(replacement, sourceNode, vfile);
        headingLabelTransform({ type: 'root', children: replacement });
        reserveReplacementHtmlIds(replacement, reservedHtmlIds);
      },
      vfile,
    );
    const activeScope = scopeForFile(project, prose, vfile);
    (tree.children ??= []).push(...publicationCarriers(project, activeScope));
  },
};

// ── Plugin export ─────────────────────────────────────────────────────────

const plugin = {
  name: 'astra',
  directives: [astraDirective],
  roles: [
    astraRole,
    citeRole('astra:cite', 'parenthetical'),
    citeRole('astra:cite:t', 'narrative'),
    valueRole,
  ],
  transforms: [resolvedAnalysisTransform],
};

export default plugin;

// ── Library exports (for programmatic use) ───────────────────────────────
export {
  clearResolvedProjectCache,
  formatProjectError,
  loadResolvedProject,
} from './project.js';
export type { ResolvedProject } from './project.js';
export { parseAstraPath } from './path.js';
export type { AstraPath, Collection } from './path.js';
