/**
 * The unified ASTRA reference path grammar.
 *
 * A *path* is a slash-separated route through the analysis tree — the same
 * structure as `astra.yaml`:
 *
 *   outputs/hubble_diagram                    an output in the current scope
 *   decisions/algorithm/options/gp            a child (one Option of a Decision)
 *   findings/sig/evidence/fig1                a child (one Evidence of a Finding)
 *   reconstruction/outputs/xi                 a sub-analysis (the `analyses/` is implied)
 *   analyses/reconstruction/outputs/xi        … the explicit long form
 *   reconstruction                            the sub-analysis itself
 *   outputs                                   a whole collection (a registry)
 *   /decisions/method                         absolute, from the root analysis
 *   ../outputs/xi                             the parent scope
 *
 * `parseAstraPath` turns the string into a structured {@link AstraPath}. One
 * grammar drives every surface: the `{astra}` role, the `{astra}` directive, the
 * `{astra:*}` variants, and the `#astra:<path>` cross-reference scheme.
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
  /** The trimmed source string (scheme + display already stripped). */
  raw: string;
  /** A leading `/` — resolve from the root analysis rather than the current scope. */
  absolute: boolean;
  /** Count of leading `../` — scopes to climb from the current scope. */
  up: number;
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
 *   "our preferred method <decisions/algorithm>"  → { display: "our preferred method", path: "decisions/algorithm" }
 *   "outputs/hubble_diagram"                       → { display: null, path: "outputs/hubble_diagram" }
 */
export function splitDisplay(body: string): { display: string | null; path: string } {
  const m = /^(.*?)<([^>]*)>\s*$/.exec(body ?? '');
  if (m) return { display: m[1].trim() || null, path: m[2].trim() };
  return { display: null, path: (body ?? '').trim() };
}

/**
 * Parse a path string into a structured {@link AstraPath}.
 *
 * Resolution is left-to-right: leading `/` and `../` are consumed first, then
 * each segment is either a *collection keyword* (which begins the target) or a
 * *sub-analysis step* (the `analyses/` shorthand). The first non-`analyses`
 * collection keyword fixes the target; everything before it is scope.
 *
 * The parse is purely syntactic — it never checks the element exists. Callers
 * resolve {@link AstraPath} against a loaded analysis and report missing ids.
 */
export function parseAstraPath(raw: string): AstraPath {
  const trimmed = (raw ?? '').trim();
  const absolute = trimmed.startsWith('/');
  const segs = trimmed
    .replace(/^\//, '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  let up = 0;
  while (segs[0] === '..') {
    up++;
    segs.shift();
  }

  const scope: string[] = [];
  let collection: Collection | null = null;
  let id: string | null = null;
  let child: AstraPath['child'] = null;

  let i = 0;
  while (i < segs.length) {
    const seg = segs[i];
    const col = canonicalCollection(seg);

    if (col === 'analyses') {
      // `analyses` as the final segment is the sub-analyses registry.
      if (i === segs.length - 1) {
        collection = 'analyses';
        break;
      }
      // `analyses/<sub>` as the final pair targets that sub-analysis itself;
      // otherwise it's a scope step and parsing continues inside the sub.
      const sub = segs[i + 1];
      scope.push(sub);
      i += 2;
      continue;
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

    // Not a collection keyword → a sub-analysis step (the `analyses/` shorthand).
    scope.push(seg);
    i++;
  }

  return { raw: trimmed, absolute, up, scope, collection, id, child };
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
 * The dotted scope key (`reconstruction.xi`) used internally as the resolved-store
 * join key and the cross-scope merge prefix. Authoring is slash-based; the store
 * stays dotted, so this is the single conversion point.
 */
export function dottedKey(scope: string[], id: string): string {
  return [...scope, id].join('.');
}
