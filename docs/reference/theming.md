# Theming — for theme authors

This page documents the contract between MySTRA and a rich MyST theme. Report authors never need it: on the stock `book-theme` everything renders cleanly with no CSS. A dedicated theme uses the markers and data below to add kind glyphs, per-kind colours, record dialogs, and richer patterns.

## Recognition markers

Every placed block carries a stable `astra-<kind>` class on the node bearing its `<kind>-<id>` identifier:

| Class | Element |
|---|---|
| `astra-decision` | A decision block |
| `astra-output`, plus `astra-output--figure` / `--table` / `--metric` / … | An output block, subtyped |
| `astra-finding` | A finding block |
| `astra-prior-insight` | A prior-insight admonition |
| `astra-input` / `astra-inputs` / `astra-outputs` | Single-input table / registries |
| `astra-option` | An option heading |
| `astra-subanalysis` | A sub-analysis summary card |

Inline tokens are neutral spans: `span.astra-ref--<kind>` (`decision`, `output`, `finding`, `prior_insight`, `analysis`, `input`, `option`, `evidence`, `value`). Each carries `data.astra` metadata — `{ kind, id, canonicalPath }` (plus value metadata such as the column and filter for `{astra:value}` tokens). `canonicalPath` is the stable lookup key from `@astra-spec/sdk`; option and evidence references use their owning record's canonical path.

A theme selects a placed node by class or identifier (`.astra-output`, `[identifier^="output-"]`) and joins it to the bundle below by canonical path — it never reads `astra.yaml` or reimplements ASTRA resolution.

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
