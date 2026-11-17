/**
 * The publication contract between MySTRA and the themes that render its
 * output: what MySTRA embeds in a MyST page beyond the SDK's own reports, and
 * the decoder a theme uses to read it back.
 *
 * Everything else is an SDK type: the payload carries the resolved analysis and
 * status report unchanged. MySTRA adds only
 * - page context (the analysis a page documents and its universe),
 * - result bytes routed through MyST's asset pipeline (`static` links whose URLs
 *   MyST rewrites at build time, joined back to result IDs here), and
 * - placement identity on the nodes that place an SDK element in the page.
 *
 * This module depends on `@astra-spec/sdk/reports` only, so a theme can import
 * it without MyST's build-time packages.
 */
import {
  indexResolvedAnalysis,
  parseResolvedAnalysis,
  parseStatusReport,
  type Analysis,
  type ResolvedAnalysis,
  type ResolvedAnalysisIndex,
  type StatusReport,
} from '@astra-spec/sdk/reports';

export const ASTRA_PUBLICATION_SCHEMA_VERSION =
  'astra-publication-bundle.v2' as const;

/** Class of the hidden `div` whose `data.astraPublication` is the payload. */
export const ASTRA_PUBLICATION_CLASS = 'astra-publication-bundle';
/** Class of the hidden `div` of `static` resource links that immediately follows it. */
export const ASTRA_RESOURCES_CLASS = 'astra-publication-resources';

/** The versioned payload carried by the publication carrier. */
export interface AstraPublicationData {
  schemaVersion: typeof ASTRA_PUBLICATION_SCHEMA_VERSION;
  /** The analysis this page documents; the root's key is `""`. */
  activeAnalysisKey: string;
  /** The universe the page's values are evaluated in. */
  universe?: string;
  analysis: ResolvedAnalysis;
  status: StatusReport;
  /** Result IDs whose bytes the page carries, with a token tying each to its link. */
  resources: Readonly<Record<string, { cacheToken: string }>>;
}

/** `data.astraArtifact` on a resource link: the result its rewritten URL serves. */
export interface AstraArtifactData {
  resultId: string;
  cacheToken: string;
}

/** `data.astra` on a node that places an SDK element (or an analysis) in the page. */
export interface AstraNodeIdentity {
  /** The presentation surface represented by this node. */
  kind: string;
  /** Local authored id (a child id for option/evidence surfaces). */
  id: string;
  /** SDK element ref. Never used for analysis navigation targets. */
  ref?: string;
  /** SDK analysis key (`""` for root). Never used as an element ref. */
  analysisKey?: string;
  /** Host-provided route for an analysis page, when one is configured. */
  href?: string;
  /** Zero-based index into the owning insight evidence array. */
  evidenceIndex?: number;
  /** Explicit universe context for this authored reference. */
  universe?: string;
}

/** Extra `data.astra` fields on an inline value (`{astra:value}`) node. */
export interface AstraValueData {
  /** `decision`, `metric`, or the output type of a table cell. */
  type?: string;
  /** The selected option of a decision value. */
  selection?: string;
  /** The table column a cell value reads. */
  col?: string;
  /** The row filter of a table cell value. */
  filter?: string;
  /** The label of the output a value comes from. */
  product?: string;
  /** A metric's unit. */
  unit?: string;
}

/** Everything a placed node's `data.astra` may carry. */
export type AstraNodeData = AstraNodeIdentity & AstraValueData;

/** A decoded, indexed publication, ready for a theme to render. */
export interface AstraPublication {
  document: ResolvedAnalysis;
  status: StatusReport;
  index: ResolvedAnalysisIndex;
  activeAnalysis: Analysis;
  universe?: string;
  resources: Readonly<Record<string, { cacheToken: string }>>;
  /** MyST-rewritten artifact URLs keyed by result ID, including its universe. */
  artifactUrls: ReadonlyMap<string, string>;
  /** HTML anchors that are actually present in this page's rendered AST. */
  placedIdentifiers: ReadonlySet<string>;
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function hasClass(node: UnknownRecord, className: string): boolean {
  const value = node.class;
  if (typeof value === 'string') {
    return value.split(/\s+/).includes(className);
  }
  return Array.isArray(value) && value.some((item) => item === className);
}

/**
 * Accept only browser-safe site-relative and explicit HTTP(S) resource URLs.
 * In particular, URL parsing against the sentinel rejects protocol-relative
 * (including backslash-spelled) cross-origin targets.
 */
function safeArtifactUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }
  const url = value.trim();
  if (!url || /^[\\/]{2}/.test(url)) return undefined;

  const base = new URL('https://astra-publication.invalid/');
  try {
    const parsed = new URL(url, base);
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(url);
    if (hasScheme) {
      return /^https?:\/\//i.test(url) &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        ? url
        : undefined;
    }
    return parsed.origin === base.origin ? url : undefined;
  } catch {
    return undefined;
  }
}

function artifactUrls(
  resourceCarrier: unknown,
  resources: Readonly<Record<string, { cacheToken: string }>>,
): ReadonlyMap<string, string> {
  const carrier = object(resourceCarrier);
  if (
    !carrier ||
    carrier.type !== 'div' ||
    !hasClass(carrier, ASTRA_RESOURCES_CLASS) ||
    !Array.isArray(carrier.children)
  )
    return new Map();

  const urls = new Map<string, string>();
  for (const value of carrier.children) {
    const link = object(value);
    const identity = object(object(link?.data)?.astraArtifact);
    if (
      !link ||
      link.type !== 'link' ||
      link.static !== true ||
      !identity ||
      typeof identity.resultId !== 'string' ||
      typeof identity.cacheToken !== 'string' ||
      !Object.prototype.hasOwnProperty.call(resources, identity.resultId)
    )
      continue;

    const resource = resources[identity.resultId];
    const url = safeArtifactUrl(link.url);
    if (
      !resource ||
      resource.cacheToken !== identity.cacheToken ||
      !url ||
      urls.has(identity.resultId)
    )
      continue;
    urls.set(identity.resultId, url);
  }
  return urls;
}

function decodeCarrier(
  value: unknown,
  resourceSibling: unknown,
  placedIdentifiers: ReadonlySet<string>,
): AstraPublication | undefined {
  const node = object(value);
  const data = object(node?.data);
  const envelope = object(data?.astraPublication);
  if (
    !node ||
    node.type !== 'div' ||
    !hasClass(node, ASTRA_PUBLICATION_CLASS) ||
    !envelope ||
    envelope.schemaVersion !== ASTRA_PUBLICATION_SCHEMA_VERSION ||
    typeof envelope.activeAnalysisKey !== 'string' ||
    (envelope.universe !== undefined && typeof envelope.universe !== 'string')
  ) {
    return undefined;
  }

  try {
    const document = parseResolvedAnalysis(envelope.analysis);
    const status = parseStatusReport(envelope.status);
    const index = indexResolvedAnalysis(document);
    const activeAnalysis = index.analysisByKey.get(envelope.activeAnalysisKey);
    if (!activeAnalysis) return undefined;
    const universe = envelope.universe;
    if (
      universe !== undefined &&
      index.elementByRef.get(universe)?.collection !== 'universes'
    )
      return undefined;
    const candidateResources = object(envelope.resources);
    if (!candidateResources) return undefined;
    const resources: Record<string, { cacheToken: string }> =
      Object.create(null);
    for (const [id, candidate] of Object.entries(candidateResources)) {
      const resource = object(candidate);
      if (
        !index.resultById.has(id) ||
        !resource ||
        typeof resource.cacheToken !== 'string' ||
        !resource.cacheToken
      )
        return undefined;
      resources[id] = { cacheToken: resource.cacheToken };
    }
    return {
      document,
      status,
      index,
      activeAnalysis,
      ...(universe === undefined ? {} : { universe }),
      resources,
      artifactUrls: artifactUrls(resourceSibling, resources),
      placedIdentifiers,
    };
  } catch {
    return undefined;
  }
}

interface TraversalFrame {
  siblings: unknown[];
  index: number;
}

/** Collect the identifiers that MyST will materialize as page anchors. */
function collectPlacedIdentifiers(roots: unknown[]): ReadonlySet<string> {
  const identifiers = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const node = object(pending.pop());
    if (!node) continue;

    const identifier =
      typeof node.html_id === 'string' && node.html_id.trim()
        ? node.html_id
        : typeof node.identifier === 'string' && node.identifier.trim()
          ? node.identifier
          : undefined;
    if (identifier) identifiers.add(identifier);
    if (Array.isArray(node.children)) pending.push(...node.children);
  }

  return identifiers;
}

/**
 * Find MySTRA's first valid publication carrier in document order. Traversal
 * retains each node's original sibling array so only an immediately following
 * resource carrier can contribute URLs. Invalid candidates fail locally and
 * leave the neutral MyST publication untouched.
 */
export function findAstraPublication(
  mdast: unknown,
): AstraPublication | undefined {
  if (!mdast) return undefined;

  const roots: unknown[] = Array.isArray(mdast) ? mdast : [mdast];
  const placedIdentifiers = collectPlacedIdentifiers(roots);
  const frames: TraversalFrame[] = [{ siblings: roots, index: 0 }];

  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    if (frame.index >= frame.siblings.length) {
      frames.pop();
      continue;
    }

    const index = frame.index;
    frame.index += 1;
    const value = frame.siblings[index];
    const publication = decodeCarrier(
      value,
      frame.siblings[index + 1],
      placedIdentifiers,
    );
    if (publication) return publication;

    const node = object(value);
    if (Array.isArray(node?.children)) {
      frames.push({ siblings: node.children, index: 0 });
    }
  }

  return undefined;
}

/**
 * A node's `data.astra`, untrusted: every field is still `unknown`, keyed by
 * the contract's names so a theme validates exactly what MySTRA writes.
 */
export type AstraNodeMetadata = { readonly [K in keyof AstraNodeData]?: unknown } & Readonly<UnknownRecord>;

/** Read a node's placement metadata, or undefined when it carries none. */
export function astraNodeMetadata(node: unknown): AstraNodeMetadata | undefined {
  return object(object(object(node)?.data)?.astra);
}
