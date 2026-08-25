/**
 * Output alias resolution.
 *
 * As of astra-spec v0.0.7, an Output with `from:` is a pure pointer
 * — type, description, inputs, decisions, and recipe are inherited
 * from the source (and `format`, since v0.0.14). The path grammar is
 * downward only:
 *
 *   from: child.out_id            -- own child sub's output
 *   from: child.grand.out_id      -- descend through nested children
 *
 * Resolution is the consumer's problem if MySTRA doesn't do it. To
 * keep the boundary clean (renderers pattern-match on emitted nodes,
 * never re-read `astra.yaml`), MySTRA does it here: every Output
 * surfaces a resolved view with type/format/description/inputs/
 * decisions/recipe inherited from the source if `from:` is set.
 *
 * This mirrors the resolver lightcone-ui's `ed0e69c` pulled into
 * `bundle.ts`; that work moves back into MySTRA so both
 * lightcone-ui's bundle layer and vellum (and any future renderer)
 * read the resolved view from the emitted mdast rather than walking
 * the spec themselves.
 */

import type { Analysis, Output } from '@astra-spec/sdk';

export interface ResolvedOutput {
  /** The original output as declared in this scope. */
  declared: Output;
  /**
   * The resolved view: type, format, description, inputs, decisions,
   * recipe filled in from the source if `from:` chains were walked. When
   * `declared.from` is unset, this equals `declared`.
   */
  resolved: Output;
  /**
   * True if `from:` was set but the path failed to resolve to an
   * output. Renderers can surface this as a broken-reference warning.
   */
  unresolved: boolean;
}

/**
 * Resolve an Output by walking its `from:` chain through nested
 * `analyses` of the surrounding scope. The walker descends one
 * sub-analysis per path segment; the last segment names the output.
 *
 * If the source itself has `from:`, the walker recurses, scoped to
 * that source's `analyses` map.
 *
 * Returns the original output if no `from:` is set.
 */
export function resolveOutput(
  output: Output,
  scope: Analysis,
): ResolvedOutput {
  if (!output.from) {
    return { declared: output, resolved: output, unresolved: false };
  }

  const source = walkOutputPath(output.from.split('.'), scope);

  if (!source) {
    // `from:` was set but the path didn't land on an output. The
    // local node should be a pure pointer (validator-enforced), so
    // declared inputs/decisions/recipe — if any — are spec
    // violations and shouldn't be surfaced. Return an empty resolved
    // view so consumers see "no provenance" instead of inheriting
    // from a half-broken declaration.
    const empty: Output = {
      id: output.id,
      from: output.from,
      when: output.when,
      label: output.label,
    };
    return { declared: output, resolved: empty, unresolved: true };
  }

  // Source might itself be aliased — recurse, scoped to the source's
  // surrounding analysis. The walker returns both the matched output
  // and its containing analysis, so the recursion has the right
  // scope to interpret the source's `from:` (if any).
  const { output: sourceOutput, parent } = source;
  if (sourceOutput.from) {
    const recursed = resolveOutput(sourceOutput, parent);
    // The chain supplies the inherited fields, but this output is still the
    // one declared *here*: re-stamp the local identity, exactly as the
    // single-hop merge below does. Returning the recursion's view verbatim
    // would leave `resolved.id` naming the intermediate alias, so every
    // consumer keying on it (`outputsById`, and through it the artifact
    // resolver's format hint) would look the output up under a name no page
    // ever writes.
    return {
      declared: output,
      resolved: {
        ...recursed.resolved,
        id: output.id,
        from: output.from,
        when: output.when,
        label: output.label ?? recursed.resolved.label,
      },
      unresolved: recursed.unresolved,
    };
  }

  // Merge: declared keeps its id/from/when (and label, if explicit);
  // everything else is inherited.
  const merged: Output = {
    id: output.id,
    from: output.from,
    when: output.when,
    label: output.label ?? sourceOutput.label,
    type: sourceOutput.type,
    // The schema forbids `format:` on a re-export, so an alias that reported
    // only what it declared would always report nothing — and the artifact
    // resolver would be back to guessing for exactly the outputs a reader is
    // most likely to be looking at.
    format: sourceOutput.format,
    description: sourceOutput.description,
    inputs: sourceOutput.inputs,
    decisions: sourceOutput.decisions,
    recipe: sourceOutput.recipe,
  };

  return { declared: output, resolved: merged, unresolved: false };
}

/**
 * Walk a path of `[child, sub, ..., out_id]` segments through nested
 * `analyses` and return the matched output along with its containing
 * analysis (so the caller can recurse if the matched output is itself
 * aliased).
 */
function walkOutputPath(
  parts: string[],
  scope: Analysis,
): { output: Output; parent: Analysis } | null {
  if (parts.length < 2) return null;

  let current: Analysis = scope;
  // All segments but the last name nested sub-analyses.
  for (let i = 0; i < parts.length - 1; i++) {
    const segId = parts[i];
    const next = current.analyses?.[segId];
    if (!next) return null;
    current = next;
  }

  const outId = parts[parts.length - 1];
  const output = (current.outputs ?? []).find((o) => o.id === outId);
  if (!output) return null;
  return { output, parent: current };
}

/**
 * Resolve every Output in an analysis — convenience for renderers
 * that want the resolved view across the registry.
 */
export function resolveOutputs(analysis: Analysis): ResolvedOutput[] {
  return (analysis.outputs ?? []).map((o) => resolveOutput(o, analysis));
}
