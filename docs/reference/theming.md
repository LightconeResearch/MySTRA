# Theming — for theme authors

This page documents the contract between MySTRA and a rich MyST theme. Report authors never need it: on the stock `book-theme` everything renders cleanly with no CSS. A dedicated theme uses the markers and data below to add kind glyphs, per-kind colours, record dialogs, and richer patterns.

## Recognition markers

Every placed record block carries a stable `astra-<kind>` class and `data.astra` identity on its carrier. An author's directive `:label:` may replace the fallback MyST identifier, but it never changes the ASTRA identity:

| Class | Element |
|---|---|
| `astra-decision` | A decision block |
| `astra-output`, plus `astra-output--figure` / `--table` / `--metric` / … | An output block, subtyped |
| `astra-finding` | A finding block |
| `astra-prior-insight` | A prior-insight admonition |
| `astra-input` / `astra-inputs` / `astra-outputs` | Single-input table / registries |
| `astra-option` | An option heading |
| `astra-subanalysis` | A sub-analysis summary card |

Inline tokens are neutral spans: `span.astra-ref--<kind>` (`decision`, `output`, `finding`, `prior_insight`, `analysis`, `input`, `option`, `evidence`, `value`). Record references and placed record blocks carry:

```ts
{
  kind: 'input' | 'output' | 'decision' | 'finding' | 'prior_insight';
  id: string;
  canonicalPath: string;
}
```

`canonicalPath` is the stable record lookup key from `@astra-spec/sdk`. Option and evidence surfaces keep their own `kind` and child `id`, but their `canonicalPath` is the owning decision/finding/prior-insight record. Input/output registry rows carry the same record identity.

Analysis navigation is deliberately a separate shape:

```ts
{
  kind: 'analysis';
  id: string;
  analysisPath: '$' | string;
  href?: string;
}
```

Analysis nodes never carry `canonicalPath`, because SDK record indexes and analysis indexes are separate. A `{astra}` analysis reference receives `href` only when exactly one concrete page in the explicit `project.toc` maps to that analysis through its filename or `astra_scope`; an unlisted, invalid, ambiguous, or pattern-expanded mapping omits it. Themes must not manufacture a route from `analysisPath`. Placed sub-analysis cards carry `analysisPath` but leave navigation to the host.

Value tokens retain the record `canonicalPath` and add the context needed to present the displayed value:

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

Optional strings are omitted when unavailable. `filter` is the normalized `key=value, …` selection used to choose the row; `unit` is taken from the materialized metric's `unit`/`units` field.

A theme selects a placed node by class and reads `data.astra` to join it to the bundle below — it never depends on an author-controlled document label, reads `astra.yaml`, or reimplements ASTRA resolution.

## The publication bundle

MySTRA opens the complete project through `@astra-spec/sdk` and places its canonical `ResolvedAnalysisBundle` unchanged on every page. The theme discovers the hidden `div.astra-publication-bundle` carrier by class and reads this data shape:

```ts
interface AstraPublicationData {
  schemaVersion: 'astra-publication-bundle.v1';
  activeAnalysisPath: '$' | string;
  bundle: ResolvedAnalysisBundle;
}
```

The SDK owns the versioned resolved document, canonical paths, alias resolution, active decisions/outputs, provenance, evidence links, and deterministic artifact bindings. Theme code should import those types and derived-index helpers directly:

```ts
import { indexAnalysis } from '@astra-spec/sdk';
import type { ResolvedAnalysisBundle } from '@astra-spec/sdk';
```

`activeAnalysisPath` is `$` for the root or the canonical analysis path selected by the page's filename/frontmatter. It is presentation context only; the bundle always contains the whole project.

## Hidden carriers

Besides the bundle, the plugin appends two hidden carriers when relevant:

- **`div.astra-publication-resources`** — one `link` node marked `static: true` per SDK artifact binding. MyST copies and rewrites its `url`; `data.astraArtifact = { outputPath, cacheToken }` joins that URL back to the bundle binding without changing the SDK data.
- **`div.astra-cites`** — a narrative/parenthetical pair of hidden `cite` nodes per DOI, registering every resolved citation with MyST's citation and bibliography pipeline. Rich themes read DOI evidence from the publication bundle itself.

## Anchors

Rendered elements retain local fallback identifiers for MyST rendering. Authors who need a project-wide cross-reference should set the directive's explicit `:label:` and use MyST's standard `{ref}` role; MySTRA does not invent a globally unique anchor from an unscoped record id.
