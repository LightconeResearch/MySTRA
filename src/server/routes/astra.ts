/**
 * /astra/<slug>.json — structured ASTRA data for a page slug.
 *
 * Returns the resolved outputs and inputs for a given analysis, keyed by the
 * same slug that the content server uses for /content/<slug>.json.  Renderers
 * that want ASTRA-native gallery views (figure previews, file inventories) hit
 * this endpoint instead of parsing the MDAST for structural tables.
 *
 * Outputs carry a `resolved_path` that resolves to `/static/<filename>` — the
 * same static mount the content server uses for result artifacts.  Inputs carry
 * their `source` URL (for data inputs) and `from` path (for aliased inputs).
 *
 * This fills the emission gap named in the dual-branch parity constitution:
 * the MDAST tables that MySTRA emits for outputs/inputs convey prose context
 * but not the artifact-native shape (gallery cards, file inventory rows) that
 * renderers need to match the vanilla paper-view baseline.
 */

import { basename } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { RequestHandler } from 'express';
import type { ASTRAAnalysis, ASTRAInput, ASTRAOutput } from '../../types/astra.js';
import { resolveOutputs } from '../../transform/resolve-output.js';
import { parseTableData, type TableData } from '../../transform/parse-table-data.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SerializedRecipe {
  /** Resolved shell command — recipe.command from astra.yaml. */
  command?: string;
  /** Container image / Containerfile path (when declared). */
  container?: string;
}

/**
 * Inlined metric-output value data, parsed from the materialised result file
 * at build time so renderers can hero-print value ± uncertainty + unit
 * without a second round-trip. Mirrors the shape the React port's
 * `MetricGalleryCard` and `lightcone-ui-liam`'s `attachMetricData` consume.
 *
 * Three accepted source shapes:
 *   - bare number / string             → { value }
 *   - `[value, uncertainty]` 2-tuple   → { value, uncertainty }
 *   - object with at least `value`     → spread as-is (value, uncertainty,
 *                                        unit, label, …)
 *
 * Anything else (or an unreadable file) leaves `metric` absent; the renderer
 * falls back to a "no value" placeholder.
 */
export interface SerializedMetric {
  value?: number | string;
  uncertainty?: number | string;
  /** Alias for `uncertainty` accepted by some convention; the renderer reads
   *  either. */
  error?: number | string;
  unit?: string;
  /** Plural alias accepted by some convention. */
  units?: string;
  label?: string;
}

export interface SerializedOutput {
  id: string;
  label?: string;
  type?: string;
  description?: string;
  /** Relative URL served by the content server's /static mount, or undefined
   *  when no result artifact was found for this output. */
  resolved_path?: string;
  /** Recipe command + container.  When the output is aliased (`from:`),
   *  recipe is inherited from the source by `resolveOutputs`. */
  recipe?: SerializedRecipe;
  /** Input IDs (in the surrounding analysis scope) this output depends on. */
  inputs?: string[];
  /** Decision IDs (declared on the output) that parameterise this artefact.
   *  Drives the "Decisions affecting this artefact" section on the per-output
   *  detail page.  Absent / empty → "None — no decision flows into this
   *  artefact's recipe chain" (matching Liam's vanilla template). */
  decisions?: string[];
  /** Re-export pointer for aliased outputs (`from: child.out_id`).  When set,
   *  type/description/inputs/decisions/recipe are inherited from the source;
   *  the alias node carries only id/from/when. */
  from?: string;
  /**
   * Parsed table data for table-type outputs.  Populated by MySTRA at build
   * time using the same CSV/JSON parser as the narrative evidence renderer.
   *
   * Absent for non-table outputs, missing result files, unsupported
   * extensions (parquet, etc.), or when the row count exceeds MAX_INLINE_ROWS.
   * When `truncated` is true the source file has more rows than `rows.length`.
   */
  table_data?: TableData;
  /**
   * Inlined metric value, populated for `type: 'metric'` outputs whose
   * result file parses as JSON. Absent for non-metric outputs, missing
   * result files, non-JSON extensions, or unparseable content.
   */
  metric?: SerializedMetric;
}

export interface SerializedInput {
  id: string;
  label?: string;
  type?: string;
  description?: string;
  /** URL for data inputs (external dataset reference). */
  source?: string;
  /** Path string for aliased inputs that forward to a parent or sibling output. */
  from?: string;
}

export interface ASTRAPageData {
  outputs: SerializedOutput[];
  inputs: SerializedInput[];
}

// ── Route handler ─────────────────────────────────────────────────────────────

export function astraHandler(
  getDataMap: () => Map<string, ASTRAPageData>,
): RequestHandler {
  return (req, res) => {
    const slug = (req.params as Record<string, string>)[0] ?? 'index';
    const map = getDataMap();
    const data = map.get(slug);
    if (!data) {
      res.status(404).json({ error: `No ASTRA data for slug: ${slug}` });
      return;
    }
    res.json(data);
  };
}

// ── Data builder ──────────────────────────────────────────────────────────────

/**
 * Walk the analysis tree (same recursion as `buildAllPages`) and produce a
 * slug → ASTRAPageData map.  Called once per reload; the server stores the
 * result and serves it via `astraHandler`.
 */
export function buildASTRADataMap(
  analysis: ASTRAAnalysis,
  results: Map<string, string>,
  basePath = '',
): Map<string, ASTRAPageData> {
  const map = new Map<string, ASTRAPageData>();
  const slug = basePath || 'index';

  const resolvedOuts = resolveOutputs(analysis);
  const outputs: SerializedOutput[] = resolvedOuts.map(({ declared, resolved }) => {
    // For table-type outputs with a materialized result file, parse and inline
    // the data so the React renderer can display it without a second round-trip.
    // Uses the same CSV/JSON parser as the narrative evidence renderer — no
    // second reader introduced.
    const absPath = results.get(declared.id);
    const tableData =
      resolved.type === 'table' && absPath ? (parseTableData(absPath) ?? undefined) : undefined;
    const metric = resolved.type === 'metric' && absPath ? readMetric(absPath) : undefined;

    return {
      id: declared.id,
      label: resolved.label,
      type: resolved.type,
      description: resolved.description,
      resolved_path: resolvedPath(declared.id, results),
      // Provenance (Liam parity for `#/spec/<id>` per-output detail page):
      //   recipe — command + declared inputs (the "Recipe" section)
      //   decisions — IDs that parameterise this output (the "Decisions
      //     affecting this artefact" section; absent → "None")
      //   from — alias pointer for re-exported outputs
      // Aliased outputs (`from:`) inherit recipe/decisions/inputs from the
      // source via resolveOutputs above, so the serialised view is the
      // resolved one regardless of whether the declaration site was an alias.
      recipe: resolved.recipe
        ? { command: resolved.recipe.command, container: resolved.recipe.container }
        : undefined,
      inputs: resolved.inputs,
      decisions: resolved.decisions,
      from: declared.from,
      table_data: tableData,
      metric,
    };
  });

  const inputs: SerializedInput[] = (analysis.inputs ?? []).map((inp: ASTRAInput) => ({
    id: inp.id,
    label: inp.label,
    type: inp.type,
    description: inp.description,
    source: inp.source,
    from: inp.from,
  }));

  map.set(slug, { outputs, inputs });

  // Recurse into sub-analyses (mirrors buildAllPages depth-first walk).
  for (const [subId, sub] of Object.entries(analysis.analyses ?? {})) {
    const subPath = basePath ? `${basePath}/${subId}` : subId;
    for (const [subSlug, subData] of buildASTRADataMap(sub, results, subPath)) {
      map.set(subSlug, subData);
    }
  }

  return map;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolvedPath(
  outputId: string,
  results: Map<string, string>,
): string | undefined {
  const absPath = results.get(outputId);
  if (!absPath) return undefined;
  return `/static/${basename(absPath)}`;
}

/**
 * Read and parse a metric output's result file. Mirrors the
 * `attachMetricData` recipe in `lightcone-ui-liam/packages/core/src/bundle.ts`
 * — three accepted source shapes (bare scalar, 2-tuple, object), anything
 * else returns undefined so the renderer falls back to a placeholder.
 *
 * Limited to `.json` files; other extensions don't surface as inline metric
 * heroes (matches Liam's pipeline). Read errors are swallowed — silently
 * dropping is correct here, the React renderer's empty state is the contract.
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
      // Only surface scalar value/uncertainty pairs; arrays of objects
      // belong on the table-data path, not the metric hero.
      if (typeof value !== 'number' && typeof value !== 'string') return undefined;
      const out: SerializedMetric = { value };
      if (typeof uncertainty === 'number' || typeof uncertainty === 'string') {
        out.uncertainty = uncertainty;
      }
      return out;
    }
    if (raw && typeof raw === 'object' && 'value' in raw) {
      // Spread the object — accept any of value/uncertainty/error/unit/units/label.
      const obj = raw as Record<string, unknown>;
      const out: SerializedMetric = {};
      if (typeof obj.value === 'number' || typeof obj.value === 'string')
        out.value = obj.value;
      if (typeof obj.uncertainty === 'number' || typeof obj.uncertainty === 'string')
        out.uncertainty = obj.uncertainty;
      if (typeof obj.error === 'number' || typeof obj.error === 'string')
        out.error = obj.error;
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
