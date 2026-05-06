# MySTRA

**Live ASTRA document rendering via MyST.**

MySTRA turns an [ASTRA](https://github.com/LightconeResearch/ASTRA) analysis specification into a browsable, interactive web document — with collapsible method decisions, tabbed option comparisons, citation hover previews, and live reload on file changes.

It works by generating [MyST](https://mystmd.org/) AST directly from the ASTRA data model and serving it to the unmodified MyST book-theme. No intermediate markdown is produced.

## Quick start

```bash
npm install
npm run build

# Render an ASTRA project
npx mystra path/to/astra-project/

# Open http://localhost:3000
```

## How it works

```
astra.yaml + universes/ + results/
         │
         ▼
   ASTRA → MyST AST transform
         │
         ▼
   Content Server (:3100)          Theme Server (:3000)
   serves JSON AST per page   ◀──  fetches & renders via
   config, xrefs, citations        myst-to-react (unmodified)
         │                                  │
         └──────────────────────────────────▶ Browser
```

The MyST book-theme doesn't care where its AST comes from. MySTRA replaces the content server with one that transforms ASTRA directly into MyST AST JSON. The theme works identically to a standard MyST site.

### Why direct AST generation (not markdown)

- **No syntax fragility** — nested MyST directives require careful fence-depth management. AST nodes are just objects; nesting is trivial.
- **Tree-to-tree mapping** — ASTRA is a tree (Analysis > Decision > Option > Insight > Evidence). The MyST AST is a tree. The transform is a direct structural mapping.
- **Extensible** — custom AST node types (`details`, `cite`, `tabSet`) integrate seamlessly with the theme's renderers.

## Features

- **Flat addressable elements** — every finding, decision, prior-insight, input, output, and narrative chunk is emitted as a top-level block with a stable `<kind>-<id>` identifier. Themes and downstream renderers compose layout from those carriers; MySTRA imposes no section structure of its own.
- **Structured ASTRA sidecar** — `/astra/<slug>.json` exposes resolved inputs/outputs, recipes, and inline metric/table payloads for renderer-native gallery/detail views.
- **Findings** as h3 blocks with author notes, scope, and evidence (figures, tables, citations).
- **Decisions** as collapsible dropdowns with tabbed option comparisons (selected option marked with **●**).
- **Prior insights** as flat blocks; option tabs cross-reference them rather than expanding inline.
- **Universe banner** summarising active decision selections with links to each decision.
- **Narrative anchor grammar** — `[text](#path.to.element)` resolves to a `crossReference` everywhere prose appears (narrative sections, claims, rationales, descriptions, captions, excluded reasons).
- **Live reload** — edits to the root spec, nested `analyses/**/astra.yaml`, or result artifacts under `results/` and `analyses/**/results/` trigger an automatic page refresh.
- **DOI + paper-cache enrichment** — disk-cached citation metadata, optional cached-PDF links, and insight→decision backlinks for cited papers.
- **Recursive sub-analyses** rendered as separate pages with their own universe scoping.

## Usage

```
mystra [project-dir] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <n>` | `3000` | Theme server port |
| `--content-port <n>` | `3100` | Content server port |
| `-u, --universe <name>` | first found | Universe to render |
| `--no-theme` | | Content server only (API mode) |

## Project structure

```
src/
├── transform/               ASTRA → MyST AST conversion
│   ├── index.ts             Main orchestrator + page builder
│   ├── ast-helpers.ts       Pure AST node constructors
│   ├── narrative-parser.ts  myst-parser wrapper + anchor grammar resolver
│   ├── render-narrative.ts  Narrative chunks (summary/findings/methods/inputs/outputs)
│   ├── render-findings.ts   Findings as flat per-finding blocks
│   ├── render-prior-insights.ts  Prior insights as flat per-insight blocks
│   ├── render-methods.ts    Decisions as details/summary + tabbed options
│   ├── render-evidence.ts   Artifact rendering driven by Output.type; cites + quotes
│   ├── render-universe-banner.ts  Collapsible decision summary table
│   ├── render-data-sources.ts     Inputs and outputs tables
│   └── render-sub-analyses.ts     Sub-analysis cards
├── loader/                  ASTRA source loading (YAML, universes, results)
├── server/                  Express content server + WebSocket live reload
├── doi/                     DOI resolution, caching, citation formatting
├── papers/                  Cached-paper enrichment + DOI insight backlinks
├── theme/                   MyST book-theme launcher
├── types/                   TypeScript interfaces (ASTRA, content-server API)
└── cli.ts                   CLI entry point
```

## ASTRA project layout

MySTRA expects:

```
my-analysis/
├── astra.yaml          Analysis specification (decisions, findings, evidence)
├── universes/
│   ├── baseline.yaml   Decision selections for the baseline universe
│   └── variant.yaml    Alternative universe
└── results/
    ├── baseline/       Outputs produced under the baseline universe
    │   ├── figure.png
    │   └── data.json
    └── variant/
```

Nested analyses typically live under `analyses/<sub>/astra.yaml`; MySTRA also
scans `analyses/**/results/<universe>/` when resolving artifacts and serving
`/static/*` URLs.

## Content API

When running with `--no-theme`, the content server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /config.json` | Site manifest + table of contents |
| `GET /content/*.json` | Page AST + frontmatter + references |
| `GET /myst.xref.json` | Cross-reference index |
| `GET /astra/*.json` | Structured ASTRA sidecar with resolved inputs/outputs, recipes, metric/table payloads |
| `GET /doi-metadata/:doi(*)` | Enriched DOI metadata, including cached-PDF links and insight backlinks when available |
| `GET /papers/*` | Cached paper PDFs from the local ASTRA paper cache |
| `GET /static/*` | Result artifacts from root or nested sub-analysis results |
| `WS /socket` | Live reload notifications |

## Development

```bash
npm run dev -- path/to/astra-project/   # Run with tsx (no build step)
npm run build                            # Compile TypeScript
npm test                                 # Run tests
```

## License

MIT
