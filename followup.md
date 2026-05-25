# MySTRA — follow-up work

Deferred items from the Strategy-A refactor. Each is independent; none blocks the
current build (`book-theme` baseline works, tests green). Ordered roughly by
value-to-effort.

---

## 1. Validate ASTRA input via `@astra-spec/sdk`

### Problem
MySTRA assumes `astra.yaml` is well-formed. A malformed spec (missing required
field, dangling `from:` reference, unknown decision in a `when:` clause, a
narrative anchor pointing at a non-existent element) currently fails late and
opaquely — a directive throws and renders a red "ASTRA plugin" admonition, or a
cross-reference silently doesn't resolve, with no pointer to the real cause.

### Why it matters
The SDK already ships the exact validators MySTRA would otherwise hand-roll, so
this is *additive reuse* — it surfaces bad input early with a precise message
instead of a downstream symptom. It's the natural next step after adopting the
SDK's types + helpers.

### Proposed approach
Run the SDK validators once per project load (in `loadASTRASource`,
`src/loader.ts`) and report results through MyST's warning channel rather than
throwing. Three tiers, increasing cost:

- **Semantic (sync, no network) — do first.** `validateAnalysis(data, {basePath})`
  returns `SemanticError[]` (dangling `from:`, bad `when:` refs, alias rules,
  …). Cheap and offline; wire it unconditionally and log each error.
- **Narrative (sync, no network).** `validateNarrativeAnchors` /
  `checkNarrativeCoverage` (→ `NarrativeWarning[]`) / `validateNarrativeSections`.
  Especially useful because MySTRA's whole value proposition is anchored prose;
  this catches `[t](#decisions.typo)` before it renders as an unresolved link.
- **JSON Schema (async + network).** `validateAnalysisData/File` and
  `validateUniverseData/File` are `Promise<string[]>` and fetch the schema from
  `astra-spec.org` on first use unless given `opts.schema`. Two frictions:
  `loadASTRASource` is sync, and the network fetch is undesirable at build time.
  Mitigate by (a) bundling/pinning the schema and passing it via `opts.schema`
  (see `loadAstraSchema` / `setAstraSchema`), and (b) running schema validation
  in an opt-in path (env flag or a small offline CLI), not on every build.

### Relevant APIs & code
- SDK: `validateAnalysis`, `validateUniverse`, `validateNarrativeAnchors`,
  `checkNarrativeCoverage`, `validateNarrativeSections`, `SemanticError`,
  `NarrativeWarning`, `validateAnalysisData`, `loadAstraSchema`, `setAstraSchema`.
- Hook point: `loadASTRASource` in `src/loader.ts` (already loads the dict the
  validators want; `validateAnalysis` accepts the parsed object).

### Effort & risk
Low for the sync validators (a few lines + a reporting helper). Medium for
schema validation because of the sync/async + network constraints — keep it
opt-in. Risk: the SDK is `v0.0.x`; validator output format may change. Treat
results as advisory (warn, don't hard-fail the build) so a validator quirk can't
break rendering.

---

## 2. Citations / bibliography via MyST

### Problem
When the DOI subsystem was removed, evidence DOIs began rendering as plain
`https://doi.org/…` links (`formatCiteNode` in `src/transform/render-evidence.ts`).
There is no reference list, and inline citations show a bare DOI instead of an
author–year label. The prototype previously emitted `cite` nodes that produced
`Could not link citation` warnings because no bibliography backed them.

### Why it matters
A scientific report needs real citations: author–year inline text and a linked
reference section. MyST resolves these natively *if* the project has a
bibliography — so the fix is to feed MyST what it expects rather than re-build a
DOI resolver.

### Proposed approach
Lean entirely on MyST's citation machinery:

1. **Collect** every evidence DOI across the loaded analysis tree (walk
   `findings` + `prior_insights` → `evidence[].doi`).
2. **Emit a project bibliography** MyST can resolve — generate a
   `references.bib` (or inject `project.bibliography` / a citation frontmatter
   block) so MyST fetches DOI metadata and builds the reference list. Decide
   during implementation whether the plugin writes a `.bib` file as a build side
   effect or whether MyST's own DOI resolution can be triggered directly from
   `cite` nodes carrying the DOI.
3. **Emit `cite` nodes** (not plain links) from `formatCiteNode` /
   `renderInsightEvidence`, keyed by the DOI, so they link into the reference
   list and render author–year text.
4. **Reference list** — let the theme/MyST render it; optionally place it via a
   directive so the author controls *where* it appears (consistent with the
   "author owns composition" principle).

### Relevant APIs & code
- `src/transform/render-evidence.ts`: `formatCiteNode` (currently `link(...)`),
  `renderLiteratureEvidence`, `renderInsightEvidence`.
- MyST: `references.bib` / `project.bibliography`, native DOI resolution, the
  `cite`/`citeGroup` mdast nodes (already constructible via `ast-helpers`).
- The SDK does **not** do bibliography generation — this is MyST-side.

### Effort & risk
Medium. The mechanics of how MyST best ingests DOIs (a generated `.bib` vs.
inline resolution) need a short spike against the stock pipeline. Risk: build-time
network fetches for DOI metadata (cache them); offline builds should degrade to
the current plain-link behaviour rather than fail.

---

## 3. `astra.yaml` live-reload

### Problem
`myst start` watches Markdown (and its own assets), **not** `astra.yaml` or the
files under `results/`. The plugin also caches the parsed project per
`(root, universe)` in a module-level map (`getSource` / `projectCache` in
`src/index.ts`). So editing the spec or regenerating a result does nothing until
the server is restarted (or a watched `.md` is touched), and even a rebuild would
hit the stale cache.

### Why it matters
The authoring loop for the *data* (decisions, outputs, results) is currently
"edit → restart". For an agent or human iterating on `astra.yaml` alongside the
narrative, that's the main rough edge in the dev experience.

### Proposed approach
Two independent pieces — cache freshness and rebuild triggering:

- **Cache invalidation (necessary, easy).** Key `projectCache` on `astra.yaml`'s
  mtime (and re-check on each `getSource`), or drop the cache and re-read per
  build pass. Re-reading is simplest and almost certainly fast enough — the parse
  is cheap and a build pass touches it a bounded number of times; measure before
  optimising. This alone makes a manual rebuild pick up spec changes.
- **Rebuild triggering (the harder half).** `myst start` must be told to rebuild
  when `astra.yaml` / `results/**` change. Options, simplest first:
  1. **Document "restart to pick up data changes"** (status quo; acceptable
     short-term).
  2. A tiny **sidecar watcher** (chokidar) that `touch`es a watched `.md` (e.g.
     the page whose scope changed) when `astra.yaml`/results change, nudging
     MyST to rebuild. Crude but external to MyST.
  3. Investigate whether MyST exposes a **plugin/watch hook** to register extra
     watched paths; if so, register `astra.yaml` and the resolved result dirs.

### Relevant APIs & code
- `src/index.ts`: `projectCache`, `getSource(root, universe)` — the cache to
  invalidate.
- Result paths to watch come from the deterministic convention in
  `src/loader.ts` (`resolveArtifact`): `[<analysis path>/]results/<universe>/`.

### Effort & risk
Cache invalidation: trivial. Rebuild triggering: low–medium depending on which
option — start by removing the cache (or mtime-keying it) so a manual rebuild is
correct, then decide if the watcher/hook is worth it. Risk: a naive watcher can
cause rebuild loops; scope it to the specific files and debounce.

---

## 4. Deep-nesting page scope

### Problem
The two document transforms (`anchorTransform`, `storeTransform`) derive a
page's ASTRA scope from its **file basename only** — `scopeForFile(vfile)` in
`src/index.ts` maps `index` → root and `<name>` → the `<name>` sub-analysis, and
nothing else. So a page for a sub-analysis nested deeper than one level resolves
to the wrong scope or throws; the `try/catch` swallows the error, leaving that
page with **no `astra-store` carrier** (rich-theme joins silently get nothing)
and any author-written `[t](#…)` anchors unresolved.

Note this only affects the *per-page transforms*. The block directives/roles
already accept arbitrary-depth paths (`a.b.id`), so an author can still place
deep components explicitly; it's the implicit page-scope inference that's
shallow.

### Why it matters
Today every real reproduction (and the prototype) uses a flat, single-level page
layout (`reconstruction.md`, `clustering.md`), so this is latent — which is
exactly why tests/builds stay green. It becomes a real bug the first time a TOC
nests a sub-sub-analysis as its own page.

### Proposed approach
Give `scopeForFile` a real page-file → analysis-path mapping. Options (pick the
one that fits how deep TOCs will actually be authored):

- **Directory structure mirrors nesting** — derive the path from the page's
  location relative to the project (`analyses/reconstruction/features.md` →
  `['reconstruction','features']`). Natural if pages live under `analyses/…`, but
  the current flat convention (`reconstruction.md` at root) wouldn't compose.
- **Dotted filename** — `reconstruction.features.md` → `['reconstruction',
  'features']`. Zero new config, composes to any depth, keeps flat files.
- **Explicit frontmatter** — `astra_scope: reconstruction.features` in the page.
  Most explicit / least magic; decouples filename from scope.

Whichever is chosen, it's a one-spot change: `scopeForFile` is already factored
out and shared by both transforms, so deepening the derivation fixes both at
once. Until then, document the single-level limitation (already noted in
`SPEC.md`).

### Relevant APIs & code
- `src/index.ts`: `scopeForFile(vfile)` (the basename derivation), consumed by
  `anchorTransform` and `storeTransform`; `resolveScope` already handles
  arbitrary-depth `analysisPath` arrays, so only the *derivation* of that array
  needs to change.

### Effort & risk
Low–medium; the implementation is small once the convention is chosen — the real
decision is which page-file↔tree mapping to commit to. Risk: picking a
convention that later conflicts with how authors organise multi-page sites, so
prefer the explicit (frontmatter) or composable (dotted) option over inferring
from directory layout.

---

## Appendix: how MyST renders reference popovers (and what it means for insights)

Findings from reading the build output + the `myst-to-react` source. Relevant to
§2 (citations) and to the future `lightcone-astra` theme.

### The model: engine resolves, theme renders client-side

MyST is engine + theme. The engine (`mystmd`) *resolves* references at build time
and writes static JSON (`content/<page>.json`, `myst.xref.json`, …); the theme
(the book-theme React app) *renders* the popovers **client-side**. The server —
`myst start` or any static host — only serves those JSON files; no popover logic
is server-side.

There are **two distinct popover mechanisms**, sharing only the generic
`HoverPopover` shell:

**Citations — a key→table join, embedded per page.** The engine recognises a DOI
(even a bare `https://doi.org/…` link — see below), fetches its metadata, rewrites
the inline node to a `cite` node carrying a `label` (the DOI key) + author–year
text, and bakes the full reference into the page's `references.cite.data[label]`
(including a pre-rendered `html` string). `cite.tsx` then does
`useReferences()?.cite?.data[label]` and renders `<HoverPopover card={<CiteChild
html={html}/>}>` (the html via `dangerouslySetInnerHTML`). No fetch, no node
lookup — a local key join.

**Cross-references — an identifier→node resolve.** `crossReference.tsx` resolves
the target *node* by identifier: for a remote page it fetches that page's mdast
(`createExternalUrl({url, remoteBaseUrl, dataUrl, baseurl})` + SWR); for a local
ref it uses `references?.article` (the current page's mdast). It then
`selectMdastNodes(tree, identifier, 3)` and renders the located node via `<MyST
ast={nodes}/>` inside `HoverPopover`. It never touches `references.cite`.

### Correction to §2: DOIs already resolve to citations

This revises the framing in §2 above. Because the engine auto-converts
`doi.org` links into `cite` nodes, the prototype build already contains 39 `cite`
nodes (author–year inline) and a populated `references.cite` table — so inline
citations **and their hover popovers already work** (given network at build to
fetch DOI metadata; offline it falls back to a link). The remaining work in §2 is
narrower than stated: mainly rendering a **reference list** (a `{bibliography}`
directive / placement) and offline-cache behaviour — not "wire up citations from
scratch." (The prototype README's "citations are plain DOI links" note is stale
and should be corrected.)

### A theme can add a cite-like mechanism — and it's in bounds

`cite.tsx` is **not** engine magic; it's a theme-layer component built from public
extension points, so a new theme can replicate the pattern:

- **Renderers are an open, node-type-keyed map.** `DEFAULT_RENDERERS =
  mergeRenderers([ … CITE_RENDERERS, CROSS_REFERENCE_RENDERERS, … ])`; a theme
  uses `mergeRenderers` to add a renderer for a new node type or override an
  existing one, then passes the map to `<MyST>`.
- **Its data is a plain React context.** `article.tsx` defines `ArticleContext` /
  `ArticleProvider({references})` / `useReferences()`. A theme can define its own
  provider + hook for an arbitrary data table.

The boundary a theme must respect: it renders the engine's **build output**; it
must not read source (`astra.yaml`) or invent content. Since the plugin already
bakes the **resolved store** into the build, a theme reading that store and
rendering popovers is doing exactly what `cite.tsx` does with `references` — fully
in bounds.

### Implication for insight previews

- **Baseline (book-theme, no theme):** emit the referenced insights as hidden,
  **same-page** `crossReference` targets. `selectMdastNodes` searches the mdast
  *tree* (`references.article`), not the live DOM — so a `display:none` target is
  still found and rendered → citation-quality popover, no fetch, no visible
  appendix. (This is the "hidden-targets" approach.)
- **Rich (`lightcone-astra`):** a dedicated, store-driven renderer is the 1:1
  `cite.tsx` analog — `AstraStoreProvider` + `useAstraStore()` + a custom
  `NodeRenderer` (keyed on an astra node type/class) + `HoverPopover`, looking the
  element up in the resolved store by id. Same shape as citations, richer card.

### Sources
- `myst-to-react`: [`cite.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/myst-to-react/src/cite.tsx),
  [`crossReference.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/myst-to-react/src/crossReference.tsx),
  [`index.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/myst-to-react/src/index.tsx)
- `providers`: [`article.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/providers/src/article.tsx)
