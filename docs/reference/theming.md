# Theme integration

MySTRA emits readable MyST fallback nodes and a versioned publication payload.
A rich theme can replace a recognized carrier with shared ASTRA UI, retaining the
fallback when it cannot decode the publication or resolve a record.

## Record identity

Placed blocks carry an `astra-<kind>` class and `data.astra`:

```ts
{
  kind: 'output',
  id: 'fit',
  canonicalPath: 'stage.outputs.fit', // the SDK element ref
  universe: 'universes.baseline',    // optional context for this placement
}
```

`canonicalPath` is an SDK ref, independent of a MyST label or HTML identifier.
An option uses its decision's ref and its option `id`. Evidence uses its insight's
ref and `evidenceIndex`, the zero-based index in the insight's evidence array.
Analysis cards and navigation references use `analysisPath`, the SDK analysis key;
the root key is `""`. Analysis keys and element refs are distinct lookup domains.

Inline references use `astra-ref` and `astra-ref--<kind>` classes. Values also
carry their output/decision ref, selected universe and display metadata (`type`,
`col`, `filter`, `unit`, or decision `selection` as applicable). The neutral label
is in the node's children. Keep those children when a rich lookup fails.

The block classes are `astra-decision`, `astra-output`, `astra-input`,
`astra-finding`, `astra-prior-insight`, `astra-option`, `astra-subanalysis`, and
`astra-outputs` for the output registry. Output classes also include
`astra-output--<type>`. Custom `:label:` and `:class:` options do not change SDK
identity. Finding and decision tags remain in `node.data.tags`.

## Publication transport v2

Every successfully transformed page receives a hidden
`div.astra-publication-bundle` with `node.data.astraPublication`:

```ts
interface AstraPublicationData {
  schemaVersion: 'astra-publication-bundle.v2';
  activeAnalysisKey: string;
  universe?: string;
  analysis: ResolvedAnalysis;
  status: StatusReport;
  resources: Readonly<Record<string, { cacheToken: string }>>;
}
```

`analysis` and `status` are the unchanged SDK reports, with their own
`schema_version` markers. They contain the complete declaration graph and all
planned results across universes. `activeAnalysisKey` and `universe` are page
presentation context. A placement's `data.astra.universe` overrides the page's
universe. No re-resolution is needed when a browser switches universes.

Use the SDK's public decoders and index:

```ts
import {
  parseResolvedAnalysis,
  parseStatusReport,
  indexResolvedAnalysis,
  selectResult,
} from '@astra-spec/sdk/reports';

const analysis = parseResolvedAnalysis(candidate.analysis);
const status = parseStatusReport(candidate.status);
const index = indexResolvedAnalysis(analysis);
const active = index.analysisByKey.get(candidate.activeAnalysisKey);
const result = candidate.universe
  ? selectResult(index, output.ref, candidate.universe)
  : undefined;
const provenance = result ? status.statuses[result.id] : undefined;
```

Validate the outer version, string context fields and resource metadata before
using this data. Check the active key and universe exist in the index. Do not
accept pre-v2 payloads as though they matched the new report model.

Analyses form a graph: use the SDK's cycle-safe graph walkers and indexes rather
than recursive tree assumptions. A varying result belongs to the analysis owning
its universe, which can differ from the output's declaring analysis. Use the
SDK's result selectors to apply that relationship.

## Browser asset URLs

The envelope's `resources` is keyed by opaque `Result.id`, not output ref. A
result ID can identify a particular universe or pinned result. Its `cacheToken`
is the SHA-256 of the actual bytes read by the native SDK.

MySTRA separately emits hidden `div.astra-publication-resources` links:

```ts
{
  type: 'link',
  static: true,
  url: '<source-page-relative immutable resource path>',
  data: { astraArtifact: { resultId: string, cacheToken: string } },
  children: [{ type: 'text', value: '<result ID>' }],
}
```

MyST copies these resources into the site and rewrites the URLs. Accept a URL
only when the result ID is known and its token matches `resources[resultId]`.
The report's `Place.file_path` describes a repository or commit tree and is not
a browser URL. Never construct an asset URL from it.

The plugin reads actual content with the SDK's `readResults`, trying the result's
places until bytes are available. It publishes immutable, content-hashed files
under `_build/astra-resources/`. This handles historical commit trees and
large-file stand-ins without reading the wrong worktree file.

Resource availability and provenance are independent. A file without a record
can be published even while its status is `missing` and its recorded-byte state
is `absent`. Use the verified resource map for display availability and the status
report for provenance indicators.

## Evidence and citations

Evidence identity is an insight ref plus array index. `Evidence.cites` contains
its effective result IDs and can be empty when no result is planned. Its
`artifact` field retains the authored address even then. All citations in the
public report are retained; the report does not expose enough switch information
for a general per-universe evidence filter.

MySTRA registers literature DOIs with MyST in a hidden `astra-cites` carrier for
both narrative and parenthetical citations. The host's citation/reference data
provides bibliography labels and paper URLs; the SDK does not fetch papers.

## Fallbacks

A theme should decode once per document, keep its index and verified asset map in
context, and override only recognized carriers. On a missing record or malformed
transport, render the original children. Pure MyST output remains usable without
ASTRA theme code or a Python service.
