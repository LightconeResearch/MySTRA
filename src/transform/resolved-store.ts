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
 * (`resolveOutputs`, `table_data`, `readMetric`, input aliasing) — but emitted
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
import { isDecisionRendered } from './render-methods.js';
import { firstParagraphText } from './prose.js';
import { parseTableData, type TableData } from './parse-table-data.js';

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
  /** Parsed rows for table outputs (same parser as the evidence renderer). */
  table_data?: TableData;
  /** Inlined value for metric outputs whose result file parses as JSON. */
  metric?: SerializedMetric;
  /** Analysis-level source inputs at the roots of the provenance chain. */
  inputs_root?: SerializedRootInput[];
  /** Every decision affecting this output, direct or via another scope. */
  decisions_transitive?: SerializedProvenanceDecision[];
}

export interface SerializedInput {
  id: string;
  label?: string;
  type?: string;
  description?: string;
  source?: string;
  from?: string;
}

export interface SerializedDecision {
  id: string;
  label?: string;
  rationale?: string;
  /** The option id selected under the active universe (or the default). */
  selected?: string;
  /** All option ids → their labels. */
  options: Record<string, string | undefined>;
}

export interface SerializedFinding {
  id: string;
  label?: string;
  claim?: string;
  notes?: string;
  scope?: string;
}

export interface SerializedInsight {
  id: string;
  label?: string;
  scope?: string;
  claim?: string;
  /** First evidence DOI, when present (the theme can resolve the citation). */
  doi?: string;
  /** First exact-quote evidence, when present. */
  quote?: string;
}

export interface SerializedSubAnalysis {
  id: string;
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
  resultUrl: (absPath: string) => string,
  parentInputs: Map<string, Input>[] = [],
  priorInsights: Record<string, Insight> = analysis.prior_insights ?? {},
  pageFrame: ProvFrame = { analysis, universe, where: [] },
): ResolvedStore {
  const outputs: Record<string, SerializedOutput> = {};
  for (const { declared, resolved } of resolveOutputs(analysis)) {
    const absPath = results(declared.id);
    const traced = traceProvenance(declared, pageFrame);
    outputs[declared.id] = {
      id: declared.id,
      label: resolved.label,
      type: resolved.type,
      description: resolved.description,
      resolved_path: absPath ? resultUrl(absPath) : undefined,
      recipe: resolved.recipe
        ? { command: resolved.recipe.command, container: resolved.recipe.container }
        : undefined,
      inputs: resolved.inputs,
      decisions: resolved.decisions,
      from: declared.from,
      table_data:
        resolved.type === 'table' && absPath ? (parseTableData(absPath) ?? undefined) : undefined,
      metric: resolved.type === 'metric' && absPath ? readMetric(absPath) : undefined,
      inputs_root: traced.inputs_root,
      decisions_transitive: traced.decisions_transitive,
    };
  }

  const inputs: Record<string, SerializedInput> = {};
  for (const inp of analysis.inputs ?? []) {
    inputs[inp.id] = serializeInput(inp, parentInputs);
  }

  // Only decisions with a real carrier on the page (same predicate the
  // directive uses): bare `from`-references and `when`-unmet decisions have
  // no node to join to and don't apply under this universe.
  const decisions: Record<string, SerializedDecision> = {};
  for (const [id, dec] of Object.entries(analysis.decisions ?? {})) {
    if (isDecisionRendered(dec, universe)) decisions[id] = serializeDecision(id, dec, universe);
  }

  const findings: Record<string, SerializedFinding> = {};
  for (const [id, f] of Object.entries(analysis.findings ?? {})) {
    findings[id] = {
      id,
      label: f.label,
      claim: f.claim,
      notes: f.notes,
      scope: f.scope,
    };
  }

  const prior_insights: Record<string, SerializedInsight> = {};
  for (const [id, ins] of Object.entries(priorInsights)) {
    prior_insights[id] = serializeInsight(id, ins);
  }

  const subanalyses: Record<string, SerializedSubAnalysis> = {};
  const base = slug === 'index' ? '' : slug;
  for (const [id, sub] of Object.entries(analysis.analyses ?? {})) {
    subanalyses[id] = {
      id,
      name: sub.name,
      summary: firstParagraphText(sub.narrative?.summary),
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
): SerializedDecision {
  const options: Record<string, string | undefined> = {};
  for (const [optId, opt] of Object.entries(dec.options ?? {})) {
    options[optId] = opt.label;
  }
  return {
    id,
    label: dec.label,
    rationale: dec.rationale,
    selected: universe.decisions?.[id] ?? dec.default,
    options,
  };
}

function serializeInsight(id: string, ins: Insight): SerializedInsight {
  const evidence = ins.evidence ?? [];
  return {
    id,
    label: ins.label,
    scope: ins.scope,
    claim: ins.claim,
    doi: evidence.find((e) => e.doi)?.doi,
    quote: evidence.find((e) => e.quote?.exact)?.quote?.exact,
  };
}

/**
 * Resolve an input declaration for the store. Aliased inputs (`from: <id>`)
 * inherit content fields from the matching ancestor declaration (innermost
 * wins). Output-input cross-links (`from: scope.out_id`) are left as-is.
 */
function serializeInput(inp: Input, parentInputs: Map<string, Input>[]): SerializedInput {
  const out: SerializedInput = {
    id: inp.id,
    label: inp.label,
    type: inp.type,
    description: inp.description,
    source: inp.source,
    from: inp.from,
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

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Read and parse a metric output's result file (`.json` only). Accepts a bare
 * scalar, a `[value, uncertainty]` tuple, or an object with at least `value`;
 * anything else (or a read error) returns undefined.
 */
function readMetric(absPath: string): SerializedMetric | undefined {
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
