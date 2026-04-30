# MySTRA — Live ASTRA Document Rendering via MyST

> Tracks **astra-spec v0.0.7** (commit `ed13f48`). Notable v0.0.6→v0.0.7
> deltas reflected in the transform's type surface (`src/types/astra.ts`):
> `Output.inputs` and `Output.decisions` now carry the per-output
> provenance contract (PR #19); `Recipe` shrinks to pure *how*
> (`command`, `resources`, `container`); `Resources` gains `disk`. The
> Recipe template grammar (`{inputs.<id>}`, `{decisions.<id>}`,
> `{output}`) is the runner's substitution surface, not MySTRA's.
> Earlier v0.0.5→v0.0.6 deltas — structured `Analysis.narrative` with
> tree-path anchor grammar, `container_build` collapsed into
> `container`, `from_ref` renamed to `from`, optional `label` on
> `Input`/`Output`/`Insight`, reserved-keyword ID exclusions — remain
> in force.

## 1. Goal

Render an ASTRA analysis (`astra.yaml` + `universes/` + `results/`) as a live, browsable structured document using MyST's rendering infrastructure. The document updates automatically when the spec, universe selections, or results change on disk (typically because an agent modified them).

### Guiding principle

Reuse existing MyST ecosystem packages wherever possible. The MyST project (MIT-licensed) provides well-tested utilities for AST types, citation resolution, React rendering, and theming. We should import and use these directly rather than reimplementing. Custom code should be limited to the ASTRA-specific transform and the thin content server.

## 2. Architecture

### How MyST works internally

MyST uses a content/theme separation:

```
[Content Server :3100]  ←────  [Theme Server :3000]  ────→  Browser
  serves JSON AST                fetches JSON AST
  per-page content               renders via myst-to-react
  config, xrefs                  sidebar, navigation, styling
```

The **content server** exposes:
- `GET /config.json` — site metadata, table of contents
- `GET /content/{slug}.json` — page AST + frontmatter
- `GET /myst.xref.json` — cross-reference index
- `WS /socket` — WebSocket for live reload notifications

The **theme server** (book-theme) is a Remix app that fetches JSON from the content server and renders it with `myst-to-react`. It has no knowledge of the source format.

### The key insight

The theme doesn't care where the JSON AST came from. We replace the content server with one that transforms ASTRA directly into MyST AST JSON. The theme works identically.

### Architecture

```
                    ┌──────────────────────────────┐
                    │     File System Watcher       │
                    │  watches: astra.yaml,         │
                    │  universes/*.yaml,             │
                    │  results/**/*                  │
                    └──────────┬───────────────────┘
                               │ on change
                               ▼
┌─────────────┐     ┌─────────────────────────┐     ┌──────────────┐
│ astra.yaml  │────▶│   ASTRA → AST Transform  │────▶│ Content API  │
│ universes/  │     │                           │     │  :3100       │
│ results/    │     │  Reads ASTRA spec          │     │              │
│             │     │  Reads universe selections  │    │ /config.json │
│             │     │  Reads result artifacts     │    │ /content/*.json
│             │     │  Produces MyST AST JSON     │    │ /myst.xref.json
│             │     │                             │    │ WS /socket   │
└─────────────┘     └─────────────────────────────┘   └──────┬───────┘
                                                              │
                                                              │ fetch JSON
                                                              ▼
                                                     ┌──────────────┐
                                                     │  Theme :3000  │
                                                     │  (book-theme) │
                                                     │  unmodified   │
                                                     │               │
                                                     │  myst-to-react│
                                                     │  renders AST  │
                                                     │  as React     │
                                                     └──────┬───────┘
                                                              │
                                                              ▼
                                                          Browser
```

### Why direct AST generation (not markdown)

We generate MyST AST JSON directly rather than generating MyST markdown because:

1. **No syntax fragility** — Nested MyST directives require careful fence-depth management (`:::` vs `::::` vs `::::::`). AST nodes are just objects; nesting is trivial.
2. **Tree-to-tree is natural** — ASTRA is a tree (Analysis → Decision → Option → Insight → Evidence). The MyST AST is a tree. The transform is a direct structural mapping.
3. **The content server API is small** — Only 4 endpoints. The page content endpoint just returns a JSON object.
4. **Extensible** — We can add custom AST node types if needed and register renderers for them.

DOI auto-resolution (which MyST's markdown parser provides for free) is handled by fetching citation metadata in the content server as a background enrichment step.

## 3. The ASTRA → MyST AST transform

### Node type mapping

| ASTRA Concept | MyST AST Node(s) |
|---|---|
| Analysis (root) | `root` + flat children carrying `<kind>-<id>` identifiers |
| Narrative section (summary, findings, methods, inputs, outputs) | block-level mdast carrying `narrative-<section>` on its first child |
| Narrative anchor `[t](#path.to.element)` | `crossReference` (resolved) or `link` (unresolved / parent-escape) |
| Universe banner | `details` + `summary` + decision-summary `table` |
| Finding | `heading` (h3) carrying `finding-<id>` + author notes + evidence |
| Finding evidence (DOI) | `blockquote` + `paragraph` with `cite` (or plain `link` fallback) |
| Finding evidence (artifact, Output.type=figure) | `container` (kind: figure) + `image` + `caption` (caption parses Output.description) |
| Finding evidence (artifact, Output.type=table) | `details` + `summary` + `table` (JSON / CSV body) |
| Finding evidence (artifact, Output.type=metric/data/report) | inline labelled reference + optional quote |
| Prior insight | `heading` (h3) carrying `prior_insight-<id>` + scope + evidence body |
| Decision | `heading` (h4) carrying `decision-<id>` + `details` + `summary` |
| Decision options | `tabSet` + `tabItem` per option |
| Option supporting insights | `crossReference` to `prior_insight-<id>` (no inline expansion) |
| Insight quote | `blockquote` + `paragraph` |
| DOI reference | `cite` / `citeGroup` (or `link` fallback when uncached) |
| Input | `tableRow` carrying `input-<id>` |
| Output | `tableRow` carrying `output-<id>` |
| Output provenance (Output.inputs / Output.decisions) | `container` (kind: output-provenance) carrying `output-<id>-provenance` + `data.{outputId, inputs, decisions, from, unresolved}` + inline `crossReference` chips for each input / decision |
| Sub-analysis | Separate page + `card` (carrying `analysis-<id>`) in parent |

### Document structure

The transform produces a **flat sequence of addressable blocks** for
each analysis page. There are no programmatic h2 section headings
("Findings", "Methods", "Data Sources", "Sub-Analyses"); narrative
sections, structural elements, and sub-analysis cards all sit at the
same depth. Themes and downstream renderers (paper view, dashboard,
DAG, …) compose layouts however they like by looking up
`identifier` attributes — MySTRA imposes no narrative around the
data.

Block-emission order is the spec-declared default:

```
Root
├── narrative.summary        block-level mdast, first child id=narrative-summary
├── narrative.findings       block-level mdast, first child id=narrative-findings
├── narrative.methods        …
├── narrative.inputs         …
├── narrative.outputs        …
├── Universe banner          details/summary + decision-summary table
├── Findings (flat)          one h3 per finding; tags ride on heading.data.tags
├── Prior insights (flat)    one h3 per prior_insight (xref carrier for option-tab refs)
├── Decisions (flat)         one h4 + details + tabSet per rendered decision
├── Inputs table             one row per input, carrying input-<id>
├── Outputs table            one row per output, carrying output-<id>
├── Output provenance        one container per Output with non-empty
│                            inputs/decisions (after `from:` resolution),
│                            carrying output-<id>-provenance
└── Sub-analysis cards       one card per nested analysis, carrying analysis-<id>
```

A decision drops out of the page (and the xref index) if it's a bare
`from`-reference or its `when` predicate is unmet under the active
universe. The xref contract is "every published id has a real
carrier in the rendered AST"; collectIdentifiers and the renderers
agree on which ids are live.

### AST examples

**A finding with inline figure and methodology cross-references:**

```json
[
  {
    "type": "heading",
    "depth": 3,
    "identifier": "finding-1",
    "label": "finding-1",
    "data": { "tags": ["trgb", "magnitude"] },
    "children": [
      { "type": "text", "value": "1. " },
      { "type": "text", "value": "B-sequence SARGs are the best TRGB standard candles" }
    ]
  },
  {
    "type": "paragraph",
    "children": [{ "type": "text", "value": "The TRGB magnitude hierarchy is consistent across both galaxies..." }]
  },
  {
    "type": "container",
    "kind": "figure",
    "children": [
      { "type": "image", "url": "/static/trgb_hierarchy_figure.png", "alt": "TRGB hierarchy" },
      {
        "type": "caption",
        "children": [
          {
            "type": "paragraph",
            "children": [
              { "type": "text", "value": "M_I vs mean (V-I)_0 for all samples in " },
              { "type": "crossReference", "identifier": "input-lmc",
                "children": [{ "type": "text", "value": "LMC" }] },
              { "type": "text", "value": " and SMC." }
            ]
          }
        ]
      }
    ]
  }
]
```

The figure caption parses through myst-parser with the v0.0.6
narrative anchor grammar — `[LMC](#inputs.lmc)` becomes a
`crossReference`, not glued text. The figure container itself
carries no `identifier`; the structural `output-<id>` carrier
lives on the per-output row in the outputs table. Renderer-imposed
"Methodology" admonitions and "This finding depends on…" glue are
gone; explicit relations route through anchor grammar in the
author's notes / claim / methods narrative.

**A decision as a collapsible dropdown with option tabs:**

```json
{
  "type": "details",
  "open": false,
  "children": [
    {
      "type": "summary",
      "children": [
        { "type": "strong", "children": [{ "type": "text", "value": "R_V for SMC" }] },
        { "type": "text", "value": " — selected: R_V = 2.7" }
      ]
    },
    { "type": "paragraph", "children": [{ "type": "text", "value": "R_V controls extinction coefficients..." }] },
    {
      "type": "tabSet",
      "children": [
        {
          "type": "tabItem",
          "title": "R_V = 2.7 ●",
          "children": [
            { "type": "paragraph", "children": [{ "type": "text", "value": "SMC average from Bouchet+1985..." }] },
            {
              "type": "details",
              "children": [
                { "type": "summary", "children": [{ "type": "text", "value": "Evidence (3 insights)" }] },
                { "type": "paragraph", "children": [
                  { "type": "strong", "children": [{ "type": "text", "value": "Gordon et al. (2003)" }] },
                  { "type": "text", "value": " — " },
                  { "type": "link", "url": "https://doi.org/10.1086/376774", "children": [{ "type": "text", "value": "10.1086/376774" }] }
                ]},
                { "type": "blockquote", "children": [
                  { "type": "paragraph", "children": [{ "type": "text", "value": "For the SMC Bar, we find that RV = 2.74 ± 0.13..." }] }
                ]}
              ]
            }
          ]
        },
        {
          "type": "tabItem",
          "title": "R_V = 3.3 ○",
          "children": [ "..." ]
        }
      ]
    }
  ]
}
```

### Transform implementation

```typescript
interface ASTRASource {
  analysis: ASTRAAnalysis       // parsed astra.yaml
  universe: ASTRAUniverse       // active universe selections
  results: Map<string, string>  // output_id → file path (if produced)
  projectDir: string            // root of the ASTRA project (DOI cache lives here)
  slug: string                  // the host page's slug (anchor resolution context)
}

function astraToMystAST(source: ASTRASource): Root {
  const { analysis, universe, results, projectDir, slug } = source

  // Bound once per page: prose parser threads anchor resolution
  // into every render-* helper; tabItem factory mints stable keys
  // per transform pass; doiCacheDir replaces the prior module-
  // global; outputsById feeds artifact-evidence dispatch.
  const prose = makeProseParser({ analysis, slug })
  const tabItem = makeTabItem()
  const doiCacheDir = join(projectDir, '.mystra-cache', 'doi')
  const outputsById = new Map((analysis.outputs ?? []).map(o => [o.id, o]))

  return {
    type: 'root',
    children: [
      blockBreak(),

      // Narrative chunks — each section is an addressable block at
      // narrative-<section>; first child of the parsed mdast carries
      // the identifier. Spec-declared order (summary → outputs).
      ...renderNarrativeChunks(analysis, slug).flatMap(c => c.mdast),

      // Universe banner — orientation for the active selections.
      renderUniverseBanner(universe, analysis.decisions, prose),

      // Flat structural elements — no surrounding section headings.
      ...renderFindings(analysis.findings, results, outputsById, prose, doiCacheDir),
      ...renderPriorInsights(analysis.prior_insights, prose, doiCacheDir),
      ...renderMethodsSections(analysis.decisions, analysis.prior_insights,
                               universe, prose, tabItem, doiCacheDir),
      ...(analysis.inputs?.length ? [renderInputsTable(analysis.inputs, prose)] : []),
      ...(analysis.outputs?.length ? [renderOutputsTable(analysis.outputs, prose)] : []),
      ...(analysis.analyses ? renderSubAnalysisCards(analysis.analyses, slug) : []),
    ]
  }
}
```

**`renderFindings`** — flat per-finding blocks. Each finding gets an
h3 heading carrying `finding-<id>` (with tags on `data.tags`),
notes prose parsed via myst-parser, scope, and evidence blocks.
No tag-overlap-derived crossReferences and no "depends on" glue;
explicit relations are the author's job through narrative anchors.

**`renderEvidenceBlock`** — for DOI evidence, emits citation +
optional quote. For artifact evidence, looks up the referenced
output by id and dispatches on `Output.type`: `figure` →
image+caption (caption parses Output.description with anchor
resolution); `table` → JSON/CSV table render; metric/data/report →
labelled inline reference. Broken artifact references emit a
`console.warn`.

**`renderPriorInsights`** — flat per-insight blocks parallel to
findings. Each prior_insight gets an h3 carrier identified by
`prior_insight-<id>` so it's addressable from anywhere on the
page (option tabs cross-reference back to it instead of expanding
inline).

**`renderMethodsSections`** — flat per-decision blocks. Each
decision renders as an h4 heading (carrying `decision-<id>`)
followed by a `details` dropdown with rationale and a `tabSet` of
options. The selected option (from the active universe) is marked
with ●. Option supporting-insight references emit
`crossReference` nodes pointing at the prior_insight flat-block
carrier, not inline expansions. Decision tags survive on the
heading's `data.tags` slot.

## 4. Content server

### Endpoints

```
GET  /config.json           Site config + table of contents
GET  /content/{slug}.json   Page AST + frontmatter
GET  /myst.xref.json        Cross-reference index
GET  /static/*              Result images and files
WS   /socket                Live reload notifications
```

**`/config.json`:**

```json
{
  "id": "mystra",
  "title": "Analysis Name",
  "projects": [{
    "slug": ".",
    "index": "index",
    "pages": [
      { "slug": "index", "title": "Analysis Name" },
      { "slug": "sub-analysis-id", "title": "Sub-Analysis Name" }
    ]
  }]
}
```

**`/content/{slug}.json`:**

```json
{
  "kind": "Article",
  "sha256": "content-hash-for-cache-invalidation",
  "slug": "index",
  "mdast": { "type": "root", "children": [...] },
  "frontmatter": {
    "title": "Analysis Name",
    "authors": [{ "name": "Author Name" }],
    "tags": ["tag1", "tag2"],
    "description": "First paragraph of narrative.summary, plain text."
  },
  "references": {},
  "dependencies": ["results/figure.png"]
}
```

**`/myst.xref.json`:**

```json
{
  "version": "1",
  "references": [
    { "identifier": "finding-1", "kind": "heading", "data": "/content/index.json", "url": "/" },
    { "identifier": "sample-construction", "kind": "heading", "data": "/content/index.json", "url": "/" }
  ]
}
```

### Static file serving

Result images are served from the active universe's results directory:

```typescript
app.use('/static', express.static(
  path.join(projectDir, 'results', activeUniverse)
))
```

Image URLs in the AST reference `/static/figure_name.png`.

### File watching and live reload

```typescript
const watcher = watch([
  'astra.yaml',
  'universes/*.yaml',
  'results/**/*.{png,jpg,csv,json}'
], { ignoreInitial: true })

watcher.on('all', () => {
  source = loadASTRASource(projectDir)
  pageCache.clear()
  wsBroadcast({ type: 'reload' })
})
```

The content server caches generated AST per page. On any file change, the cache is cleared and connected browsers are notified via WebSocket to refetch.

## 5. Sub-analyses

ASTRA's self-similar structure maps to a multi-page MyST site. Each analysis node becomes its own page.

**URL structure:**
```
/                    → root analysis
/preprocessing       → sub-analysis "preprocessing"
/training            → sub-analysis "training"
/training/validation → nested sub-analysis
```

**Page generation is recursive:**

```typescript
function buildPages(analysis: Analysis, universe: Universe, basePath = ''): Page[] {
  const pages: Page[] = []

  pages.push({
    slug: basePath || 'index',
    ast: astraToMystAST({ analysis, universe, results: loadResults(basePath) })
  })

  if (analysis.analyses) {
    for (const [id, sub] of Object.entries(analysis.analyses)) {
      const subPath = basePath ? `${basePath}/${id}` : id
      const subUniverse = universe.analyses?.[id] ?? { decisions: {} }
      pages.push(...buildPages(sub, subUniverse, subPath))
    }
  }

  return pages
}
```

In the parent page, sub-analyses appear as clickable cards showing the sub-analysis name, the summary section of its narrative, and counts (decisions, inputs, outputs).

## 6. Live reload flow

### Agent edits astra.yaml

```
1. Agent writes to astra.yaml
2. chokidar detects the change
3. Content server re-reads and re-parses astra.yaml
4. Page cache is cleared
5. WebSocket broadcasts { type: "reload" }
6. Browser refetches /content/index.json
7. myst-to-react re-renders the updated AST
```

### New result produced

```
1. A script produces results/baseline/smoothing_stability_figure.png
2. chokidar detects the new file
3. Content server re-runs transform — figure node now has a valid path
4. AST changes: "pending" admonition becomes an actual image
5. WebSocket reload → browser shows the new figure inline
```

## 7. Technology

| Component | Technology |
|---|---|
| Content server | TypeScript + Express |
| ASTRA parsing | `js-yaml` |
| AST construction | TypeScript with `myst-spec` types |
| Citation resolution | `citation-js-utils` (from MyST ecosystem) |
| File watcher | `chokidar` |
| Theme | `myst-theme/book-theme` (unmodified) |
| CSV parsing | `papaparse` |
| Static files | Express static middleware |

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0",
    "chokidar": "^3.6.0",
    "express": "^4.18.0",
    "papaparse": "^5.4.0",
    "ws": "^8.16.0",
    "myst-spec": "^0.0.5",
    "citation-js-utils": "^1.2.0"
  }
}
```

The MyST book-theme is fetched automatically when the theme server starts.

## 8. CLI

```bash
mystra [project-dir]              # Start MySTRA for the given ASTRA project (default: .)
mystra --port 4000                # Custom theme server port
mystra --universe u001            # View a specific universe (default: first in universes/)
```

MySTRA starts two processes:
1. Content server on port 3100
2. MyST book-theme on port 3000

It watches the project directory for changes and keeps the document live.

## 9. Implementation

**Transform flow.** `loadASTRASource(projectDir)` parses `astra.yaml`, picks an active universe from `universes/`, and scans `results/<universeId>/` for produced artifacts. `buildAllPages` walks the analysis tree recursively — one MyST page per node — and `astraToMystAST(source)` produces each page's `root`. The root's `children` are emitted as a flat sequence of addressable blocks: narrative chunks first (in spec-declared order summary → findings → methods → inputs → outputs), then the universe banner, then findings, prior_insights, decisions, the inputs/outputs tables, and sub-analysis cards. There are no programmatic h2 section headings — every structural element sits at the same depth, identified by `<kind>-<id>` so themes and downstream renderers compose layout from carriers rather than from spatial position.

**Render helpers.** Each ASTRA concept has one helper, all in `src/transform/`:

- `renderNarrativeChunks` (`render-narrative.ts`) — parses each non-empty narrative section to mdast and attaches `narrative-<section>` to the section's first node.
- `renderUniverseBanner` — `details`/`summary` over a decision-summary table; the universe id and description form the summary line.
- `renderFindings` — flat per-finding blocks. Each finding gets an h3 heading carrying `finding-<id>` (with tags on `data.tags`), notes prose, scope, and evidence.
- `renderPriorInsights` — flat per-insight `container` carriers (kind `prior-insight`, identifier `prior_insight-<id>`, structured `data`, children `[claim, …evidence]`). Minimal carriers — no heading, no separators — because how to surface prior_insights is a renderer's call.
- `renderMethodsSections` — flat per-decision blocks. Each rendered decision is an h4 heading carrying `decision-<id>` followed by a `details` dropdown with rationale and a `tabSet` of options. The selected option (from the active universe) is marked ●; option supporting-insight references emit `crossReference` nodes pointing at the prior_insight carrier.
- `renderInputsTable` / `renderOutputsTable` — one table each; every row carries `input-<id>` / `output-<id>` so anchors land regardless of evidence references.
- `renderSubAnalysisCards` — one `card` per nested analysis carrying `analysis-<id>` and the sub-analysis's narrative summary.
- `renderEvidenceBlock` (`render-evidence.ts`) — DOI evidence becomes a `cite` (or fallback `link`) with optional quote blockquote; artifact evidence dispatches on the referenced output's `Output.type` (figure → image+caption, table → JSON/CSV table, metric/data/report → labelled inline reference). Broken artifact references emit a `console.warn`.

**Prose and anchor grammar.** All Markdown content (narrative sections, claims, rationales, descriptions, captions, excluded reasons, finding notes) flows through `myst-parser` via the `ProseParser` interface (`src/transform/narrative-parser.ts`). `parseProseBlocks` returns block-level mdast; `parseProseInline` extracts inline phrasing for table cells, captions, and headings. A `ProseParser` is bound once per page to `(analysis, slug)` and threaded into every render helper, so the v0.0.6 anchor grammar `[t](#path.to.element)` resolves everywhere prose appears: `resolveNarrativeAnchors` walks the parsed tree and rewrites in-scope `link` nodes with `#…` URLs into `crossReference` nodes against the corresponding `<kind>-<id>` carrier.

**Stable id-anchor convention.** Every structural element and narrative chunk gets a deterministic identifier: `decision-<id>`, `finding-<id>`, `prior_insight-<id>`, `input-<id>`, `output-<id>`, `analysis-<id>`, `narrative-<section>`. The same identifier is published in `myst.xref.json` and used by the resolver; cross-page anchors (`#analyses.<sub>.outputs.<o>`) translate to the destination page's URL with the corresponding fragment.

**The xref contract.** Every identifier published by `collectIdentifiers` has a real carrier in the rendered AST, and vice versa. Decisions that drop out of the page (bare `from`-references, `when`-unmet under the active universe) are filtered with the same predicate the renderer uses; unreferenced prior_insights still get a carrier; outputs that no evidence cites still get a row. Anchors never land on nothing.

## 10. DOI enrichment and citations

MyST's markdown parser auto-resolves DOIs to full citations via doi.org. Since we bypass the parser, we handle this in the content server.

**Approach:** Import `citation-js-utils` from the MyST ecosystem (MIT-licensed) for citation parsing and rendering. Write a thin DOI fetcher (~30 lines) that requests metadata from `https://doi.org/{doi}` with content negotiation (`Accept: application/x-bibtex`, fallback `application/vnd.citationstyles.csl+json`). Cache results as CSL-JSON on disk.

```typescript
import { getCitationRenderers } from 'citation-js-utils'

// At startup:
// 1. Collect all DOIs from prior_insights + findings evidence
// 2. For each DOI not in cache: fetch from doi.org, save as CSL-JSON
// 3. Use getCitationRenderers() to produce formatted HTML
// 4. Build the references object for the page response

const references = {
  cite: {
    order: ["Gordon_2003", "Rizzi_2007", ...],
    data: {
      "Gordon_2003": {
        label: "Gordon_2003",
        enumerator: "1",
        doi: "10.1086/376774",
        html: "Gordon, K. D., Clayton, G. C., ... (2003). <i>ApJ</i>, 594(1), 279–293."
      }
    }
  }
}
```

This gives us the auto-generated References section and proper citation formatting that the book-theme renders at the bottom of each page.

**Dependencies:** `citation-js-utils` (from MyST monorepo, published on npm).

## 11. Open questions

1. **Tab AST nodes**: Verify that `tabSet`/`tabItem` nodes work correctly when produced programmatically (vs. parsed from MyST markdown). If not, fall back to nested `details`/`summary` elements.

2. **Content server API surface**: The spec above covers the known endpoints. The exact JSON shapes should be validated against the book-theme's actual fetch calls. The practical approach is to run `myst start` on a real MyST project, inspect the network requests in the browser, and match them exactly.
