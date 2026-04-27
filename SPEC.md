# MySTRA — Live ASTRA Document Rendering via MyST

> Tracks **astra-spec v0.0.6** (commit `1d948cf`). Notable v0.0.5→v0.0.6
> deltas reflected in the transform: `Analysis.description` is replaced
> by a structured `Analysis.narrative` with five Markdown sections and
> tree-path anchor grammar; `container_build` is folded into a single
> string `container` field; `Input.from_ref` is now `Input.from`;
> `Input`/`Output`/`Insight` carry an optional `label` for compact
> handles; reserved-keyword IDs are forbidden upstream.

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
| Analysis (root) | `root` + `heading` (h1) |
| Analysis narrative (summary section) | `paragraph` |
| Narrative anchor `[t](#path.to.element)` | `crossReference` (resolved) or `link` (unresolved) |
| Universe banner | `admonition` (kind: tip) |
| Finding claim | `heading` (h3) + `paragraph` |
| Finding evidence (figure) | `container` (kind: figure) + `image` + `caption` |
| Finding evidence (table) | `table` + `tableRow` + `tableCell` |
| Finding → method link | `admonition` (kind: seealso) + `crossReference` |
| Decision group heading | `heading` (h3) |
| Decision | `heading` (h4) + `details` + `summary` |
| Decision options | `tabSet` + `tabItem` per option |
| Option description | `paragraph` inside tab |
| Option evidence | Nested `details` (collapsible) |
| Insight quote | `blockquote` + `paragraph` |
| DOI reference | `link` (url: `https://doi.org/...`) |
| Input | `tableRow` |
| Output (produced) | `image` or `table` |
| Output (pending) | `admonition` (kind: warning) |
| Sub-analysis | Separate page + `card` link in parent |

### Document structure

The transform produces this document structure for each analysis page:

```
Root
├── Abstract (paragraphs from narrative.summary)
├── Universe banner (admonition: tip)
├── Findings (h2)
│   ├── Finding 1 (h3)
│   │   ├── Narrative (paragraph)
│   │   ├── Evidence figure/table (container/table)
│   │   ├── Supporting data (dropdown with table)
│   │   └── Methodology callout (admonition: seealso → cross-refs to Methods)
│   ├── Finding 2 (h3)
│   │   └── ...
│   └── ...
├── Methods (h2)
│   ├── Section by concern, e.g. "Reddening & Extinction" (h3)
│   │   ├── Decision: "R_V for SMC" (h4 + details/summary)
│   │   │   ├── Rationale (paragraph)
│   │   │   └── Options (tabSet)
│   │   │       ├── Tab: "R_V = 2.7 ●" with evidence dropdown
│   │   │       └── Tab: "R_V = 3.3 ○" with evidence dropdown
│   │   └── Decision: "Reddening cut" (h4 + details/summary)
│   │       └── ...
│   ├── "Sample Construction" (h3)
│   │   └── ...
│   └── ...
├── Data Sources (h2)
│   └── Inputs table
└── Sub-Analyses (h2, if any)
    └── Cards linking to child pages
```

### AST examples

**A finding with inline figure and methodology cross-references:**

```json
[
  {
    "type": "heading",
    "depth": 3,
    "identifier": "finding-1",
    "children": [{ "type": "text", "value": "1. B-sequence SARGs are the best TRGB standard candles" }]
  },
  {
    "type": "paragraph",
    "children": [{ "type": "text", "value": "The TRGB magnitude hierarchy is consistent across both galaxies..." }]
  },
  {
    "type": "container",
    "kind": "figure",
    "identifier": "fig-hierarchy",
    "children": [
      { "type": "image", "url": "results/trgb_hierarchy_figure.png" },
      {
        "type": "caption",
        "children": [
          { "type": "strong", "children": [{ "type": "text", "value": "Figure 13" }] },
          { "type": "text", "value": " — M_I vs mean (V-I)_0 for all samples in LMC and SMC." }
        ]
      }
    ]
  },
  {
    "type": "admonition",
    "kind": "seealso",
    "children": [
      { "type": "admonitionTitle", "children": [{ "type": "text", "value": "Methodology" }] },
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "This finding depends on: " },
          { "type": "crossReference", "identifier": "sample-construction", "children": [{ "type": "text", "value": "Sample Construction" }] },
          { "type": "text", "value": " and " },
          { "type": "crossReference", "identifier": "trgb-detection", "children": [{ "type": "text", "value": "TRGB Detection" }] }
        ]
      }
    ]
  }
]
```

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
  analysis: ASTRAFile           // parsed astra.yaml
  universe: Universe            // active universe selections
  results: Map<string, string>  // output_id → file path (if produced)
}

function astraToMystAST(source: ASTRASource): Root {
  const { analysis, universe, results } = source

  return {
    type: 'root',
    children: [
      ...renderAbstract(analysis),
      renderUniverseBanner(universe),

      sectionHeading(2, 'Findings', 'findings'),
      ...Object.values(analysis.findings).flatMap((finding, i) =>
        renderFinding(finding, i + 1, results, analysis.decisions)
      ),

      sectionHeading(2, 'Methods', 'methods'),
      ...renderMethodsSections(analysis.decisions, analysis.prior_insights, universe),

      sectionHeading(2, 'Data Sources', 'data-sources'),
      renderInputsTable(analysis.inputs),

      ...(analysis.analyses
        ? [sectionHeading(2, 'Sub-Analyses', 'sub-analyses'),
           ...renderSubAnalysisCards(analysis.analyses)]
        : []),
    ]
  }
}
```

**`renderFinding`** — produces heading, narrative, evidence (inline figure/table from results if available, or a "pending" admonition if not), and a methodology callout with cross-references to relevant method sections.

**`renderMethodsSections`** — groups decisions by their first tag into method sections (e.g., all decisions tagged `reddening` go under "Reddening & Extinction"). Each decision renders as a `<details>` dropdown with a `<tabSet>` of options inside. The selected option (from the active universe) is marked with ●.

### Organizing decisions into method sections

Decisions are grouped by their `tags` field. A configurable mapping converts tags to human-readable section headings:

```typescript
const TAG_TO_SECTION: Record<string, string> = {
  'reddening': 'Reddening & Extinction',
  'extinction': 'Reddening & Extinction',
  'sample-selection': 'Sample Construction',
  'foreground': 'Sample Construction',
  'trgb-algorithm': 'TRGB Detection Algorithm',
  'data-processing': 'Data Quality & Processing',
  'photometry': 'Data Quality & Processing',
  'metallicity': 'Calibration & Systematics',
  'calibration': 'Calibration & Systematics',
  'spatial-analysis': 'Calibration & Systematics',
  'uncertainty': 'Calibration & Systematics',
}
```

Decisions with tags not in the mapping fall under "Other". Decisions with no tags are grouped under "General".

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
    "subtitle": "ASTRA Analysis",
    "authors": [{ "name": "Author Name" }],
    "tags": ["tag1", "tag2"]
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

## 9. Implementation plan

### Phase 1: Transform

Implement `astraToMystAST()` and all the render functions:
- `renderAbstract`, `renderUniverseBanner`
- `renderFinding` (heading, narrative, evidence figure/table, methodology callout)
- `renderMethodsSections` (group by tags, render each decision as dropdown + tabs)
- `renderInputsTable`, `renderSubAnalysisCards`
- AST helper functions: `heading()`, `paragraph()`, `text()`, `strong()`, `link()`, `details()`, `summary()`, `tabSet()`, `tabItem()`, `admonition()`, `figure()`, `table()`, `crossReference()`, `blockquote()`, `separator()`

Test with the TRGB analysis `astra.yaml`.

### Phase 2: Content server

- Express server implementing the 4 endpoints + static file serving
- DOI enrichment: fetch citation metadata at startup, cache on disk
- File watcher with WebSocket reload
- Page cache with invalidation
- Verify end-to-end with the MyST book-theme

### Phase 3: Sub-analyses and polish

- Recursive page generation
- Table of contents reflecting analysis tree
- Sub-analysis cards in parent pages
- CLI entry point (`mystra` command)

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
