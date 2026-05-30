# MySTRA — follow-up work

Deferred items from the Strategy-A refactor. Each is independent; none blocks
the current build (book-theme baseline works, tests green). Ordered roughly by
readiness.

---

## 1. Hidden insight-resolution targets (next concrete piece)

### Problem
Decision option tabs (`render-methods.ts`) emit `crossReference`s to
`prior_insight-<id>` so each option lists *"Supporting insights: …"* with a
hover popover on book-theme. The popover only resolves when a
`prior_insight-<id>` **target node exists in the page mdast** — so today the
prototype's `index.md` explicitly places **32 `:::{astra:prior-insight}` blocks**
as an "Analysis record" appendix purely to make the option hovers work. The
appendix is heavy and duplicates content the prose already implies.

### Approach
A new document-stage transform in `src/index.ts`, alongside `anchorTransform`
and `storeTransform`:

1. Collect every `prior_insight-<id>` identifier referenced by `crossReference`
   nodes on the page (the option tabs the decision directive emitted).
2. Subtract ids the author **did** place explicitly via
   `:::{astra:prior-insight}` (dedupe — duplicate identifiers are an error).
3. For each remaining id, render a compact carrier (claim · scope · quote ·
   citation), reusing the prior-insight render path already in
   `render-evidence.ts` / the `priorInsightDirective`.
4. Append all carriers inside a hidden `<div style="display:none"
   class="astra-insight-targets">` at the end of the tree.

`crossReference.tsx` resolves targets via `selectMdastNodes(references.article,
identifier)` — it walks the **mdast tree (data), not the DOM** — so
`display:none` doesn't suppress the popover; the popover renders the carrier
node via `<MyST ast={…}/>` (see Appendix). The hover content **is** the
carrier, so its design is fully in our hands.

### Relevant APIs & code
- New transform alongside `anchorTransform` / `storeTransform` in `src/index.ts`.
- Insight rendering via the existing `priorInsightDirective` path
  (`renderInsightEvidence` in `render-evidence.ts`).
- Collecting placed `crossReference`s: standard mdast walk (same shape as
  `rewriteStaticImages`).

### Effort & risk
Small (~one transform). Risks: (a) duplicate identifier if the author already
placed an insight — solved by deduping; (b) book-theme popover rendering of a
`display:none`-wrapped target — the Appendix establishes the mechanism, but
worth a smoke check; the guaranteed fallback is to wrap in a collapsed
`<details>` instead of `display:none`.

---

## 2. Validate ASTRA input via `@astra-spec/sdk`

### Problem
MySTRA assumes `astra.yaml` is well-formed. A malformed spec (missing required
field, dangling `from:`, unknown decision in a `when:`, a narrative anchor at a
non-existent element) fails late and opaquely — a directive throws and renders
a red admonition, or a cross-reference silently doesn't resolve.

### Approach
The SDK already ships the exact validators we'd otherwise hand-roll. Run them
once per project load (in `loadASTRASource`, `src/loader.ts`) and report results
through MyST's warning channel rather than throwing. Two tiers:

- **Sync, offline — do first.** `validateAnalysis(data, {basePath})` →
  `SemanticError[]` (dangling `from:`, bad `when:` refs, alias rules);
  `validateNarrativeAnchors` / `checkNarrativeCoverage` / `validateNarrativeSections`
  for the anchor grammar we depend on. Wire unconditionally.
- **JSON Schema (async + network) — opt-in.** `validateAnalysisData/File` is
  `Promise<string[]>` and fetches the schema from astra-spec.org unless given
  `opts.schema`. Bundle/pin the schema and gate behind an env flag rather than
  running on every build.

### Relevant APIs & code
SDK: `validateAnalysis`, `validateNarrativeAnchors`, `checkNarrativeCoverage`,
`validateNarrativeSections`, `SemanticError`, `NarrativeWarning`,
`validateAnalysisData`, `loadAstraSchema`/`setAstraSchema`. Hook point:
`loadASTRASource` in `src/loader.ts`.

### Effort & risk
Low for the sync validators. Medium for schema validation because of the
sync/async + network constraints (keep opt-in). SDK is `v0.0.x`; treat results
as advisory (warn, don't hard-fail) so a validator quirk can't break rendering.

---

## 3. `astra.yaml` live-reload

### Problem
`myst start` watches Markdown, **not** `astra.yaml` or `results/`. The plugin
also caches the parsed project per `(root, universe)` in a module-level map
(`getSource` / `projectCache` in `src/index.ts`). So editing the spec or
regenerating a result does nothing until restart, and a rebuild would hit the
stale cache anyway.

### Approach
Two independent pieces:

- **Cache freshness (necessary, easy).** Either drop the cache and re-read per
  build pass (the parse is cheap; measure before optimising), or key
  `projectCache` on `astra.yaml`'s mtime. This alone makes a manual rebuild
  pick up spec changes.
- **Rebuild triggering.** Simplest first: document "restart to pick up data
  changes" (status quo). Failing that, a small chokidar sidecar that `touch`es
  a watched `.md` when `astra.yaml`/`results/**` change; or, if MyST exposes a
  plugin watch hook, register the extra paths.

### Relevant APIs & code
- `src/index.ts`: `projectCache`, `getSource(root, universe)` — the cache.
- Result paths to watch come from `src/loader.ts` (`resolveArtifact`).

### Effort & risk
Cache invalidation: trivial. Rebuild triggering: low–medium. A naive watcher
can loop — scope and debounce.

---

## 4. Deep-nesting page scope

### Problem
The two document transforms (`anchorTransform`, `storeTransform`) derive a
page's ASTRA scope from its **file basename only** (`scopeForFile(vfile)` in
`src/index.ts`: `index` → root, `<name>` → `<name>` sub-analysis). A page for a
sub-analysis nested deeper than one level resolves to the wrong scope or throws;
the `try/catch` swallows it, leaving the page with **no `astra-store` carrier**
and any `[t](#…)` anchors unresolved. Block directives/roles already accept
arbitrary-depth paths — only the implicit page-scope inference is shallow.

### Approach
Pick one page-file → analysis-path convention and centralise it in
`scopeForFile`:

- **Dotted filename** — `reconstruction.features.md` → `['reconstruction',
  'features']`. Zero new config, composes to any depth, keeps flat files.
- **Explicit frontmatter** — `astra_scope: reconstruction.features`. Explicit
  / least magic; decouples filename from scope.
- **Directory structure** — derive from path relative to project. Natural with
  nested dirs, awkward with the current flat layout.

### Relevant APIs & code
`src/index.ts`: `scopeForFile(vfile)`. `resolveScope` already handles
arbitrary-depth `analysisPath` arrays — only the *derivation* changes.

### Effort & risk
Low–medium; one-spot change. Prefer the explicit (frontmatter) or composable
(dotted) option over inferring from directory layout, which can conflict with
how authors organise multi-page sites.

---

## Appendix: how MyST renders reference popovers (and what it means for §1)

Findings from reading the build output + `myst-to-react` source. Mainly relevant
to §1; also explains why DOI citations already work.

### The model — engine resolves, theme renders client-side

The engine (`mystmd`) *resolves* references at build time and writes static JSON
(`content/<page>.json`, `myst.xref.json`); the theme (the book-theme React app)
*renders* the popovers **client-side**. The server — `myst start` or any
static host — only serves those JSON files; no popover logic is server-side.

Book-theme has **two distinct popover mechanisms**, sharing only a generic
`HoverPopover` shell:

**Citations — a key→table join, embedded per page.** The engine recognises a
DOI (even a bare `https://doi.org/…` link), fetches metadata, rewrites the
inline node to a `cite` node carrying a `label` (the DOI key), and bakes the
full reference into the page's `references.cite.data[label]` (including a
pre-rendered `html` string). `cite.tsx` does
`useReferences()?.cite?.data[label]` and renders `<HoverPopover
card={<CiteChild html={html}/>}>` (via `dangerouslySetInnerHTML`). No fetch, no
node lookup — a local key join. *Consequence:* the prototype build already has
39 `cite` nodes + a populated references table, so author–year inline + hover
popovers **already work for DOIs**. The remaining citation work is narrow (a
reference-list directive, offline behaviour) — not "wire citations from
scratch."

**Cross-references — an identifier→node resolve.** `crossReference.tsx` resolves
the target *node* by identifier: a remote ref fetches that page's mdast
(`createExternalUrl({url, remoteBaseUrl, dataUrl, baseurl})` + SWR); a local ref
uses `references?.article` (the current page's mdast). It then
`selectMdastNodes(tree, identifier, 3)` and renders the located node via
`<MyST ast={nodes}/>` inside `HoverPopover`. **Never touches
`references.cite`.**

### A theme can add a cite-like mechanism — and it's in bounds

`cite.tsx` is not engine magic; it's a theme-layer component built from public
extension points, so a new theme replicates the pattern:

- **Renderers are an open, node-type-keyed map.** `DEFAULT_RENDERERS =
  mergeRenderers([ … CITE_RENDERERS, CROSS_REFERENCE_RENDERERS, … ])`. A theme
  uses `mergeRenderers` to add/override.
- **Data is a plain React context.** `ArticleContext` / `ArticleProvider({references})`
  / `useReferences()`. A theme can define its own provider + hook for any data
  table.

A theme must render the engine's **build output** (it can't read source or
invent content). Since the plugin already bakes the **resolved store** into the
build, a theme reading that store and rendering popovers is doing exactly what
`cite.tsx` does with `references`.

### Implication for §1 (and for the future rich theme)

- **Baseline (book-theme):** §1's hidden same-page `crossReference` targets get
  citation-quality popovers for free — `selectMdastNodes` searches the mdast
  tree, not the DOM, so `display:none` is fine.
- **Rich (`lightcone-astra`):** a store-driven NodeRenderer = the 1:1
  `cite.tsx` analog — `AstraStoreProvider` + `useAstraStore()` + a custom
  renderer + `HoverPopover`, looking the element up in the resolved store by
  id. Same shape as citations, richer card.

### Sources
- `myst-to-react`: [`cite.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/myst-to-react/src/cite.tsx),
  [`crossReference.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/myst-to-react/src/crossReference.tsx),
  [`index.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/myst-to-react/src/index.tsx)
- `providers`: [`article.tsx`](https://github.com/jupyter-book/myst-theme/blob/main/packages/providers/src/article.tsx)
