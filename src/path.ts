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
 *   decisions.algorithm.options.gp            a child (one Option of a Decision)
 *   findings.sig.evidence.fig1                a child (one Evidence of a Finding)
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
  /** The target collection, or `null` when the target is a bare sub-analysis. */
  collection: Collection | null;
  /** The element id; `null` when the path stops at a collection (a registry). */
  id: string | null;
  /** A child target inside the element (an option or an evidence record). */
  child: { collection: ChildCollection; id: string } | null;
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
      if (i < segs.length && CHILD_COLLECTIONS.has(segs[i])) {
        const cc = segs[i] as ChildCollection;
        const cid = segs[i + 1];
        if (cid) child = { collection: cc, id: cid };
      }
      break;
    }

    // Not a collection keyword → a sub-analysis step (the `analyses.` shorthand).
    scope.push(seg);
    i++;
  }

  return { scope, collection, id, child };
}

/**
 * The in-page mdast identifier a path resolves to (`<kind>-<id>`), or `null`
 * when the path has no single anchorable element (a registry, or a bare
 * sub-analysis, which is a separate page). Children collapse to their parent
 * element's identifier: an option → its decision, an evidence → its
 * finding/insight, matching where the rendered anchor actually lives.
 */
export function pathIdentifier(p: AstraPath): string | null {
  if (!p.collection || !p.id) return null;
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
