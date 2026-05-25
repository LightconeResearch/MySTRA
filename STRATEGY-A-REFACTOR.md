# MySTRA → Strategy A: refactor plan

> Status: **landed** (everything except the separate `lightcone-astra` theme,
> §9). Supersedes the architecture in `SPEC.md` (the generate-everything content
> server); `SPEC.md` has been rewritten to the implemented design. This document
> remains the rationale and the keep/refactor/remove record.

## 1. Context & motivation

MySTRA today (the `main` branch) is a **generate-everything content server**:
it loads an ASTRA project, transforms the *entire* analysis into MyST AST
(`transform/index.ts: buildAllPages`/`astraToMystAST`), and runs a **bespoke
Express content server** (`src/server/`) that serves `config.json`,
`content/*.json`, `myst.xref.json`, plus custom sidecars (`/astra/*.json`,
`/doi-metadata`, `/papers`, `/static`) and a WebSocket reload, to an unmodified
book-theme.

A review early in this effort found that approach **partly overengineered for
its stated goal** ("AST any theme server can render"): the custom container
kinds and the `/astra` sidecar are a *parallel data contract* aimed at a
specific bespoke renderer, and the custom server re-implements a slice of what
the MyST engine already does. It works, but it fights MyST's grain and carries
a large surface area.

**Strategy A** inverts the model. Instead of generating the document, the
human/agent writes a normal **MyST Markdown report** and *imports/cites* ASTRA
components by reference. A single **MyST plugin** (directives + roles + a
transform) reads `astra.yaml` at build time and emits standard MyST AST. It runs
on the **stock `myst` CLI and themes** — no custom server. We validated this
end-to-end on a real DESI DR1 BAO analysis (`prototype/`).

### The governing principle: three single-sources

| Concern | Single source of truth |
|---|---|
| **Data** — what a decision/output/finding *is* | `astra.yaml` (+ `universes/`, `results/`) |
| **Composition** — what appears, where, in what order, which view | the author's `index.md` |
| **Presentation** — how it looks | the theme |

The plugin is a pure **projector**: it reads the data and emits (a) rendered
semantic AST for the elements the author placed (the baseline any theme shows)
and (b) — for rich themes — the resolved ASTRA data. It makes no authoring or
styling decisions. Everything in the build output is a *derived projection*, not
an authored duplicate.

## 2. What we learned (decisions this plan rests on)

1. **MyST is two-stage.** The engine parses source → AST; the theme renders the
   AST. The content server only *serves JSON* and the theme **cannot read
   `astra.yaml`**. ⇒ anything a theme needs must be baked into the build output
   by the plugin (the only thing that reads ASTRA).
2. **Plugins run in the engine at build time.** Directives/roles/transforms are
   supported and sufficient. The plugin "**renderers**" type (shipping render
   behavior from a `.mjs`) is *not implemented* ⇒ custom *interactive* rendering
   must live in a **theme**, not the plugin.
3. **Block directives degrade for free; inline cards do not.** `:::{astra:*}`
   directives emit stock nodes (`container[figure]`, `table`, `details`,
   `admonition`, `card`) that every theme renders. Inline hover *cards* are a
   presentation behavior ⇒ they belong to the theme, not the plugin/AST.
4. **Keep the AST neutral.** Emit only **semantic classes + text + identifiers**
   (no glyphs, colours, or inline styles baked in). Appearance is the theme's.
   (`style` must be a JS object if ever set — a string crashes the React
   renderer.)
5. **Normalize to avoid duplication.** Placed nodes carry an **identifier +
   kind** (and the author's view options); the resolved ASTRA data is conveyed
   **once**, keyed by id; a rich theme joins node-id → data. The only remaining
   duplication is the intentional rendered-fallback for the baseline theme,
   single-sourced in one build pass.
6. **Authoring control = placement.** The directive/role vocabulary *is* the
   author's degrees of freedom. The theme may change *how* a placed element
   renders and may *fill* author-placed pattern directives (`:::{astra:dag}`)
   from the data — but it must never inject elements the author didn't place.
7. **Recognition needs an explicit marker.** A theme recognizes an ASTRA element
   via a stable `class`/`identifier` (e.g. `output-<id>`, `class="astra-output"`)
   — not a fragile id-prefix convention alone — and then can re-render it
   dynamically *if* it can reach the data (point 5).
8. **Numbers must be sourced, not typed.** The `{astra:value}` role interpolates
   real cells from result files at build time; no measured number is hand-typed
   in prose.
9. **MyST already does the rest.** `myst start` gives build + content server +
   theme + live reload. MyST's asset pipeline copies/【hashes】 result images.
   MyST resolves DOIs natively ⇒ the bespoke DOI/paper subsystem can largely go.
10. **The Vellum mocks are the design north-star** (narrative-first prose, inline
    glyph tokens, focused preview cards — graphs optional, author-placed).

## 3. Target architecture

```
astra.yaml + universes/ + results/        index.md (+ sub-analysis pages)
        │  (data, single source)                  │  (composition, single source)
        └──────────────┬───────────────────────────┘
                       ▼
         @lightcone/astra-myst  (the plugin, npm)
         · directives  → block ASTRA components as stock MyST AST  (book-theme baseline)
         · roles       → inline reference tokens (neutral: class + id + label)
         · transform   → emit the resolved ASTRA data store, once, keyed by id
                       ▼
              stock `myst` engine → content JSON  → stock content server
                       ▼
   book-theme (baseline, readable)     OR     lightcone-astra theme (rich)
                                              · NodeRenderers keyed on astra classes
                                              · reads the resolved store → cards, DAGs, widgets
```

Two render modes, by theme choice only:

- **Basic** — register the plugin in `myst.yml`, `template: book-theme`. Clean,
  readable: real figures/tables/dropdowns, live numbers, plain-text inline
  references. **Nothing else required** (no user CSS).
- **Rich** — `template: lightcone-astra`. Glyphs, colours, hover preview cards,
  and "powerful patterns" (e.g. a product-dependency graph), all driven from the
  resolved store. The user's only change is the one `template:` line.

## 4. The refactor — keep / refactor / remove

The lower layers are reused; the server/orchestration layer is removed.

### Keep (becomes the core of the package)
- `src/loader.ts` — one file. Loads a project for one universe via the SDK
  (`loadYaml` + `resolveAnalysisTree`), picks the universe, and resolves result
  artifacts deterministically on demand from the lightcone-cli path convention
  `[<analysis path>/]results/<universe>/<id>/` (no scanning). Replaces the old
  three-file `src/loader/` + `result-scanner`.
- **No data-model types of our own.** They're imported directly by their
  `@astra-spec/sdk` names (`Analysis`, `Decision`, …; `import type`). The
  hand-mirrored `src/types/astra.ts`, the alias module that briefly replaced it,
  and the `schema-coverage` guard test are all gone — the SDK is the single
  source of truth, pinned in `package.json`.
- `src/transform/` per-component renderers actually used by the plugin:
  `ast-helpers`, `prose` (component-prose parsing + anchor grammar), `parse-table-data`,
  `resolve-output`, `render-methods` (renderDecision), `render-findings`
  (renderFinding), `render-evidence` (renderOneOutput / evidence / tables),
  `render-data-sources` (inputs/outputs tables).
- `src/index.ts` — the plugin itself *is* the package entry (default export); no
  `plugin/` subfolder, no separate thin entry.

### Refactor
- **Move scope-resolution into the plugin** (already done there): the recursive
  sub-analysis walk + sub-universe selection currently in `transform/index.ts:
  buildAllPages` is replaced by the plugin's `resolveScope`. Delete the
  whole-page orchestration; keep only the per-component helpers.
- **The `/astra` sidecar logic → the resolved store builder.** Reuse the
  `SerializedOutput`/`SerializedInput` resolution (from `server/routes/astra.ts`:
  `resolveOutputs`, `table_data`, `readMetric`, input alias resolution) but emit
  it as a **build artifact** (see §5), not a server endpoint. This is the one
  substantive piece of `src/server/` worth salvaging.
- **Package shape.** Ship as an npm package (working name `@lightcone/astra-myst`)
  whose entry is the compiled plugin `.mjs`. `myst.yml` references it by name
  once published, or by local path during development. Optionally a tiny CLI
  remains only for *offline* tasks (warm DOI cache / pre-generate the store) —
  never for serving.

### Remove (remnants of the generate-everything approach)
- `src/server/` — the entire bespoke content server: `index.ts`, `routes/*`,
  `watcher.ts`, `websocket.ts`. Replaced by the stock `myst` engine + server +
  live reload.
- `src/theme/launcher.ts` — `myst start` launches the theme.
- `src/cli.ts` — the `mystra` two-server boot CLI. (Optionally replaced by a
  minimal offline-only CLI; otherwise gone — users run `myst`.)
- `src/transform/index.ts` — `buildAllPages` / `astraToMystAST` whole-document
  orchestration and its flat-block page assembly.
- `src/types/content-server.ts` — `PageData` / `SiteManifest` / `PageContent`
  (the server API surface).
- `src/utils/hash.ts` — content sha256 for the server's cache invalidation.
- **Audit-and-remove** per-component renderers that only served the generated
  document and aren't invoked by any directive: `render-narrative` (the author
  now writes narrative as Markdown), `render-universe-banner`,
  `render-sub-analyses`, `render-output-recipe`, `render-output-provenance`,
  `render-prior-insights` (the plugin builds the prior-insight admonition itself).
  Remove each once `tsc`/tests confirm it has no remaining caller. Their
  *semantics* (provenance, recipe) live on in the resolved store, not as bespoke
  container kinds.
- `src/papers/` and most of `src/doi/` — see §6 (citations).
- Tests tied to the old surface: `tests/server-routes.test.ts`,
  `tests/page-shape.test.ts`. Replace with plugin-emission tests (§8).

## 5. The resolved data layer (for rich themes)

Goal: give a theme the **complete, resolved** ASTRA model so it can do anything
(recognition, cards, dependency graphs, alternative layouts) **without reading
`astra.yaml` and without per-node duplication**.

- **Content:** the plugin's *resolved* model (universes applied, `from:` chains
  resolved, result paths, parsed table/metric values) — i.e. the
  `SerializedOutput`/`SerializedInput` shape, extended to decisions/findings/
  prior-insights/sub-analyses, **keyed by id**. Resolved, not raw YAML, so the
  theme never re-implements ASTRA semantics.
- **Delivery (decide during implementation; prefer the simplest that survives
  the MyST pipeline):**
  1. a single **site-global static JSON** emitted by the build (closest to the
     old `/astra/*.json`, but baked, not served live); the theme loads it once
     into a provider — **preferred**, because powerful patterns are global; or
  2. attach the resolved tree to **node `data`** on a dedicated root-level
     carrier (we know `data` survives to the theme); or
  3. page **frontmatter** scoped per page (verify custom-key passthrough first).
- **Recognition markers (do now, cheap, harmless to book-theme):** every placed
  ASTRA node carries a stable `class` (`astra-output`/`astra-output--figure`,
  `astra-decision`, …) and keeps its `identifier` (`output-<id>`). A theme
  selects on these (the proven `mergeRenderers` + `unist-util-select` pattern) and
  joins id → store.
- **Non-goal:** do **not** rebuild a live sidecar server, and do **not** embed a
  full data copy on every node. One store, referenced by id.

## 6. Citations — lean into MyST

MyST resolves DOIs natively. Retire MySTRA's bespoke DOI resolver/fetcher/cache
and the paper-backlink subsystem (`src/papers/`, `src/doi/`): emit citations in a
form MyST resolves (DOIs / a generated `references.bib`) and let the theme render
the reference list. **As implemented, `src/doi/` was removed entirely** — the
cache-read hedge had no writer left (the fetcher was gone), so DOI evidence now
renders as a plain `doi.org` link and inline cards show the bare DOI. This
removed a whole subsystem and cleared the "Could not link citation" warnings the
prototype's stale cache had been producing. Author–year text + a linked
reference list return once a project bibliography is wired (the follow-up).

## 7. Authoring contract (the directive/role vocabulary)

This vocabulary *is* the author's compositional surface; extend it to add freedom
rather than adding theme magic.

- **Block "import":** `astra:decision`, `astra:output`, `astra:finding`,
  `astra:prior-insight`, `astra:inputs`, `astra:outputs`, `astra:subanalysis`
  (+ future patterns like `astra:dag`, `astra:gallery` — empty author-placed
  hooks the theme fills from the store).
- **Inline "cite":** `astra:decision|output|finding|prior-insight|analysis` —
  neutral glyph-free tokens (`span.astra-ref--<kind>` + label + id), optional
  `|display text`; and `astra:value` for sourced numbers.
- **View options** on directives (`:as:`, `:view:`, `:compact:`) express the
  author's chosen rendering; the theme honours them.
- All Markdown prose, anchor grammar (`[t](#decisions.x)`), math, figures, TOC,
  multi-page sub-analyses are plain MyST.

## 8. Simplicity principles / explicit non-goals

- **Lean on MyST for everything it already does** — serving, asset hashing, live
  reload, numbering, xref, search, citations. Write only the ASTRA→AST bridge.
- **Prefer stock node types.** Use `container`/`details`/`table`/`admonition`/
  `card`/`span`; introduce a custom node type only when a stock one cannot carry
  the intent. Custom *kinds* are fine as long as children render on book-theme.
- **No baked presentation in the AST** (no glyphs/colours/inline styles, beyond
  the minimal default-hide for any theme-only affordance).
- **No parallel live data server, no per-node data duplication.**
- **Don't pre-build speculative patterns** (DAG, gallery) until an author needs
  the directive; ship the data layer that makes them possible, not the widgets.
- Delete aggressively: every file in §4-Remove should be gone, with `tsc` and
  tests green, before calling the refactor done.

## 9. The `lightcone-astra` theme (separate deliverable)

Out of scope for the package refactor, tracked here for completeness. A MyST
theme (extends `book`/`article` theme) that: registers `NodeRenderer`s keyed on
the `astra-*` classes/identifiers; reveals the inline preview cards (built from
the store, not from hidden AST spans); renders the rich figure/decision/insight
treatments and any author-placed patterns. Start as a **light** theme (base theme
+ bundled stylesheet) since block content already renders; graduate to custom
React renderers for true popovers/graphs. The prototype's `custom.css` is the
seed of its stylesheet. Until it exists, book-theme is the (clean) baseline.

## 10. Suggested phasing

1. **Snapshot** the prototype as the reference behaviour; capture screenshots.
2. **Restructure** the package around the plugin; add §5 recognition markers
   (classes) to every emitted element.
3. **Remove** the server, CLI, theme launcher, whole-page transform, and
   content-server types (§4-Remove); make `tsc` + tests green.
4. **Salvage** the `/astra` resolution into the resolved-store builder (§5) and
   emit the store; verify the delivery channel.
5. **Prune** unused render-* and `utils/hash`; audit with the compiler.
6. **Citations**: retire the DOI/paper subsystem in favour of MyST-native (§6).
7. **Docs**: rewrite `README.md` + `SPEC.md` to Strategy A; document the
   authoring vocabulary and the theme contract.
8. **Theme**: build `lightcone-astra` (separate package).

## 11. Verification

- `npm run build` clean (no dead imports after removals).
- New tests assert **plugin emission** per directive/role (decision →
  `details`+`tabSet`; output figure → `container[figure]` + relative image url +
  `output-<id>` + `astra-output` class; `astra:value` → correct interpolated
  cell; sub-analysis scope resolution) and the **resolved store** shape.
- `cd prototype && npx mystmd start` (book-theme, **no `custom.css`**) →
  document is clean and readable; figures load; numbers are live; no inline
  clutter; no `astra.yaml` read by the server/theme.
- Confirm a theme can select `container[identifier^="output-"]` /
  `.astra-output` and reach the store by id (recognition guarantee).

## 12. Open questions

- ~~**Store delivery channel**~~ **(resolved)** — a hidden `div.astra-store`
  carrier with the store on node `data` survives the engine's content-JSON
  serialization intact (verified by building `prototype/`: `data.astra` is
  present in `content/index.json`, scoped per page). This is the channel.
- **`astra.yaml` live reload**: the plugin caches the parse; `myst start` watches
  Markdown, not `astra.yaml`. Decide between a watch hook, cache invalidation, or
  "restart to pick up data changes" (acceptable for now).
- **Package/name/publishing** for the plugin and the theme template.
- How much of `SPEC.md` to preserve vs rewrite (lean: rewrite).
