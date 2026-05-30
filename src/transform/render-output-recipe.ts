/**
 * Renders per-Output recipes as structured mdast carriers.
 *
 * Recipe is the *how* of an Output: a `command` template, an
 * execution `container`, and `resources` requirements. As of
 * astra-spec v0.0.7 (PR #19), provenance (inputs/decisions/when)
 * lives on the parent Output; Recipe shrinks to `{command,
 * container, resources}` — pure execution detail.
 *
 * Why MySTRA emits Recipe at all
 * ──────────────────────────────
 * The parent constitution ([[vellum-reader/myst-as-ast-layer-for-
 * lightcone-ui]]) says MySTRA owns the entire ASTRA → mdast
 * translation: any consumer reading `astra.yaml` directly is a
 * leak. Recipe is in the spec, so MySTRA must emit something for
 * it — even if downstream renderers choose to hide it. The
 * constitution body laid out two coherent renderer-side positions
 * ("hide" vs "render as collapsible technical detail"); this
 * carrier subsumes both. The structured `data` slot lets renderers
 * pattern-match (and decide whether to surface, suppress, or
 * re-style); the fallback `children` are a `details` block
 * collapsed by default, so renderers that just walk the AST get a
 * minimal, dwell-friendly disclosure rather than a wall of recipe
 * text.
 *
 * Carrier shape
 * ─────────────
 *   {
 *     type: 'container',
 *     kind: 'output-recipe',
 *     identifier: 'output-<id>-recipe',
 *     label:      'output-<id>-recipe',
 *     class:      'astra astra-output-recipe',
 *     data: {
 *       astraKind: 'output_recipe',
 *       outputId:  '<id>',
 *       command:   string | null,
 *       container: string | null,
 *       resources: { cpus?, memory?, disk?, gpus?, time_limit? } | null,
 *       from:      <resolved-from-chain> | null,
 *       unresolved: <bool>,
 *     },
 *     children: [
 *       // Fallback rendering: a `details` block, collapsed by
 *       // default, containing labeled metadata + a `code` block
 *       // for the command.
 *     ],
 *   }
 *
 * `Output.from` is resolved before emission via the same path as
 * provenance — an aliased Output inherits the source's recipe.
 * The original `from:` path is preserved in `data.from` so
 * renderers can still expose "this is a re-export of X".
 *
 * Predicate: emit only when the resolved recipe has at least one
 * populated field (command, container, or any resources entry).
 * An aliased Output whose source has no recipe gets no carrier —
 * mirrors the provenance carrier's "no phantom blocks" contract.
 */

import type {
  Analysis as ASTRAAnalysis,
  Recipe as ASTRARecipe,
  Resources as ASTRAResources,
} from '@astra-spec/sdk';
import {
  paragraph,
  text,
  strong,
  inlineCode,
  code,
  details,
  summary,
} from './ast-helpers.js';
import { resolveOutputs, type ResolvedOutput } from './resolve-output.js';

/**
 * Emit a flat sequence of recipe carriers, one per Output with a
 * non-empty resolved recipe. Outputs with no recipe (after `from:`
 * resolution) get no block.
 */
export function renderOutputRecipes(analysis: ASTRAAnalysis): any[] {
  const resolved = resolveOutputs(analysis);
  return resolved.filter(hasRecipe).map((r) => renderOne(r));
}

/**
 * True when at least one recipe field is populated. Resources is
 * "populated" if it has any non-empty entry; an empty `resources:
 * {}` block doesn't earn a carrier.
 */
export function hasRecipe(r: ResolvedOutput): boolean {
  const recipe = r.resolved.recipe;
  if (!recipe) return false;
  if (recipe.command || recipe.container) return true;
  return hasResources(recipe.resources);
}

function hasResources(resources?: ASTRAResources): boolean {
  if (!resources) return false;
  return (
    resources.cpus != null ||
    resources.memory != null ||
    resources.disk != null ||
    resources.gpus != null ||
    resources.time_limit != null
  );
}

function renderOne(r: ResolvedOutput): any {
  const { declared, resolved, fromChain, unresolved } = r;
  const recipe = resolved.recipe!;
  const outputId = declared.id;
  const identifier = `output-${outputId}-recipe`;

  return {
    type: 'container',
    kind: 'output-recipe',
    identifier,
    label: identifier,
    class: 'astra astra-output-recipe',
    data: {
      astraKind: 'output_recipe',
      outputId,
      command: recipe.command ?? null,
      container: recipe.container ?? null,
      resources: hasResources(recipe.resources) ? { ...recipe.resources } : null,
      from: fromChain.length > 0 ? fromChain.join('.') : null,
      unresolved,
    },
    children: fallbackChildren(recipe),
  };
}

/**
 * Fallback rendering: a `details` block (collapsed by default)
 * with a "Recipe" summary, the command in a code block, and
 * labeled paragraphs for container and resources. Renderers that
 * pattern-match on `data` can ignore these; renderers that walk
 * the AST get a minimal disclosure.
 *
 * The block is collapsed by default. That's the "render as
 * collapsible technical detail" position from the constitution —
 * recipes are visible to the technically curious, tucked away by
 * default. Renderers that prefer the "hide" position can suppress
 * `kind: 'output-recipe'` carriers; renderers that prefer to
 * render their own way can read `data` and emit whatever they
 * want. Both positions are reachable from this single emission.
 */
function fallbackChildren(recipe: ASTRARecipe): any[] {
  const inner: any[] = [summary([text('Recipe')])];

  if (recipe.command) {
    inner.push(code('bash', recipe.command));
  }
  if (recipe.container) {
    inner.push(
      paragraph([
        strong([text('Container: ')]),
        inlineCode(recipe.container),
      ]),
    );
  }
  if (hasResources(recipe.resources)) {
    inner.push(paragraph(resourceLine(recipe.resources!)));
  }

  return [details(inner, /* open */ false)];
}

/**
 * Render the resources block as a "key: value, key: value"
 * paragraph. Dense by design — recipes are technical detail; a
 * single line of compact metadata reads better than a sub-list.
 */
function resourceLine(resources: ASTRAResources): any[] {
  const parts: Array<{ label: string; value: string }> = [];
  if (resources.cpus != null) parts.push({ label: 'cpus', value: String(resources.cpus) });
  if (resources.memory) parts.push({ label: 'memory', value: resources.memory });
  if (resources.disk) parts.push({ label: 'disk', value: resources.disk });
  if (resources.gpus != null) parts.push({ label: 'gpus', value: String(resources.gpus) });
  if (resources.time_limit) parts.push({ label: 'time_limit', value: resources.time_limit });

  const out: any[] = [strong([text('Resources: ')])];
  parts.forEach((p, i) => {
    if (i > 0) out.push(text(', '));
    out.push(text(p.label + ': '));
    out.push(inlineCode(p.value));
  });
  return out;
}
