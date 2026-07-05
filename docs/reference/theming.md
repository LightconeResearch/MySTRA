# Theming — for theme authors

This page documents the contract between MySTRA and a rich MyST theme. Report authors never need it: on the stock `book-theme` everything renders cleanly with no CSS. A dedicated theme uses the markers and data below to add kind glyphs, per-kind colours, hover preview cards, and richer patterns.

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
| `astra-universe` | A universe selection table |
| `astra-subanalysis` | A sub-analysis nav card |

Inline tokens are neutral spans: `span.astra-ref--<kind>` (`decision`, `output`, `finding`, `prior_insight`, `analysis`, `input`, `option`, `evidence`, `universe`, `value`). Each carries a `data.astra` join key — `{ kind, id, path }` (plus value metadata such as the column and filter for `{astra:value}` tokens).

A theme selects a placed node by class or identifier (`.astra-output`, `[identifier^="output-"]`) and joins it to the store below by id — it never reads `astra.yaml`.

## The resolved store

For rich rendering the plugin bakes a **resolved store** onto a hidden `div.astra-store` carrier's `data` on every page: the fully resolved outputs (project-relative paths, parsed table/metric values, recipes, provenance), inputs, decisions, findings, prior insights, and sub-analyses of the page's scope, all keyed by id. Elements referenced across scopes are merged in, keyed by their full dotted path (`reconstruction.xi`).

The exact shape is defined by [`src/transform/resolved-store.ts`](https://github.com/LightconeResearch/MySTRA/blob/main/src/transform/resolved-store.ts) and its exported `ResolvedStore` / `Serialized*` types, importable for programmatic use:

```ts
import type { ResolvedStore, SerializedOutput } from '@astra-spec/mystra';
```

## Hidden carriers

Besides the store, the plugin appends two more hidden carriers per page when relevant:

- **`div.astra-assets`** — one hidden `image` node per image-typed result (tagged `data.astraAsset = <output-id>`), so MyST's asset pipeline produces a servable hashed URL the theme can rejoin to the store entry.
- **`div.astra-cites`** — one hidden `cite` node per DOI (both narrative and parenthetical kinds), so MyST's citation pipeline resolves formatted author–year citations and bibliography entries that the theme's hover cards can render instead of raw DOIs.

## Anchors

Rendered elements carry `<kind>-<id>` identifiers (`output-hubble_diagram`, `decision-algorithm`, `finding-signal_detected`, `prior_insight-recon`, `option-<decision>-<option>`, `universe-<id>`, `analysis-<sub>`), which is what `{astra:ref}` and plain MyST references resolve against. An author's `:label:` option replaces the default identifier on that block.
