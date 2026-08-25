/**
 * Transitive provenance for outputs (the store's `inputs_root` /
 * `decisions_transitive` fields).
 *
 * An output's declared `inputs[]`/`decisions[]` are *direct* edges: inputs may
 * be analysis-level source data, but just as often they are intermediates —
 * outputs of sub-analyses referenced either directly by dotted id
 * (`clustering.xi_post_recon_lrg1`) or through an input cross-link
 * (`from: reconstruction.post_recon_catalog_lrg_full`, resolved against an
 * ancestor scope for sibling references). For a reader the interesting
 * question is "what actually affects this result": the *analysis-level* input
 * files at the roots of that chain, and *every* decision encountered along it.
 *
 * This module walks the chain once at store-build time and flattens it:
 *
 *   inputs_root          — root input files only (intermediates traced through)
 *   decisions_transitive — every decision on the chain, with the option label
 *                          selected under the active universe and, for
 *                          decisions picked up inside another scope, a `via`
 *                          dot-path (root-relative) saying where.
 *
 * Scopes are tracked as a parent-linked chain of frames so sibling references
 * (`reconstruction.…` seen from `clustering`) resolve by climbing toward the
 * root and walking back down, narrowing the universe at each descent — the
 * same narrowing `resolveScope` applies for pages.
 */

import type { Analysis, Decision, Input, Output } from '@astra-spec/sdk';
import { resolveOutput } from './resolve-output.js';
import { selectedOptionId } from './render-methods.js';

/** The subset of Universe/UniverseNode the tracer needs. */
export interface UniverseLike {
  decisions?: Record<string, string>;
  analyses?: Record<string, UniverseLike>;
}

/** One scope on the provenance walk, parent-linked toward the root. */
export interface ProvFrame {
  analysis: Analysis;
  universe: UniverseLike;
  /** Root-relative dot-path of this scope ([] = root analysis). */
  where: string[];
  parent?: ProvFrame;
}

export interface SerializedProvenanceDecision {
  id: string;
  label?: string;
  /** Selected option label (or id) under the active universe. */
  selection?: string;
  /** Root-relative scope the decision lives in, when not the page's own. */
  via?: string;
}

export interface SerializedRootInput {
  id: string;
  label?: string;
}

export interface TracedProvenance {
  inputs_root: SerializedRootInput[];
  decisions_transitive: SerializedProvenanceDecision[];
}

/** Build the root→page frame chain for a page scope. */
export function pageFrames(
  analyses: Analysis[], // root-first, page-scope last
  rootUniverse: UniverseLike,
  pathSegs: string[], // [] for the root page
): ProvFrame {
  let frame: ProvFrame = { analysis: analyses[0], universe: rootUniverse, where: [] };
  pathSegs.forEach((seg, i) => {
    frame = {
      analysis: analyses[i + 1],
      universe: narrow(frame.universe, seg),
      where: [...frame.where, seg],
      parent: frame,
    };
  });
  return frame;
}

/**
 * Narrow a universe to one sub-analysis's selections — the same narrowing
 * `resolveScope` applies for pages (which spreads the root `id`/`description`
 * back on top).
 */
export function narrow(universe: UniverseLike, seg: string): UniverseLike {
  const sub = universe.analyses?.[seg];
  return { decisions: sub?.decisions ?? {}, analyses: sub?.analyses };
}

/** Where a decision reference landed: its declaring id, decision, and scope. */
export interface ResolvedDecisionRef {
  /** The id in the declaring scope — a re-export's `from:` target, if it had one. */
  id: string;
  /** Undefined when the id is absent, or an alias chain led nowhere. */
  decision?: Decision;
  /** The frame that declares it, whose universe supplies the selection. */
  frame: ProvFrame;
}

/**
 * Follow a decision's `from: ../…` chain up to the scope that declares it.
 *
 * A re-exported decision is a pure pointer with no local `options` (see
 * `isDecisionRendered`), so every surface that wants its label, its options, or
 * the universe's selection has to climb first. Each leading `../` is exactly
 * one level up, so they are stripped one at a time and climbed per `../` — a
 * single greedy strip would collapse `../../x` to one climb and resolve it in
 * the wrong scope. A chained alias on the resolved decision is followed by the
 * outer loop.
 *
 * When the walk cannot land — a dangling `from:`, or a climb past the root —
 * `decision` is undefined and `frame` is wherever it stopped. Callers treat
 * that as "unknown", never as "absent": `validateAnalysis` owns reporting a
 * broken `from:`, and the target may simply be out of view from here.
 */
export function resolveDecisionRef(id: string, frame: ProvFrame): ResolvedDecisionRef {
  let decision: Decision | undefined = frame.analysis.decisions?.[id];
  let at = frame;
  while (decision?.from?.startsWith('../') && at.parent) {
    let rel = decision.from;
    while (rel.startsWith('../') && at.parent) {
      rel = rel.slice(3);
      at = at.parent;
    }
    id = rel;
    decision = at.analysis.decisions?.[id];
  }
  return { id, decision, frame: at };
}

/** Trace one output (declared in `page`'s scope) to its roots. */
export function traceProvenance(output: Output, page: ProvFrame): TracedProvenance {
  const decisions = new Map<string, SerializedProvenanceDecision>();
  const roots = new Map<string, SerializedRootInput>();
  const seen = new Set<string>();
  const pageWhere = page.where.join('.');

  const addDecision = (localId: string, frame: ProvFrame) => {
    const { id, decision: dec, frame: at } = resolveDecisionRef(localId, frame);
    const selectedId = selectedOptionId(id, dec, at.universe);
    const selection =
      (selectedId != null ? dec?.options?.[selectedId]?.label : undefined) ?? selectedId;
    const whereStr = at.where.join('.');
    const via = whereStr === pageWhere ? undefined : whereStr || 'root';
    const prev = decisions.get(id);
    // direct (no via) beats transitive; otherwise first hit wins
    if (prev && (prev.via === undefined || via !== undefined)) return;
    decisions.set(id, { id, label: dec?.label, selection, via });
  };

  const addRoot = (inp: Input | string, frame: ProvFrame) => {
    // plain `from:` aliases inherit from ancestor declarations (innermost wins)
    let id = typeof inp === 'string' ? inp : inp.id;
    let label = typeof inp === 'string' ? undefined : inp.label;
    let from = typeof inp === 'string' ? undefined : inp.from;
    let at = frame;
    while (from && !from.includes('.') && at.parent) {
      at = at.parent;
      const src = (at.analysis.inputs ?? []).find((i) => i.id === from);
      if (!src) break;
      id = src.id;
      label = label ?? src.label;
      from = src.from;
    }
    if (!roots.has(id)) roots.set(id, { id, label });
  };

  /** Resolve a dotted output path: descend from `frame`, else climb and retry. */
  const resolvePath = (
    path: string,
    frame: ProvFrame,
  ): { output: Output; frame: ProvFrame } | undefined => {
    const segs = path.split('.');
    for (let base: ProvFrame | undefined = frame; base; base = base.parent) {
      let at: ProvFrame = base;
      let ok = true;
      for (const seg of segs.slice(0, -1)) {
        const child = at.analysis.analyses?.[seg];
        if (!child) {
          ok = false;
          break;
        }
        at = {
          analysis: child,
          universe: narrow(at.universe, seg),
          where: [...at.where, seg],
          parent: at,
        };
      }
      if (!ok) continue;
      const out = (at.analysis.outputs ?? []).find((o) => o.id === segs[segs.length - 1]);
      if (out) return { output: out, frame: at };
    }
    return undefined;
  };

  const trace = (out: Output, frame: ProvFrame) => {
    const key = `${frame.where.join('.')}::${out.id}`;
    if (seen.has(key)) return;
    seen.add(key);

    // output `from:` aliases inherit provenance from their source — resolve,
    // and walk the chain in the SOURCE scope so its ids mean what they say.
    let resolved = out;
    let at = frame;
    if (out.from) {
      const r = resolveOutput(out, frame.analysis);
      if (r.unresolved) return;
      resolved = r.resolved;
      const hop = resolvePath(out.from, frame);
      if (hop) at = hop.frame;
    }

    for (const d of resolved.decisions ?? []) addDecision(d, at);

    for (const ref of resolved.inputs ?? []) {
      if (ref.includes('.')) {
        // dotted: a sub/sibling output referenced directly
        const hit = resolvePath(ref, at);
        if (hit) trace(hit.output, hit.frame);
        else addRoot(ref, at);
        continue;
      }
      const inp = (at.analysis.inputs ?? []).find((i) => i.id === ref);
      if (inp) {
        if (inp.from && inp.from.includes('.')) {
          // input cross-link to another scope's output → intermediate
          const hit = resolvePath(inp.from, at);
          if (hit) trace(hit.output, hit.frame);
          else addRoot(inp, at);
        } else {
          addRoot(inp, at); // analysis-level source data
        }
        continue;
      }
      // same-scope output chaining, else give up and surface the id as-is
      const sameScope = (at.analysis.outputs ?? []).find((o) => o.id === ref);
      if (sameScope) trace(sameScope, at);
      else addRoot(ref, at);
    }
  };

  trace(output, page);
  return {
    inputs_root: [...roots.values()],
    decisions_transitive: [...decisions.values()],
  };
}
