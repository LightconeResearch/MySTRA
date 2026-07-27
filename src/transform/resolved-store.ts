/**
 * The resolved ASTRA data store (for rich themes).
 *
 * Strategy A keeps `astra.yaml` as the single data source, but the theme cannot
 * read it (it only sees the build output). So the plugin bakes a *resolved*
 * projection of the analysis into the build — keyed by id — and a rich theme
 * (e.g. `lightcone-astra`) joins `node identifier → store entry` to render
 * cards, dependency graphs, or alternative layouts without re-implementing any
 * ASTRA semantics. Placed blocks join by `identifier` (`output-<id>`, …); inline
 * references join by `data.astra` (`{kind,id}` → the matching table below) — the
 * same key→table join MyST uses for citations. See STRATEGY-A-REFACTOR.md §5.
 *
 * This is the salvaged core of the old `/astra/<slug>.json` server route
 * (`resolveOutputs`, table previews, `readMetric`, input aliasing) — but emitted
 * as a build artifact, not served live, and with project-relative result URLs
 * (MyST's asset pipeline copies them) rather than the old `/static` mount.
 *
 * The store is built once per page scope and carried on a hidden node's `data`
 * (see the `astra-resolved-store` transform in `index.ts`); it is resolved, not
 * raw YAML, so the theme never touches `astra.yaml`.
 */

import { existsSync, readFileSync } from 'node:fs';
import type {
  Analysis,
  Decision,
  Evidence,
  Input,
  Insight,
  Universe,
} from '@astra-spec/sdk';
import type { ArtifactResolver } from '../loader.js';
import { resolveOutputs } from './resolve-output.js';
import { traceProvenance, type ProvFrame } from './provenance.js';
import type {
  SerializedProvenanceDecision,
  SerializedRootInput,
} from './provenance.js';

export type { SerializedProvenanceDecision, SerializedRootInput };
import { isDecisionRendered, selectedOptionId } from './render-methods.js';
import { parseTableData, type TableData } from './parse-table-data.js';
import {
  buildTablePreview,
  type SerializedTablePreview,
} from './table-preview.js';

// ── Serialized shapes ───────────────────────────────────────────────────────

export interface SerializedRecipe {
  command?: string;
  container?: string;
}

/** Inlined metric value (scalar / 2-tuple / object), parsed at build time. */
export interface SerializedMetric {
  value?: number | string;
  uncertainty?: number | string;
  error?: number | string;
  unit?: string;
  units?: string;
  label?: string;
}

export interface SerializedOutput {
  id: string;
  path: string;
  kind: 'output';
  label?: string;
  type?: string;
  description?: string;
  /** Project-relative URL of the result artifact (MyST copies it), if found. */
  resolved_path?: string;
  recipe?: SerializedRecipe;
  /** Upstream input ids this output depends on (resolved through `from:`). */
  inputs?: string[];
  /** Decision ids that parameterise this artefact. */
  decisions?: string[];
  /** Alias pointer for re-exported outputs (`from: child.out_id`). */
  from?: string;
  /** Size-bounded browser preview; the result artifact remains authoritative. */
  table_preview?: SerializedTablePreview;
  /** Inlined value for metric outputs whose result file parses as JSON. */
  metric?: SerializedMetric;
  /** Analysis-level source inputs at the roots of the provenance chain. */
  inputs_root?: SerializedRootInput[];
  /** Every decision affecting this output, direct or via another scope. */
  decisions_transitive?: SerializedProvenanceDecision[];
}

export interface SerializedInput {
  id: string;
  path: string;
  kind: 'input';
  label?: string;
  type?: string;
  description?: string;
  source?: string;
  from?: string;
  ref?: string;
}

export interface SerializedDecision {
  id: string;
  path: string;
  kind: 'decision';
  label?: string;
  rationale?: string;
  tags?: string[];
  from?: string;
  when?: string[];
  /** Whether this decision has an active page carrier in this universe. */
  active: boolean;
  /** The option id selected under the active universe (or the default). */
  selected?: string;
  /** All option ids → their labels. */
  options: Record<string, string | undefined>;
  /**
   * Prior-insight ids cited by each option (`options.<id>.insights` in
   * astra.yaml) — the evidence backing the choice. Only present when at least
   * one option cites an insight; the theme joins the `prior_insights` table.
   */
  option_insights?: Record<string, string[]>;
}

/** One serialized evidence entry (artifact-, DOI-, or quote-based). */
export interface SerializedEvidence {
  /** Output id of the artifact backing this evidence (joins `outputs`). */
  artifact?: string;
  doi?: string;
  /** The exact-quote selector text, when present. */
  quote?: string;
  page?: number;
}

export interface SerializedFinding {
  id: string;
  path: string;
  kind: 'finding';
  label?: string;
  claim?: string;
  notes?: string;
  scope?: string;
  /** The finding's evidence list (artifact ids join the `outputs` table). */
  evidence?: SerializedEvidence[];
}

export interface SerializedInsight {
  id: string;
  path: string;
  kind: 'prior_insight';
  label?: string;
  scope?: string;
  claim?: string;
  notes?: string;
  evidence?: SerializedEvidence[];
  /** First evidence DOI, when present (the theme can resolve the citation). */
  doi?: string;
  /** First exact-quote evidence, when present. */
  quote?: string;
  /** Page of the first evidence item carrying a source location. */
  page?: number;
}

export interface SerializedSubAnalysis {
  id: string;
  path: string;
  kind: 'analysis';
  name?: string;
  summary?: string;
  /** Page URL for the sub-analysis (e.g. `/reconstruction`). */
  url: string;
  decisions: number;
  outputs: number;
}

/**
 * The resolved model for one analysis scope, keyed by id. A theme recognizes a
 * placed node by its `identifier` (`output-<id>`, `decision-<id>`, …) + its
 * `astra-*` class and looks the data up here.
 */
export interface ResolvedStore {
  analysis: { id?: string; name?: string; slug: string };
  outputs: Record<string, SerializedOutput>;
  inputs: Record<string, SerializedInput>;
  decisions: Record<string, SerializedDecision>;
  findings: Record<string, SerializedFinding>;
  prior_insights: Record<string, SerializedInsight>;
  subanalyses: Record<string, SerializedSubAnalysis>;
}

// ── Builder ───────────────────────────────────────────────────────────────

/**
 * Build the resolved store for one analysis scope.
 *
 * @param analysis      the scope's analysis node (already narrowed to the page)
 * @param universe      the active (scope-narrowed) universe selections
 * @param results       resolves an output id → its artifact path in this scope
 * @param slug          the page slug (`index` for root)
 * @param resultUrl     absolute result path → project-relative URL
 * @param parentInputs  ancestor input maps (innermost-last) for `from:` aliases
 * @param priorInsights this scope's prior_insights merged over its ancestors'
 *                      (so option-tab references to inherited insights resolve)
 * @param pageFrame     this scope's provenance frame (parent-linked to the
 *                      root) — enables the transitive inputs_root /
 *                      decisions_transitive fields on outputs
 */
export function buildResolvedStore(
  analysis: Analysis,
  universe: Universe,
  results: ArtifactResolver,
  slug: string,
  resultUrl: (absPath: string) => string | undefined,
  parentInputs: Map<string, Input>[] = [],
  priorInsights: Record<string, Insight> = analysis.prior_insights ?? {},
  pageFrame: ProvFrame = { analysis, universe, where: [] },
  priorInsightPaths: ReadonlyMap<string, string> = new Map(),
): ResolvedStore {
  const outputs: Record<string, SerializedOutput> = {};
  for (const { declared, resolved } of resolveOutputs(analysis)) {
    const absPath = results(declared.id);
    const resolvedPath = absPath ? resultUrl(absPath) : undefined;
    const traced = traceProvenance(declared, pageFrame);
    outputs[declared.id] = {
      id: declared.id,
      path: recordPath(pageFrame.where, 'outputs', declared.id),
      kind: 'output',
      label: resolved.label,
      type: resolved.type,
      description: resolved.description,
      resolved_path: resolvedPath,
      recipe: resolved.recipe
        ? { command: resolved.recipe.command, container: resolved.recipe.container }
        : undefined,
      inputs: resolved.inputs,
      decisions: resolved.decisions,
      from: declared.from,
      table_preview:
        resolved.type === 'table' && absPath && resolvedPath
          ? buildPreview(absPath)
          : undefined,
      metric:
        resolved.type === 'metric' && absPath && resolvedPath
          ? readMetric(absPath)
          : undefined,
      inputs_root: traced.inputs_root,
      decisions_transitive: traced.decisions_transitive,
    };
  }

  const inputs: Record<string, SerializedInput> = {};
  for (const inp of analysis.inputs ?? []) {
    inputs[inp.id] = serializeInput(inp, parentInputs, pageFrame.where);
  }

  // Keep every declaration in the common record store. `active` tells page
  // themes whether a carrier exists under the current universe.
  const decisions: Record<string, SerializedDecision> = {};
  for (const [id, dec] of Object.entries(analysis.decisions ?? {})) {
    decisions[id] = serializeDecision(id, dec, universe, pageFrame.where);
  }

  const findings: Record<string, SerializedFinding> = {};
  for (const [id, f] of Object.entries(analysis.findings ?? {})) {
    findings[id] = {
      id,
      path: recordPath(pageFrame.where, 'findings', id),
      kind: 'finding',
      label: f.label,
      claim: f.claim,
      notes: f.notes,
      scope: stripUniverseClause(f.scope, universe.id),
      evidence: serializeEvidence(f.evidence),
    };
  }

  const prior_insights: Record<string, SerializedInsight> = {};
  for (const [id, ins] of Object.entries(priorInsights)) {
    prior_insights[id] = serializeInsight(
      id,
      ins,
      universe,
      pageFrame.where,
      priorInsightPaths.get(id),
    );
  }

  const subanalyses: Record<string, SerializedSubAnalysis> = {};
  const base = slug === 'index' ? '' : slug;
  for (const [id, sub] of Object.entries(analysis.analyses ?? {})) {
    subanalyses[id] = {
      id,
      path: recordPath(pageFrame.where, 'analyses', id),
      kind: 'analysis',
      name: sub.name,
      // ASTRA no longer carries a `narrative` section, so there is no authored
      // summary to surface on the card; the theme renders name + counts.
      url: '/' + (base ? `${base}/${id}` : id),
      decisions: Object.keys(sub.decisions ?? {}).length,
      outputs: (sub.outputs ?? []).length,
    };
  }

  return {
    analysis: { id: analysis.id, name: analysis.name, slug },
    outputs,
    inputs,
    decisions,
    findings,
    prior_insights,
    subanalyses,
  };
}

// ── Per-element serializers ─────────────────────────────────────────────────

function serializeDecision(
  id: string,
  dec: Decision,
  universe: Universe,
  scopePath: string[],
): SerializedDecision {
  const options: Record<string, string | undefined> = {};
  const option_insights: Record<string, string[]> = {};
  for (const [optId, opt] of Object.entries(dec.options ?? {})) {
    options[optId] = opt.label;
    if (opt.insights?.length) option_insights[optId] = [...opt.insights];
  }
  const active = isDecisionRendered(dec, universe);
  return {
    id,
    path: recordPath(scopePath, 'decisions', id),
    kind: 'decision',
    label: dec.label,
    rationale: dec.rationale,
    tags: dec.tags?.length ? [...dec.tags] : undefined,
    from: dec.from,
    when: dec.when?.length ? [...dec.when] : undefined,
    active,
    ...(active ? { selected: selectedOptionId(id, dec, universe) } : {}),
    options,
    option_insights: Object.keys(option_insights).length ? option_insights : undefined,
  };
}

function serializeInsight(
  id: string,
  ins: Insight,
  universe: Universe,
  scopePath: string[],
  path = recordPath(scopePath, 'prior_insights', id),
): SerializedInsight {
  const evidence = ins.evidence ?? [];
  return {
    id,
    path,
    kind: 'prior_insight',
    label: ins.label,
    scope: stripUniverseClause(ins.scope, universe.id),
    claim: ins.claim,
    notes: ins.notes,
    evidence: serializeEvidence(evidence),
    doi: evidence.find((e) => e.doi)?.doi,
    quote: evidence.find((e) => e.quote?.exact)?.quote?.exact,
    page: evidence.find((e) => e.location?.page != null)?.location?.page,
  };
}

/** Project an evidence list down to its serializable essentials. */
function serializeEvidence(evidence: Evidence[] | undefined): SerializedEvidence[] | undefined {
  const out = (evidence ?? [])
    .map((e) => ({
      artifact: e.artifact,
      doi: e.doi,
      quote: e.quote?.exact,
      page: e.location?.page,
    }))
    .filter((e) => e.artifact || e.doi || e.quote || e.page != null);
  return out.length ? out : undefined;
}

/**
 * Drop the active-universe clause from an authored scope string. Scopes are
 * free text that conventionally ends in "…, <universe> universe." — reader-
 * facing chrome should state the physical scope (tracers, recon state) without
 * multiverse jargon, and the active universe is implicit page-wide. Returns
 * `undefined` when nothing but the universe clause was authored.
 */
let clauseReCache: { universeId: string; re: RegExp } | undefined;

/** The universe-clause regex for one universe id, compiled once per build. */
function universeClauseRe(universeId: string): RegExp {
  if (clauseReCache?.universeId !== universeId) {
    const escaped = universeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clauseReCache = {
      universeId,
      re: new RegExp(
        `\\s*(?:[,;:—–-]|\\b(?:under|in|for)\\s+the\\b)?\\s*(?:the\\s+)?${escaped}\\s+universe\\b`,
        'gi',
      ),
    };
  }
  return clauseReCache.re;
}

function stripUniverseClause(
  scope: string | undefined,
  universeId: string | undefined,
): string | undefined {
  if (!scope || !universeId) return scope || undefined;
  let out = scope.replace(universeClauseRe(universeId), '');
  out = out.replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/^[,;:—–-]\s*/, '').replace(/\s*[,;:—–-]+\s*(\.?)$/, '$1').trim();
  if (out === '.') out = '';
  if (out && /[A-Za-z0-9)\]]$/.test(out) && /\.\s*$/.test(scope)) out += '.';
  return out || undefined;
}

/**
 * Resolve an input declaration for the store. Aliased inputs (`from: <id>`)
 * inherit content fields from the matching ancestor declaration (innermost
 * wins). Output-input cross-links (`from: scope.out_id`) are left as-is.
 */
function serializeInput(
  inp: Input,
  parentInputs: Map<string, Input>[],
  scopePath: string[],
): SerializedInput {
  const out: SerializedInput = {
    id: inp.id,
    path: recordPath(scopePath, 'inputs', inp.id),
    kind: 'input',
    label: inp.label,
    type: inp.type,
    description: inp.description,
    source: inp.source,
    from: inp.from,
    ref: inp.ref,
  };
  if (!inp.from) return out;
  if (inp.from.includes('.')) return out;
  const targetId = inp.from.split('/').pop() ?? inp.from;
  for (let i = parentInputs.length - 1; i >= 0; i--) {
    const src = parentInputs[i].get(targetId);
    if (!src) continue;
    return {
      ...out,
      type: out.type ?? src.type,
      label: out.label ?? src.label,
      description: out.description ?? src.description,
      source: out.source ?? src.source,
    };
  }
  return out;
}

function recordPath(
  scopePath: string[],
  collection: string,
  id: string,
): string {
  return [...scopePath, collection, id].join('.');
}

function buildPreview(absPath: string): SerializedTablePreview | undefined {
  const data: TableData | null = parseTableData(absPath);
  return data ? buildTablePreview(data) : undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Read and parse a metric output's result file (`.json` only). Accepts a bare
 * scalar, a `[value, uncertainty]` tuple, or an object with at least `value`;
 * anything else (or a read error) returns undefined. Shared with the
 * `{astra:value}` role, which interpolates metrics directly.
 */
export function readMetric(absPath: string): SerializedMetric | undefined {
  if (!absPath.toLowerCase().endsWith('.json')) return undefined;
  if (!existsSync(absPath)) return undefined;
  try {
    const raw: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
    if (typeof raw === 'number' || typeof raw === 'string') {
      return { value: raw };
    }
    if (Array.isArray(raw) && raw.length >= 1) {
      const [value, uncertainty] = raw;
      if (typeof value !== 'number' && typeof value !== 'string') return undefined;
      const out: SerializedMetric = { value };
      if (typeof uncertainty === 'number' || typeof uncertainty === 'string') {
        out.uncertainty = uncertainty;
      }
      return out;
    }
    if (raw && typeof raw === 'object' && 'value' in raw) {
      const obj = raw as Record<string, unknown>;
      const out: SerializedMetric = {};
      if (typeof obj.value === 'number' || typeof obj.value === 'string') out.value = obj.value;
      if (typeof obj.uncertainty === 'number' || typeof obj.uncertainty === 'string')
        out.uncertainty = obj.uncertainty;
      if (typeof obj.error === 'number' || typeof obj.error === 'string') out.error = obj.error;
      if (typeof obj.unit === 'string') out.unit = obj.unit;
      if (typeof obj.units === 'string') out.units = obj.units;
      if (typeof obj.label === 'string') out.label = obj.label;
      return Object.keys(out).length > 0 ? out : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
