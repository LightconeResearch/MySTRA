# Spec: Live ASTRA Document Rendering via MyST

## 1. Goal

Render an ASTRA analysis (`astra.yaml` + `universes/` + `results/`) as a live, browsable structured document — using MyST's rendering infrastructure. The document updates automatically whenever the ASTRA spec, universe selections, or results change on disk (typically because an agent modified them).

## 2. Architecture

### How MyST works internally

MyST uses a **content/theme separation**:

```
[Content Server :3100]  ←────  [Theme Server :3000]  ────→  Browser
  serves JSON AST                fetches JSON AST
  per-page content               renders via myst-to-react
  config, xrefs, search          sidebar, navigation, styling
```

The **content server** exposes:
- `GET /config.json` — site metadata, table of contents, project config
- `GET /content/{slug}.json` — page AST + frontmatter for each page
- `GET /myst.xref.json` — cross-reference index
- `WS /socket` — WebSocket for live reload notifications

The **theme server** (book-theme) is a Remix app that fetches from the content server and renders React components using `myst-to-react`. It has no knowledge of the source format — it only sees JSON AST.

### The key insight

The theme doesn't care where the JSON AST came from. Normally MyST parses `.md` files into AST. But we can **replace the content server** with one that transforms ASTRA directly into the same JSON AST format. The theme works identically — it just fetches and renders JSON.

### Proposed architecture

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
│ insights    │     │  Reads universe selections  │    │ /config.json │
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
                                                     │               │
                                                     │  myst-to-react│
                                                     │  renders AST  │
                                                     │  as React     │
                                                     └──────┬───────┘
                                                              │
                                                              ▼
                                                          Browser
```

## 3. Two implementation approaches

### Approach A: Generate MyST Markdown, use full MyST pipeline

```
astra.yaml ──→ generator ──→ .md file(s) ──→ myst start ──→ browser
```

**How it works:**
1. A generator script reads `astra.yaml` and produces MyST markdown (like the prototype we built)
2. A file watcher on `astra.yaml` re-runs the generator when anything changes
3. `myst start` watches the `.md` files and live-reloads the browser

**Pros:**
- Simplest to build — the generator is string interpolation into markdown
- Full MyST pipeline for free: DOI resolution, citation generation, cross-reference resolution, search indexing, PDF export
- Debugging is easy — you can read the generated `.md` file
- The generator can be written in any language (Python fits the ASTRA ecosystem)

**Cons:**
- Markdown is a lossy intermediate format — deeply nested directives are fragile (we hit this with fence depth issues)
- Two-step file watching (astra.yaml → .md → browser) adds latency
- Can't represent ASTRA-specific semantics that don't map cleanly to MyST syntax

### Approach B: Generate MyST AST JSON directly, replace content server

```
astra.yaml ──→ AST generator ──→ custom content server ──→ myst theme ──→ browser
```

**How it works:**
1. A custom content server reads `astra.yaml` and produces MyST AST JSON on the fly
2. It implements the same HTTP API as the MyST content server (`/config.json`, `/content/*.json`, `/myst.xref.json`)
3. The standard MyST book-theme connects to it and renders normally
4. File watcher triggers AST regeneration + WebSocket reload notification

**Pros:**
- No markdown intermediate — no fence depth issues, no parsing ambiguity
- Single process — no two-step file watching
- Programmatically precise — every AST node is a typed object
- Can extend with custom node types if needed (myst-to-react can be configured with custom renderers)
- Faster: no markdown parsing step

**Cons:**
- Need to produce valid MyST AST JSON (match the spec exactly)
- Lose some free MyST features that happen during markdown parsing (DOI auto-resolution, citation bibliography generation)
- Need to implement the content server API (config, xrefs, search)
- More code to maintain

### Recommendation: Approach B

Approach B is the right choice because:

1. **The markdown generation was fragile** — we spent significant time debugging nested directive fence depths. The AST approach eliminates this entire class of problems.

2. **The transform is naturally tree-to-tree** — ASTRA's data model is a tree (Analysis → Decision → Option → Insight → Evidence). The MyST AST is a tree. The transform is a direct tree-to-tree mapping, which is much cleaner as code than as string interpolation into markdown syntax.

3. **DOI resolution can be handled separately** — The main "free" feature we'd lose is DOI auto-resolution (fetching full citation metadata from doi.org). This can be done as a one-time step when insights are added to astra.yaml, or as a background enrichment step in the content server.

4. **The content server API is small** — Only 4-5 endpoints to implement. The page content endpoint is by far the most important, and it's just "return a JSON object."

5. **It opens the door to custom node types** — We can define ASTRA-specific AST nodes (e.g., `DecisionNode`, `UniverseBanner`, `ResultStatus`) and register custom renderers for them, extending the document beyond what MyST markdown can express.

## 4. The ASTRA → MyST AST transform

### MyST AST node types we need

The transform produces standard MyST AST nodes. Here's the mapping from ASTRA concepts:

| ASTRA Concept | MyST AST Node(s) | Notes |
|---|---|---|
| Analysis (root) | `root` + `heading` (h1) + `paragraph` | Page root with title |
| Analysis description | `paragraph` | Abstract text |
| Finding / Insight claim | `heading` (h3) + `paragraph` | Finding narrative |
| Finding evidence (figure) | `container` + `image` + `caption` | Inline figure |
| Finding evidence (table) | `table` + `tableRow` + `tableCell` | Inline table from CSV |
| Finding → method link | `admonition` (kind: seealso) + `crossReference` | "Methodology" callout |
| Decision (as section) | `heading` (h4) | Section heading |
| Decision (interactive) | `details` + `summary` | Dropdown with label + selected |
| Decision options (tabs) | TabSet node (custom or div-based) | Tabs per option |
| Option description | `paragraph` inside tab | Option content |
| Option evidence | `admonition` (kind: note, dropdown) | Collapsible evidence |
| Insight claim | `strong` + `paragraph` | Bold paper name + claim |
| Evidence quote | `blockquote` + `paragraph` | Blockquote styling |
| DOI reference | `link` (url: https://doi.org/...) | Clickable DOI |
| Input | `tableRow` in inputs table | Row in list-table |
| Output (figure) | `image` | If result file exists |
| Output (table) | `table` | If CSV result exists |
| Output (pending) | `admonition` (kind: warning) | Status indicator |
| Success criterion | `tableRow` with status + crossReference | Row linking to finding |
| Universe banner | `admonition` (kind: tip) | Top-of-page banner |
| Sub-analysis | Separate page + `card` in parent | Multi-page navigation |

### AST structure for a finding

```json
{
  "type": "heading",
  "depth": 3,
  "identifier": "finding-1-b-seq-best",
  "children": [
    { "type": "text", "value": "1. B-sequence SARGs are the best TRGB standard candles" }
  ]
},
{
  "type": "paragraph",
  "children": [
    { "type": "text", "value": "The TRGB magnitude hierarchy is consistent..." }
  ]
},
{
  "type": "container",
  "kind": "figure",
  "identifier": "fig-hierarchy",
  "children": [
    {
      "type": "image",
      "url": "results/trgb_hierarchy_figure.png",
      "alt": "TRGB Hierarchy Across Samples"
    },
    {
      "type": "caption",
      "children": [
        { "type": "strong", "children": [{ "type": "text", "value": "Figure 13" }] },
        { "type": "text", "value": " — M_I,OGLE vs mean (V-I)_0 ..." }
      ]
    }
  ]
},
{
  "type": "admonition",
  "kind": "seealso",
  "children": [
    {
      "type": "admonitionTitle",
      "children": [{ "type": "text", "value": "Methodology" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "This finding depends on: " },
        {
          "type": "crossReference",
          "identifier": "sample-construction",
          "children": [{ "type": "text", "value": "Sample Construction" }]
        },
        { "type": "text", "value": ", " },
        {
          "type": "crossReference",
          "identifier": "trgb-detection",
          "children": [{ "type": "text", "value": "TRGB Detection" }]
        }
      ]
    }
  ]
}
```

### AST structure for a decision

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
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "R_V controls extinction coefficients..." }
      ]
    },
    {
      "type": "tabSet",
      "children": [
        {
          "type": "tabItem",
          "title": "R_V = 2.7 ●",
          "children": [
            { "type": "paragraph", "children": [{ "type": "text", "value": "SMC average..." }] },
            {
              "type": "details",
              "children": [
                {
                  "type": "summary",
                  "children": [{ "type": "text", "value": "Evidence (3 insights)" }]
                },
                {
                  "type": "paragraph",
                  "children": [
                    { "type": "strong", "children": [{ "type": "text", "value": "Gordon et al. (2003)" }] },
                    { "type": "text", "value": " — " },
                    { "type": "link", "url": "https://doi.org/10.1086/376774", "children": [{ "type": "text", "value": "10.1086/376774" }] }
                  ]
                },
                {
                  "type": "blockquote",
                  "children": [{
                    "type": "paragraph",
                    "children": [{ "type": "text", "value": "For the SMC Bar, we find that RV = 2.74 ± 0.13..." }]
                  }]
                }
              ]
            }
          ]
        },
        {
          "type": "tabItem",
          "title": "R_V = 3.3 ○",
          "children": [...]
        }
      ]
    }
  ]
}
```

### Transform function signature (TypeScript)

```typescript
interface ASTRASource {
  analysis: ASTRAFile           // parsed astra.yaml
  universe: Universe            // active universe selections
  results: Map<string, string>  // output_id → file path (for produced outputs)
  findings?: Finding[]          // extracted findings (from astra.yaml or derived)
}

interface MystPage {
  kind: 'Article'
  sha256: string
  slug: string
  mdast: Root                   // the AST tree
  frontmatter: Frontmatter
  references: References
  dependencies: string[]        // image paths, etc.
}

function astraToMystPage(source: ASTRASource): MystPage
```

### The core transform logic

```typescript
function astraToMystAST(source: ASTRASource): Root {
  const { analysis, universe, results } = source

  return {
    type: 'root',
    children: [
      // Abstract
      ...renderAbstract(analysis),

      // Universe banner
      renderUniverseBanner(universe),

      // Findings (front and center)
      renderSectionHeading(2, 'Findings', 'findings'),
      ...analysis.findings.flatMap((finding, i) =>
        renderFinding(finding, i + 1, results, analysis.decisions)
      ),

      // Methods (decisions organized by concern)
      renderSectionHeading(2, 'Methods', 'methods'),
      ...renderMethodsSections(analysis.decisions, analysis.prior_insights),

      // Data Sources
      renderSectionHeading(2, 'Data Sources', 'data-sources'),
      renderInputsTable(analysis.inputs),

      // Verification
      renderSectionHeading(2, 'Verification', 'verification'),
      renderSuccessCriteriaTable(analysis.success_criteria),
    ]
  }
}
```

### Key transform functions

```typescript
function renderFinding(
  finding: Finding,
  index: number,
  results: Map<string, string>,
  decisions: Record<string, Decision>
): Node[] {
  const nodes: Node[] = []

  // Heading
  nodes.push(heading(3, `${index}. ${finding.claim}`, finding.id))

  // Narrative (from finding notes or claim expansion)
  if (finding.notes) {
    nodes.push(paragraph(finding.notes))
  }

  // Evidence: inline figures/tables from results
  for (const evidence of finding.evidence) {
    if (evidence.artifact && results.has(evidence.artifact)) {
      const path = results.get(evidence.artifact)!
      if (path.endsWith('.png') || path.endsWith('.jpg')) {
        nodes.push(figure(path, evidence.artifact, finding.id))
      } else if (path.endsWith('.csv')) {
        nodes.push(csvTable(path, evidence.artifact))
      }
    }
  }

  // Methodology callout with cross-references to decisions
  const relatedDecisions = findRelatedDecisions(finding, decisions)
  if (relatedDecisions.length > 0) {
    nodes.push(methodologyCallout(relatedDecisions))
  }

  nodes.push(separator())
  return nodes
}

function renderDecision(
  id: string,
  decision: Decision,
  selectedOptionId: string,
  insights: Record<string, Insight>
): Node[] {
  const selectedOption = decision.options[selectedOptionId]
  const selectedLabel = selectedOption?.label ?? selectedOptionId

  return [
    // <details> dropdown
    details(
      // <summary>: decision label + selected option
      summary([
        strong(decision.label),
        text(` — selected: ${selectedLabel}`)
      ]),
      [
        // Rationale
        ...(decision.rationale ? [paragraph(decision.rationale)] : []),

        // Tab set with one tab per option
        tabSet(
          Object.entries(decision.options).map(([optId, option]) => {
            const isSelected = optId === selectedOptionId
            const marker = isSelected ? ' ●' : ' ○'

            return tabItem(`${option.label}${marker}`, [
              paragraph(option.description ?? ''),
              // Evidence from insights
              ...(option.insights?.length
                ? [renderInsightEvidence(option.insights, insights)]
                : []
              )
            ])
          })
        )
      ]
    )
  ]
}
```

## 5. Content server implementation

### API endpoints

The custom content server implements the same HTTP API as MyST's built-in content server:

```typescript
// GET /config.json
// Returns site configuration + table of contents
{
  "id": "astra-analysis",
  "title": analysis.name,
  "projects": [{
    "slug": ".",
    "index": "index",
    "pages": buildPageList(analysis)  // one page per analysis node
  }]
}

// GET /content/{slug}.json
// Returns page AST for a given slug
{
  "kind": "Article",
  "sha256": contentHash,
  "slug": slug,
  "mdast": astraToMystAST(source),   // the transform output
  "frontmatter": {
    "title": analysis.name,
    "subtitle": "ASTRA Analysis",
    "authors": analysis.authors?.map(a => ({ name: a })),
    "tags": analysis.tags
  },
  "references": { ... },
  "dependencies": listImagePaths(results)
}

// GET /myst.xref.json
// Returns cross-reference index
{
  "version": "1",
  "references": buildXrefIndex(analysis)
}

// WebSocket /socket
// Sends reload notifications when content changes
// Message: { "type": "reload" }
```

### File watching

```typescript
import { watch } from 'chokidar'

const watcher = watch([
  'astra.yaml',
  'universes/*.yaml',
  'results/**/*.{png,jpg,csv,json}'
], { ignoreInitial: true })

watcher.on('all', (event, path) => {
  // Re-read ASTRA source
  const source = loadASTRASource(projectDir)
  // Regenerate AST (cached, only regenerate what changed)
  astCache.invalidate(path)
  // Notify connected browsers via WebSocket
  ws.send(JSON.stringify({ type: 'reload' }))
})
```

### Static file serving

The content server also needs to serve result images. When the theme encounters an `image` node with `url: "results/smoothing_stability_figure.png"`, it fetches that file from the content server:

```typescript
// GET /results/*.png, /results/*.jpg, etc.
app.use('/results', express.static(path.join(projectDir, 'results', activeUniverse)))
```

## 6. Sub-analyses → multi-page

ASTRA's self-similar structure maps to a multi-page MyST site. Each analysis node (root or sub-analysis) becomes its own page:

```
/                    → root analysis
/preprocessing       → sub-analysis "preprocessing"
/training            → sub-analysis "training"
/training/validation → sub-sub-analysis
```

The table of contents (left sidebar) reflects the analysis tree:

```json
{
  "projects": [{
    "pages": [
      { "slug": "index", "title": "TRGB Calibration" },
      { "slug": "preprocessing", "title": "Preprocessing" },
      { "slug": "training", "title": "Training",
        "children": [
          { "slug": "training/validation", "title": "Validation" }
        ]
      }
    ]
  }]
}
```

In the parent page, sub-analyses appear as card links:

```json
{
  "type": "card",
  "url": "/preprocessing",
  "children": [
    { "type": "heading", "depth": 4, "children": [{ "type": "text", "value": "Preprocessing" }] },
    { "type": "paragraph", "children": [{ "type": "text", "value": "Data preprocessing stage" }] },
    { "type": "paragraph", "children": [{ "type": "text", "value": "2 decisions · 1 input · 1 output" }] }
  ]
}
```

The transform function is naturally recursive — it calls itself for each sub-analysis:

```typescript
function buildPages(analysis: Analysis, basePath: string = ''): Page[] {
  const pages: Page[] = []

  // This analysis node → one page
  pages.push({
    slug: basePath || 'index',
    content: astraToMystAST({ analysis, universe, results })
  })

  // Sub-analyses → recursive pages
  if (analysis.analyses) {
    for (const [id, subAnalysis] of Object.entries(analysis.analyses)) {
      const subPath = basePath ? `${basePath}/${id}` : id
      pages.push(...buildPages(subAnalysis, subPath))
    }
  }

  return pages
}
```

## 7. Document structure generation

### How findings are derived

The `findings` field in `astra.yaml` may or may not be populated. The generator uses these sources in priority order:

1. **Explicit findings** — If `analysis.findings` is populated, use those directly. Each finding has a claim, evidence (linking to outputs), and tags.

2. **Success criteria** — If no findings, derive them from `success_criteria`. Group criteria by the output they reference, and use the claim text as the finding narrative.

3. **Output grouping** — If neither is available, group outputs by type (figures, tables, metrics) and generate a simple results section without findings narrative.

### How decisions are organized in Methods

Decisions in `astra.yaml` have `tags` for grouping. The generator uses tags to organize decisions into method sections:

```typescript
function organizeDecisions(
  decisions: Record<string, Decision>
): Map<string, Decision[]> {
  const sections = new Map<string, Decision[]>()

  for (const [id, decision] of Object.entries(decisions)) {
    // Use first tag as section key, or "Other" if no tags
    const section = decision.tags?.[0] ?? 'other'
    if (!sections.has(section)) sections.set(section, [])
    sections.get(section)!.push({ ...decision, _id: id })
  }

  return sections
}
```

The section keys map to human-readable headings:

```typescript
const SECTION_LABELS: Record<string, string> = {
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

### How evidence connects findings to decisions

Each finding's evidence references output IDs. Each output's recipe has input dependencies. Each decision parameterizes the scripts that produce outputs. The connection is:

```
Finding → evidence.artifact (output ID)
  → output.recipe.command (script)
    → decisions that parameterize that script (from tags or explicit mapping)
```

For the prototype, the mapping can be manual (a simple lookup table). For production, decision-output relationships could be derived from the recipe DAG or declared explicitly in astra.yaml.

## 8. Live reload flow

### Complete sequence when agent edits astra.yaml

```
1. Agent writes to astra.yaml (e.g., changes a decision's default)
2. chokidar file watcher detects the change
3. Content server re-reads astra.yaml, re-parses
4. Content server re-runs astraToMystAST() for affected pages
5. Content server sends { type: "reload" } via WebSocket
6. Browser receives WebSocket message
7. Theme refetches /content/index.json
8. myst-to-react re-renders the updated AST
9. User sees the change (typically < 1 second end-to-end)
```

### Complete sequence when prism run produces a new result

```
1. prism run completes, writes results/baseline/smoothing_stability_figure.png
2. chokidar detects new file in results/
3. Content server re-runs transform (the figure node now has a valid path)
4. AST changes: figure node goes from "pending" admonition to actual image
5. WebSocket reload → browser re-renders with the new figure inline
```

## 9. Technology choices

| Component | Technology | Rationale |
|---|---|---|
| Content server | TypeScript + Express/Hono | Matches MyST ecosystem (JS/TS), simple HTTP server |
| ASTRA parser | `js-yaml` | Standard YAML parsing, already used by MyST |
| AST construction | TypeScript with myst-spec types | Type-safe AST nodes matching the spec |
| File watcher | `chokidar` | Battle-tested, used by MyST itself |
| Theme | `myst-theme/book-theme` (unmodified) | Zero custom UI code needed |
| CSV → table | `papaparse` | Parse result CSV files for table rendering |
| Image serving | Express static middleware | Serve result images from results/ directory |

### Dependencies

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0",
    "chokidar": "^3.6.0",
    "express": "^4.18.0",
    "papaparse": "^5.4.0",
    "ws": "^8.16.0",
    "myst-spec": "^0.0.5"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/express": "^4.17.0",
    "@types/ws": "^8.5.0"
  }
}
```

The MyST theme is installed separately via `myst start` (it downloads the book-theme automatically).

## 10. Integration with Prism

### As a Prism command

```bash
prism view                    # Start the document server for the current analysis
prism view --port 4000        # Custom port
prism view --universe u001    # View a specific universe
```

`prism view` would:
1. Start the custom content server (port 3100)
2. Start the MyST book-theme (port 3000) pointed at the content server
3. Open the browser
4. Keep running, watching for changes

### As a VS Code extension integration

Prism-UI could launch `prism view` and display the result in a VS Code webview panel (simple iframe or webview pointing at localhost:3000). The existing Prism-UI extension infrastructure handles lifecycle management.

## 11. Implementation plan

### Phase 1: Core transform (2-3 days)

- [ ] Implement `astraToMystAST()` — the ASTRA → MyST AST transform
- [ ] Handle all node types: headings, paragraphs, admonitions, details/dropdowns, tabSets, figures, tables, blockquotes, links, cross-references
- [ ] Render findings section from `findings` or `success_criteria`
- [ ] Render methods section from `decisions` organized by tags
- [ ] Render inputs table, verification table
- [ ] Test with the TRGB analysis astra.yaml

### Phase 2: Content server (1-2 days)

- [ ] Implement Express server with `/config.json`, `/content/index.json`, `/myst.xref.json`
- [ ] Static file serving for result images
- [ ] File watcher on astra.yaml, universes/, results/
- [ ] WebSocket for live reload
- [ ] Test end-to-end with `myst start` connecting to the content server

### Phase 3: Multi-page for sub-analyses (1 day)

- [ ] Recursive page generation for sub-analyses
- [ ] Table of contents generation reflecting analysis tree
- [ ] Sub-analysis cards in parent pages
- [ ] Navigation between parent and child pages

### Phase 4: Result embedding (1 day)

- [ ] Read CSV results and render as tables
- [ ] Inline figures from results/ directory
- [ ] Status indicators (pending/complete/error) based on result file existence
- [ ] Success criteria pass/fail based on actual values

### Phase 5: Prism integration (1 day)

- [ ] `prism view` CLI command
- [ ] VS Code extension integration
- [ ] Documentation

## 12. Open questions

1. **Tab rendering**: The MyST AST spec includes `tabSet` and `tabItem` node types, but they may require specific handling in the book-theme. Need to verify these work when produced programmatically vs. parsed from markdown.

2. **DOI enrichment**: MyST's markdown parser auto-resolves DOIs to full citation metadata via doi.org. If we bypass the parser, we need to either: (a) do this enrichment in the content server, (b) pre-cache citation metadata when insights are added, or (c) use inline links instead of formal citations.

3. **Custom node types**: If we want rendering that goes beyond standard MyST (e.g., a universe comparison widget, a decision dependency graph), we'd need to register custom renderers with myst-to-react. This is supported but requires forking or extending the theme.

4. **Incremental updates**: The current design regenerates the full AST on any change. For large analyses with many sub-analyses, incremental updates (only regenerate the affected page) would improve performance. The content hash (`sha256` in the page response) enables this — the theme only refetches pages whose hash changed.

5. **Finding derivation**: The mapping from success criteria to narrative findings is currently manual. Could an agent generate findings from the analysis results? This would close the loop: agent runs analysis → results appear → agent writes findings → document updates with narrative + evidence.
