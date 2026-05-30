/**
 * Renders per-Output provenance as structured mdast carriers.
 *
 * The unit of provenance, as of astra-spec v0.0.7 (PR #19), is the
 * Output: `Output.inputs` lists the upstream artifact IDs the output
 * depends on, and `Output.decisions` lists the decision IDs that
 * parameterize it. The Recipe is pure *how* — runners invoke the
 * `command` with the inputs/decisions surfaced via template
 * substitution, but the spec contract lives on the Output.
 *
 * This module emits one container per Output that has any
 * provenance to declare. The container shape mirrors the
 * `prior-insight` carrier pattern (kebab-case `kind`, snake_case
 * structural identifier, `data.astraKind` discriminator):
 *
 *   {
 *     type: 'container',
 *     kind: 'output-provenance',
 *     identifier: 'output-<id>-provenance',
 *     label:      'output-<id>-provenance',
 *     class:      'astra astra-output-provenance',
 *     data: {
 *       astraKind: 'output_provenance',
 *       outputId:  '<id>',
 *       inputs:    [...resolved IDs],
 *       decisions: [...resolved IDs],
 *       from:      <resolved-from-chain> | null,
 *     },
 *     children: [
 *       <inline list of input crossReferences>,
 *       <inline list of decision crossReferences>,
 *     ],
 *   }
 *
 * The `data` slot is the contract for renderers that want to show
 * provenance; the children are a fallback rendering for renderers
 * that just walk the AST without inspecting `data`. Either way, the
 * carrier is stable: an Output always has at most one provenance
 * block, addressable by `output-<id>-provenance`.
 *
 * `Output.from` is resolved before emission — an aliased Output
 * inherits its source's `inputs`/`decisions`. The original `from`
 * path is preserved in `data.from` so renderers can still expose
 * "this is a re-export of X" if they want.
 */

import type { Analysis as ASTRAAnalysis } from '@astra-spec/sdk';
import {
  paragraph,
  text,
  strong,
  crossReference,
} from './ast-helpers.js';
import { resolveOutputs, type ResolvedOutput } from './resolve-output.js';

/**
 * Emit a flat sequence of provenance carriers, one per Output with
 * non-empty provenance. Outputs with no `inputs:` and no `decisions:`
 * (after `from:` resolution) get no block — there's nothing to say.
 */
export function renderOutputProvenance(analysis: ASTRAAnalysis): any[] {
  const resolved = resolveOutputs(analysis);
  return resolved
    .filter(hasProvenance)
    .map((r) => renderOne(r));
}

function hasProvenance(r: ResolvedOutput): boolean {
  const inputs = r.resolved.inputs ?? [];
  const decisions = r.resolved.decisions ?? [];
  return inputs.length > 0 || decisions.length > 0;
}

function renderOne(r: ResolvedOutput): any {
  const { declared, resolved, fromChain, unresolved } = r;
  const outputId = declared.id;
  const identifier = `output-${outputId}-provenance`;
  const inputIds = resolved.inputs ?? [];
  const decisionIds = resolved.decisions ?? [];

  const children: any[] = [];

  // Inline phrasing children: provide a fallback rendering so
  // renderers that don't inspect `data` still surface the provenance.
  // Each input/decision is emitted as a crossReference so anchor
  // navigation works without renderer-side resolution.
  if (inputIds.length > 0) {
    const refs: any[] = inputIds.map((id) =>
      crossReference(`input-${id}`, [text(id)]),
    );
    children.push(
      paragraph([
        strong([text('Inputs: ')]),
        ...interleave<any>(refs, () => text(', ')),
      ]),
    );
  }
  if (decisionIds.length > 0) {
    const refs: any[] = decisionIds.map((id) =>
      crossReference(`decision-${id}`, [text(id)]),
    );
    children.push(
      paragraph([
        strong([text('Decisions: ')]),
        ...interleave<any>(refs, () => text(', ')),
      ]),
    );
  }

  return {
    type: 'container',
    kind: 'output-provenance',
    identifier,
    label: identifier,
    class: 'astra astra-output-provenance',
    data: {
      astraKind: 'output_provenance',
      outputId,
      inputs: inputIds,
      decisions: decisionIds,
      // `from` chain (if any) and unresolved flag — lets renderers
      // distinguish "this is a re-export" from "this is local
      // provenance" and surface broken references.
      from: fromChain.length > 0 ? fromChain.join('.') : null,
      unresolved,
    },
    children,
  };
}

/**
 * Interleave a list of nodes with separators. Used for ", "-joining
 * crossReference chips inline. Avoids `.flatMap` boilerplate at call
 * sites and keeps the separator a thunk so each one is a fresh node.
 */
function interleave<T>(items: T[], separator: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) out.push(separator());
    out.push(items[i]);
  }
  return out;
}
