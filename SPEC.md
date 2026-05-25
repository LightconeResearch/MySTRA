# MySTRA — ASTRA components as a MyST plugin (Strategy A)

> This spec describes the current architecture. It supersedes the earlier
> generate-everything content server. The motivation, the alternatives weighed,
> and the keep/refactor/remove record live in
> [`STRATEGY-A-REFACTOR.md`](./STRATEGY-A-REFACTOR.md).

## 1. Goal

Let a human or agent author a normal **MyST Markdown report** that *imports and
cites* [ASTRA](https://github.com/LightconeResearch/ASTRA) components —
decisions, outputs, findings, prior insights, data tables — which stay
single-sourced in `astra.yaml`. Render it on the **stock `myst` CLI and themes**,
with no custom server.

### Guiding principle: three single sources

| Concern | Single source of truth |
|---|---|
| **Data** — what a decision/output/finding *is* | `astra.yaml` (+ `universes/`, `results/`) |
| **Composition** — what appears, where, in what order | the author's `index.md` |
| **Presentation** — how it looks | the theme |

MySTRA is the **projector** between data and AST. It makes no authoring or
styling decisions: it renders the elements the author placed (neutral semantic
AST, the baseline any theme shows) and bakes the resolved data for rich themes.

## 2. Architecture

### How MyST works

MyST is two-stage: the **engine** (`myst` CLI) parses source Markdown into an
`mdast` AST and writes content JSON; the **theme** renders that JSON in the
browser. The theme never sees the source files — and in particular **cannot
read `astra.yaml`**. Therefore anything a theme needs must be baked into the
build output by the only thing that reads ASTRA: the plugin.

Plugins run *in the engine, at build time*. MyST supports three plugin units,
all of which MySTRA uses:

- **directives** — block-level; one per placed ASTRA component.
- **roles** — inline; references and value interpolation.
- **transforms** — AST mutations run at a named stage.

The plugin "renderers" unit (shipping interactive render behaviour from a
`.mjs`) is *not implemented* in MyST, so rich *interactive* rendering belongs in
a **theme**, not the plugin.

```
astra.yaml + universes/ + results/        index.md (+ sub-analysis pages)
        │  (data, single source)                  │  (composition, single source)
        └──────────────┬───────────────────────────┘
                       ▼
                  MySTRA plugin
   · directives → block ASTRA components as stock MyST AST (book-theme baseline)
   · roles      → inline reference tokens (neutral: class + id + label) + value interpolation
   · transforms → anchor grammar; emit the resolved ASTRA store (keyed by id)
                       ▼
        stock `myst` engine → content JSON → stock content server
                       ▼
  book-theme (baseline, readable)   OR   a rich ASTRA theme
                                         · NodeRenderers keyed on astra-* classes
                                         · reads the resolved store → cards, graphs, layouts
```

## 3. The ASTRA → MyST AST projection

The plugin reads the project once per `(root, universe)` (cached) and resolves a
**scope** for each placed component path: it splits leading sub-analysis
segments (`reconstruction.algorithm` → walk into `analyses.reconstruction`) from
the trailing id, narrows the universe to each sub-analysis's selections, and
binds a prose parser so anchor grammar resolves within rendered prose.

### Directive node mapping

| Directive | Emitted MyST AST | Identifier carrier | Recognition class |
|---|---|---|---|
| `astra:decision <id>` | `heading`(h4) + `details`/`summary` + `tabSet`/`tabItem` per option (selected ●) | `decision-<id>` (heading) | `astra-decision` |
| `astra:output <id>` (figure) | `container`(figure) + `image` + `caption`, then a collapsed provenance `details` | `output-<id>` (container) | `astra-output astra-output--figure` |
| `astra:output <id>` (table) | `container`(table) + `table` + `caption`, then provenance | `output-<id>` | `astra-output astra-output--table` |
| `astra:output <id>` (metric/data/report) | inline labelled reference + provenance | `output-<id>` | `astra-output astra-output--<type>` |
| `astra:finding <id>` | `heading`(h3) + notes + scope + evidence (`:compact:` = claim/notes/scope only) | `finding-<id>` | `astra-finding` |
| `astra:prior-insight <id>` | `admonition`(seealso): claim + evidence | `prior_insight-<id>` | `astra-prior-insight` |
| `astra:inputs [scope]` | inputs registry `table` (rows carry `input-<id>`) | — | `astra-inputs` |
| `astra:outputs [scope]` | outputs registry `table` (row ids stripped — the rich block owns `output-<id>`) | — | `astra-outputs` |
| `astra:subanalysis <id>` | `card` linking to the sub-page (`/<sub>`) | `analysis-<id>` | `astra-subanalysis` |

Every block carries its `astra-<kind>` class on the node bearing its
`<kind>-<id>` identifier (the **recognition marker** — see §5). All AST is
**neutral**: only semantic classes, text, and identifiers — no glyphs, colours,
or inline styles. (Where a `style` is set it is a JS object; a string crashes
the React renderer.)

### Role node mapping

| Role | Emitted AST |
|---|---|
| `astra:decision|output|finding|prior-insight|analysis <path>[\|display]` | `span.astra-ref.astra-ref--<kind>` → `span.astra-ref__label` (label) + `span.astra-card.astra-card--<kind>` (hidden preview card) |
| `astra:value <output> col=<c> [k=v …] [pm] [err=<c>] [sig=N]` | `span.astra-ref--value` token whose label is the **interpolated cell** read from the result file, with a card naming source/column/row |

The preview card is emitted with an inline `display:none`, so a bare viewer
(plugin only, no theme CSS) shows just the clean label and never spills the card
content inline. A theme/stylesheet reveals it on hover.

The `astra:value` role guarantees **no measured number is hard-typed**: it reads
the materialised CSV/JSON for the output, filters rows by `key=val`, formats the
cell to `sig` significant figures, and appends `± <err>` when `pm` (uses
`<col>_std`) or `err=<col>` is given. A missing column/row/file renders a clear
inline-code error, never a silent wrong number.

### Transforms

- **`astra-anchor-grammar`** (document stage) rewrites ASTRA tree-path anchor
  links the author writes directly (`[t](#decisions.x)`, `#outputs.y`,
  `#analyses.sub.outputs.z`) into `crossReference`s (same page) or sub-page
  links, reusing the narrative parser's resolver. Page scope is derived from the
  file basename (`index` → root; `<name>` → the `<name>` sub-analysis).
- **`astra-resolved-store`** (document stage) emits the resolved store (§5).

## 4. Composition & scope

The author owns composition: the directive/role vocabulary *is* the degrees of
freedom. The plugin never injects an element the author didn't place. MyST
handles prose, math, figures, numbering, cross-references, the table of
contents, and search.

Sub-analyses are **separate pages** (`reconstruction.md`, `clustering.md`),
mirroring ASTRA's recursive analysis tree. A component path is `<id>` (root) or
`<sub>.<id>` (nested, may chain `a.b.id`); the resolver walks the analyses tree
and the matching sub-universe, accumulating the results base from each
sub-analysis's `path:`.

## 5. The resolved data store (for rich themes)

Because the theme cannot read `astra.yaml`, the plugin bakes a **resolved**
projection of each page's analysis scope into the build, keyed by id, on a
hidden carrier node:

```
{ type: 'div', class: 'astra-store', identifier: 'astra-store',
  style: { display: 'none' }, data: { astra: ResolvedStore }, children: [] }
```

`ResolvedStore` (`src/transform/resolved-store.ts`) contains, all keyed by id:

- **outputs** — resolved `type`, `label`, `description`, **project-relative**
  `resolved_path`, `recipe` (command/container), `inputs`, `decisions`, `from`,
  and inlined `table_data` (parsed rows for tables) / `metric` (scalar/tuple/
  object for metrics). `from:` chains are walked, so the view is resolved.
- **inputs** — with aliased (`from:`) inputs resolved against ancestor scopes.
- **decisions** — `rationale`, all `options`, and the `selected` option under
  the active universe.
- **findings**, **prior_insights** (claim + first DOI/quote), **subanalyses**
  (name, summary, page url, decision/output counts).

A rich theme selects a placed node by its `identifier`/`astra-*` class and joins
it to the matching store entry (the proven `mergeRenderers` +
`unist-util-select` pattern) — recognition + data without re-reading
`astra.yaml` and without per-node duplication.

**Delivery is verified.** Node `data` survives the engine's serialization into
content JSON (confirmed by building the `prototype/` project: the `astra-store`
carrier and its `data.astra` appear intact in `content/index.json`, scoped per
page). MyST's asset pipeline rewrites the plugin's project-relative image paths
into hashed copied assets.

## 6. Citations

Delegated to MyST, which resolves DOIs and renders the reference list natively.
MySTRA carries **no DOI subsystem** of its own: DOI evidence renders as a plain
`doi.org` link, and inline cards show the bare DOI as their citation hint.
Wiring a project bibliography — so MyST renders author–year labels and a linked
reference list — is the clean follow-up.

## 7. The ASTRA data model

MySTRA leans on the official **`@astra-spec/sdk`** package, not just for the
data model but for the spec mechanics it would otherwise re-implement:
- **types** — imported directly by their SDK names (`Analysis`, `Decision`,
  `Output`, …; `import type`, erased at runtime). MySTRA defines none of its own
  and has no `types/` module;
- **YAML + tree resolution** — `src/loader.ts` parses `astra.yaml` and inlines
  `path:` sub-analyses with the SDK's `loadYaml` + `resolveAnalysisTree` (which
  preserves each sub's `path:`, so its results base stays computable);
- **`when`-condition evaluation** — `isConditionMet` (used to decide whether a
  decision renders) is the SDK's, not a local copy.

The SDK is the single source of truth — bump it with `npm update` rather than
editing by hand. (MySTRA keeps `js-yaml` out entirely; the SDK's `yaml` is the
one parser.) An **Analysis** is recursive
(`analyses`), with `inputs`, `outputs`, `decisions`, `prior_insights`,
`findings`, and a five-section `narrative`. **Output** is the unit of provenance
(`inputs`, `decisions`, `recipe`; `from:` re-export aliases inherit the source's
fields). **Findings** and **prior_insights** share the `Insight` model (`claim`,
`evidence`, `scope`, `label`). A **Universe** selects one option per decision and
nests selections for sub-analyses; `src/loader.ts` loads one (by `name`, else the
first under `universes/`). Result artifacts are **not** scanned — each output's file is
resolved on demand from the deterministic convention
`[<analysis path>/]results/<universe>/<id>/`, preferring `<id>.<ext>` (the
recipe-chosen extension is the only part not fixed by the spec). See §7.1.

### 7.1 Output-path resolution

astra-spec leaves an output's on-disk path to the runner (`{output}` is a recipe
placeholder). lightcone-cli, the runner, fixes the *directory*:
`[<analysis path>/]results/<universe>/<output_id>/` — so MySTRA computes it
deterministically from the analysis's `path:` chain, the universe, and the
output id, and never scans the results tree or guesses ids from filenames. The
one thing the spec doesn't fix is the file *name* inside that directory (the
recipe writes it), so `resolveArtifact` (`src/loader.ts`) reads that one
directory, preferring `<id>.<ext>`, else the first regular file (dotfiles —
including lightcone's `.lightcone-manifest.json` — skipped). Resolution is lazy:
each scope carries an `ArtifactResolver` bound to its results base + universe,
and an output is resolved only when actually rendered.

## 8. Non-goals

- No bespoke content server, live data sidecar, or per-node data duplication —
  one store, referenced by id; `myst start` provides serving and reload.
- No baked presentation in the AST (beyond the minimal default-hide for the
  theme-only preview card).
- No speculative pattern widgets (DAG, gallery) until an author needs the
  directive; the store is what makes them possible.
- Rich interactive rendering lives in a separate `lightcone-astra` theme, not
  the plugin.

## 9. Open questions

- **`astra.yaml` live reload.** `myst start` watches Markdown, not `astra.yaml`,
  and the plugin caches the parse; editing the spec needs a restart. A watch
  hook or cache invalidation is a possible follow-up.
- **Citation bibliography.** Emit a generated `references.bib` / project
  bibliography so MyST links the reference list.
- **Packaging & the theme.** Publish the plugin (working name
  `@lightcone/astra-myst`) and build the `lightcone-astra` theme (its stylesheet
  seeded by `prototype/custom.css`).
