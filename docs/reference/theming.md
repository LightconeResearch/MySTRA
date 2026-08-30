# Theming — for theme authors

This page is the consumer contract between MySTRA and a rich MyST theme. Report
authors do not need it: MySTRA emits readable, neutral MyST nodes that work with
the stock themes. A dedicated theme may add kind styling, hover/focus previews,
record dialogs, artifact previews, and provenance navigation without reopening
or re-resolving the ASTRA project.

The integration has two layers:

1. visible MyST nodes carry small recognition markers and canonical identity;
2. a hidden, versioned carrier contains the resolved SDK bundle and rewritten
   artifact resources used to enrich those nodes.

## Recognition markers

MySTRA exposes recognition classes for placed presentation surfaces and
`data.astra` metadata for joinable identities. These signals overlap but are
not identical. They are MyST AST `node.class` and `node.data.astra` fields, not
browser DOM `className` or `dataset` values. Match class tokens in either a
string or string-array representation; an author's `:class:` option may add
more tokens. The stable class markers are:

| Class | Element |
|---|---|
| `astra-decision` | A decision block |
| `astra-output`, plus `astra-output--figure` / `--table` / `--metric` / `--data` / `--report` | An output block, subtyped |
| `astra-finding` | A finding block |
| `astra-prior-insight` | A prior-insight admonition |
| `astra-input` / `astra-inputs` / `astra-outputs` | Single-input table / registries |
| `astra-option` | An option heading |
| `astra-subanalysis` | A sub-analysis summary card |

An individual record block carries identity on its carrier. Registry tables
carry their recognition class on the table and record identity on each row,
not on the registry as a whole. An individually placed evidence surface carries
owner identity on its first rendered node but has no dedicated stable block
class. An author's `:label:` may replace a fallback MyST identifier, but it
never changes any ASTRA identity.

Inline tokens are neutral spans carrying `astra-ref` and
`astra-ref--<kind>` classes. The possible kinds are `decision`, `output`,
`finding`, `prior_insight`, `analysis`, `input`, `option`, `evidence`, and
`value`.

### Record identity

Record references, placed record blocks, and input/output registry rows carry:

```ts
{
  kind: 'input' | 'output' | 'decision' | 'finding' | 'prior_insight';
  id: string;
  canonicalPath: string;
}
```

`canonicalPath` is the stable lookup key from `@astra-spec/sdk`. Always use it
instead of deriving an ASTRA id from a MyST `identifier` or an author's label.
Option and evidence surfaces carry the child identity and point back to their
owning record:

```ts
{
  kind: 'option' | 'evidence';
  id: string;              // child id
  canonicalPath: string;   // owning decision or insight record
}
```

### Analysis identity

Analysis navigation uses the analysis index rather than the record index:

```ts
{
  kind: 'analysis';
  id: string;
  analysisPath: string; // '$' identifies the root analysis
  href?: string;
}
```

An analysis identity in `data.astra` never uses the `canonicalPath` field;
`analysisPath` joins it to the SDK's analysis index. An inline analysis
reference has `href` only when exactly one concrete page in `project.toc` maps
to that analysis through its filename or `astra_scope`. An unlisted, invalid,
ambiguous, or pattern-expanded mapping omits `href`; themes must not invent a
route from `analysisPath`. Placed sub-analysis cards carry `analysisPath` but
leave navigation to the host.

### Value identity

Value tokens retain the owning record's `canonicalPath` and add the context
needed to explain the displayed value:

```ts
// Selected decision option
{
  kind: 'value'; id: string; canonicalPath: string;
  type: 'decision'; selection?: string;
}

// Selected table cell
{
  kind: 'value'; id: string; canonicalPath: string;
  type: OutputType; product?: string; col: string; filter?: string;
}

// Parsed scalar metric
{
  kind: 'value'; id: string; canonicalPath: string;
  type: 'metric'; product?: string; unit?: string;
}
```

Optional strings are omitted when unavailable. `filter` is the normalized
`key=value, …` selection used to choose a row. A theme should treat the visible
MyST children as the authoritative formatted value and use this metadata only
for context and record lookup.

## Publication transport

MySTRA resolves the complete project once through `@astra-spec/sdk` and, on
each successfully resolved page, adds the canonical `ResolvedAnalysisBundle`.
The data lives on a hidden `div.astra-publication-bundle` node:

```ts
interface AstraPublicationData {
  schemaVersion: 'astra-publication-bundle.v1';
  activeAnalysisPath: string; // '$' identifies the root analysis
  bundle: ResolvedAnalysisBundle;
}
```

The value is stored at `node.data.astraPublication`. The transport version and
the SDK document version are intentionally separate: the former versions the
MySTRA-to-theme envelope, while the latter versions the resolved ASTRA data.
`activeAnalysisPath` is presentation context for the current page; `bundle`
always contains the whole resolved project.

Treat carrier data as unknown at a JSON or server boundary. Validate the
envelope, use the SDK's runtime decoder for the bundle, and only then build the
derived indexes:

```ts
import {
  indexAnalysis,
  parseResolvedAnalysisBundle,
} from '@astra-spec/sdk';

const TRANSPORT_VERSION = 'astra-publication-bundle.v1';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function decodePublication(value: unknown) {
  const candidate = object(value);
  if (
    !candidate ||
    candidate.schemaVersion !== TRANSPORT_VERSION ||
    typeof candidate.activeAnalysisPath !== 'string'
  ) return undefined;

  try {
    const bundle = parseResolvedAnalysisBundle(candidate.bundle);
    const index = indexAnalysis(bundle.document);
    if (!index.analysisByPath.has(candidate.activeAnalysisPath)) {
      return undefined;
    }
    return {
      bundle,
      index,
      activeAnalysisPath: candidate.activeAnalysisPath,
    };
  } catch {
    return undefined;
  }
}
```

The decoder validates already-deserialized transport data; it does not read
files or repeat project resolution. A server receiving JSON should call
`JSON.parse` first and pass the result to the decoder.

## Discovering the carriers

Carriers may be inside any MyST subtree, so traverse child arrays rather than
assuming the publication carrier is a direct root child. Preserve sibling
relationships while traversing:

1. find a `div` whose class list contains `astra-publication-bundle`;
2. read and decode its `data.astraPublication` value;
3. if the immediately following sibling is
   `div.astra-publication-resources`, consume its resource links;
4. continue looking if the candidate is malformed or its active analysis does
   not exist.

This is the approach used by `astra-theme`: an invalid or unsupported carrier
does not break the page; the theme simply leaves the neutral MyST rendering in
place.

## Rejoining artifact URLs

SDK bindings contain canonical project-relative artifact paths, not the final
browser URL. MySTRA therefore emits an optional sibling
`div.astra-publication-resources`. Each child is a MyST `link` node with:

```ts
{
  type: 'link';
  static: true;
  url: string; // rewritten by MyST's asset pipeline
  data: {
    astraArtifact: {
      outputPath: string;
      cacheToken: string;
    };
  };
}
```

Build a map of SDK bindings by `outputPath`. Accept a rewritten URL only when
both `outputPath` and the opaque `cacheToken` match the corresponding binding.
Use the rewritten `link.url` for an image, fetch, or download; retain
`binding.path` only as project metadata. Missing, stale, or mismatched links
must render as an unavailable artifact rather than falling back to a guessed
path.

If a URL can become an `href`, `src`, or fetch target, accept site-relative
URLs or explicit HTTP(S) URLs and reject active schemes, control characters,
and protocol-relative URLs.

## Looking up records and analyses

Once the bundle is decoded and indexed, renderer joins are direct:

```ts
const active = index.analysisByPath.get(activeAnalysisPath);
const metadata = node.data?.astra;
const canonicalPath = typeof metadata?.canonicalPath === 'string'
  ? metadata.canonicalPath
  : undefined;
const record = canonicalPath
  ? index.recordByPath.get(canonicalPath)
  : undefined;
const owner = canonicalPath
  ? index.analysisByRecordPath.get(canonicalPath)
  : undefined;
const analysis = typeof metadata?.analysisPath === 'string'
  ? index.analysisByPath.get(metadata.analysisPath)
  : undefined;
```

Check the metadata shape before each lookup and preserve the original MyST
children when a lookup fails. The decoded document carries universe metadata;
its records carry the resulting activity and selected-option state plus alias,
provenance, and evidence relationships. The index adds canonical record,
analysis, and ownership lookups. A theme should not reconstruct any of them.

## Building a React/MyST theme

The current `astra-theme` integration is deliberately narrow and is a useful
template for another theme server:

1. wrap the rendered article surface in a publication provider that discovers
   and decodes the page carrier;
2. keep the decoded bundle, SDK index, active analysis, and artifact-resource
   map in that provider;
3. add renderer overrides only for ASTRA nodes that need interaction, while
   delegating their visible children to the normal MyST renderers;
4. resolve an inline trigger through `canonicalPath`, show a compact
   hover/focus preview, and open the full record dialog on click;
5. reset open detail state when the publication object changes during client
   navigation.

`@astra-spec/ui` supplies positioning-agnostic `RecordPreview` content,
`RecordDialog` detail surfaces, the `PreviewPopover` interaction primitive, and
detail-stack state. A host remains responsible for MyST citation rendering,
artifact loading, route navigation, portal colour-scheme/brand scope, and the
callback that opens a canonical record. This keeps the UI package usable by
non-MyST applications and keeps a theme server free of ASTRA source/project
parsing and resolution logic.

For upstream maintainability, block carriers can remain entirely on the stock
MyST renderer: the neutral block already contains the figure, table, decision,
finding, or summary content. The theme may add a small wrapper or provenance
affordance without replacing that content. Inline ASTRA spans are the primary
renderer seam for previews and record dialogs.

## Citation registration

When the resolved project cites literature, MySTRA emits
`div.astra-cites` containing one narrative and one parenthetical hidden MyST
`cite` node per unique normalized DOI. Keep this carrier in the complete tree
while MyST runs citation resolution so those sources reach its bibliography
pipeline. Read evidence and DOI relationships from the SDK bundle, then use the
host's normal MyST citation renderer for formatted author–year content; do not
maintain a second bibliography implementation in the theme.

## Failure behaviour

A theme server should degrade locally and preserve the publication:

- unsupported transport or SDK schema: render the neutral MyST page;
- missing `canonicalPath` or failed lookup: keep the original node children;
- missing or stale artifact resource: show an unavailable preview;
- absent analysis `href`: show a preview or label without invented navigation;
- dialog or preview state during page navigation: close or reset it.

No browser-side filesystem access, `astra.yaml` parsing, project resolution, or
parallel provenance model is required. All semantic information comes from the
decoded SDK bundle; all browser artifact URLs come from MyST-rewritten resource
links.

## Anchors

Rendered elements retain local fallback identifiers for ordinary MyST
rendering. Authors who need a project-wide cross-reference should set the
directive's explicit `:label:` and use MyST's standard `{ref}` role. A theme
must not treat an author-controlled label as an ASTRA identity or invent a
globally unique anchor from an unscoped record id.
