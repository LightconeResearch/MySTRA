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
import type { RequestHandler } from 'express';
import type { ASTRAAnalysis, ASTRAInput, ASTRAOutput } from '../../types/astra.js';
import { resolveOutputs } from '../../transform/resolve-output.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SerializedOutput {
  id: string;
  label?: string;
  type?: string;
  description?: string;
  /** Relative URL served by the content server's /static mount, or undefined
   *  when no result artifact was found for this output. */
  resolved_path?: string;
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
  const outputs: SerializedOutput[] = resolvedOuts.map(({ declared, resolved }) => ({
    id: declared.id,
    label: resolved.label,
    type: resolved.type,
    description: resolved.description,
    resolved_path: resolvedPath(declared.id, results),
  }));

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
