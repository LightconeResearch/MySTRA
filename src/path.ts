/**
 * The unified ASTRA reference path grammar.
 *
 * A *path* is a dot-separated route through the analysis tree — the same
 * structure as `astra.yaml`, and the same dotted spelling the spec itself uses
 * for element references (`when: decision.option`, `from: scope.id`, recipe
 * placeholders `{inputs.id}`, and RFC-0002's `<sub>.<id>` addressing). Dots
 * address elements; slashes are reserved for files. Paths always resolve from
 * the root analysis (a leading `/` is tolerated):
 *
 *   outputs.hubble_diagram                    an output in the root analysis
 *   decisions.algorithm.gp                    a child (one Option of a Decision)
 *   decisions.algorithm.options.gp            … the explicit long form
 *   findings.sig.fig1                         a child (one Evidence of a Finding)
 *   reconstruction.outputs.xi                 a sub-analysis (the `analyses.` is implied)
 *   analyses.reconstruction.outputs.xi        … the explicit long form
 *   reconstruction                            the sub-analysis itself
 *   outputs                                   a whole collection (a registry)
 *
 * `parseAstraPath` turns the string into a structured {@link AstraPath}. One
 * grammar drives every surface: the `{astra}` role, the `{astra}` directive,
 * and the `{astra:*}` variants.
 */

/** The top-level ASTRA collections — exactly the keys of `astra.yaml`. */
export type Collection =
  | 'inputs'
  | 'outputs'
  | 'decisions'
  | 'findings'
  | 'prior_insights'
  | 'analyses'
  | 'universes';

/** Child collections that live *inside* an element. */
export type ChildCollection = 'options' | 'evidence';

const COLLECTIONS = new Set<string>([
  'inputs',
  'outputs',
  'decisions',
  'findings',
  'prior_insights',
  'analyses',
  'universes',
]);

const CHILD_COLLECTIONS = new Set<string>(['options', 'evidence']);

/**
 * The single child collection each element kind carries — what a bare segment
 * after `<collection>.<id>` addresses (`decisions.d.gp` ≡ `decisions.d.options.gp`).
 * Each kind has exactly one child collection, so the short form is unambiguous;
 * the explicit keyword stays accepted as the long form.
 */
const CHILD_BY_COLLECTION: Partial<Record<Collection, ChildCollection>> = {
  decisions: 'options',
  findings: 'evidence',
  prior_insights: 'evidence',
};

/** Map a collection to the singular `<kind>` used in mdast identifiers + classes. */
export const KIND_BY_COLLECTION: Record<Collection, string> = {
  inputs: 'input',
  outputs: 'output',
  decisions: 'decision',
  findings: 'finding',
  prior_insights: 'prior_insight',
  analyses: 'analysis',
  universes: 'universe',
};

/** Accept the hyphenated alias `prior-insights` for the YAML key `prior_insights`. */
function canonicalCollection(seg: string): Collection | null {
  const s = seg === 'prior-insights' ? 'prior_insights' : seg;
  return COLLECTIONS.has(s) ? (s as Collection) : null;
}

export interface AstraPath {
  /** Sub-analysis ids walked into (the analysis path), innermost last. */
  scope: string[];
  /** The target collection; `null` only for an empty path. */
  collection: Collection | null;
  /** The element id; `null` when the path stops at a collection (a registry). */
  id: string | null;
  /** A child target inside the element (an option or an evidence record). */
  child: { collection: ChildCollection; id: string } | null;
}

/**
 * Canonical record path used by `project-view-model.v1`.
 *
 * Root records begin at their collection (`outputs.figure`); records in a
 * child analysis include the analysis path (`reconstruction.outputs.xi`).
 * Analysis and universe paths are navigation/configuration targets rather
 * than records in the canonical model, so they intentionally return null.
 * Child option/evidence references resolve to their owning record.
 */
export function canonicalRecordPath(path: AstraPath): string | null {
  if (
    !path.collection ||
    !path.id ||
    path.collection === 'analyses' ||
    path.collection === 'universes'
  ) {
    return null;
  }
  return [...path.scope, path.collection, path.id].join('.');
}

/**
 * Split a role/directive body into its display-text override and the path,
 * following MyST's `text <target>` convention (as used by `{ref}`):
 *
 *   "our preferred method <decisions.algorithm>"  → { display: "our preferred method", path: "decisions.algorithm" }
 *   "outputs.hubble_diagram"                       → { display: null, path: "outputs.hubble_diagram" }
 */
export function splitDisplay(body: string): { display: string | null; path: string } {
  const m = /^(.*?)<([^>]*)>\s*$/.exec(body ?? '');
  if (m) return { display: m[1].trim() || null, path: m[2].trim() };
  return { display: null, path: (body ?? '').trim() };
}

/**
 * Parse a path string into a structured {@link AstraPath}.
 *
 * The dotted body is read left-to-right: each segment is either a *collection
 * keyword* (which begins the target) or a *sub-analysis step* (the `analyses.`
 * shorthand). The first non-`analyses` collection keyword fixes the target;
 * everything before it is scope. A leading `/` is tolerated (paths always
 * resolve from the root analysis).
 *
 * The parse is purely syntactic — it never checks the element exists. Callers
 * resolve {@link AstraPath} against a loaded analysis and report missing ids.
 */
export function parseAstraPath(raw: string): AstraPath {
  const segs = (raw ?? '')
    .trim()
    .replace(/^\//, '')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);

  const scope: string[] = [];
  let collection: Collection | null = null;
  let id: string | null = null;
  let child: AstraPath['child'] = null;

  let i = 0;
  while (i < segs.length) {
    const seg = segs[i];
    const col = canonicalCollection(seg);

    if (col === 'analyses') {
      // `analyses.<sub>` is a scope step (the sub becomes the target only when
      // it's the final segment); a trailing bare `analyses` is the registry.
      if (i + 1 < segs.length) {
        scope.push(segs[i + 1]);
        i += 2;
        continue;
      }
      collection = 'analyses';
      break;
    }

    if (col) {
      collection = col;
      i++;
      if (i < segs.length) {
        id = segs[i];
        i++;
      }
      if (i < segs.length) {
        if (CHILD_COLLECTIONS.has(segs[i])) {
          // Explicit long form: `…options.<id>` / `…evidence.<id>`.
          const cc = segs[i] as ChildCollection;
          const cid = segs[i + 1];
          if (cid) child = { collection: cc, id: cid };
        } else {
          // Short form: the child collection is implied by the parent kind.
          const implied = CHILD_BY_COLLECTION[collection];
          if (implied) child = { collection: implied, id: segs[i] };
        }
      }
      break;
    }

    // Not a collection keyword → a sub-analysis step (the `analyses.` shorthand).
    scope.push(seg);
    i++;
  }

  // A path that ends on a bare sub-analysis step targets that sub-analysis:
  // normalize to the explicit `analyses.<id>` form so every consumer sees one
  // shape instead of special-casing `collection: null`.
  if (!collection && scope.length > 0) {
    collection = 'analyses';
    id = scope.pop()!;
  }

  return { scope, collection, id, child };
}

/**
 * The in-page mdast identifier a path resolves to (`<kind>-<id>`), or `null`
 * when the path has no single anchorable element (a registry, or a
 * sub-analysis, which is a separate page). Children collapse to their parent
 * element's identifier: an option → its decision, an evidence → its
 * finding/insight, matching where the rendered anchor actually lives.
 */
export function pathIdentifier(p: AstraPath): string | null {
  if (!p.collection || !p.id || p.collection === 'analyses') return null;
  return `${KIND_BY_COLLECTION[p.collection]}-${p.id}`;
}

/**
 * The dotted scope key (`reconstruction.xi`) used as the resolved-store join
 * key and the cross-scope merge prefix. Since authoring is dot-based too, this
 * is simply the collection-elided form of an element's path.
 */
export function dottedKey(scope: string[], id: string): string {
  return [...scope, id].join('.');
}
