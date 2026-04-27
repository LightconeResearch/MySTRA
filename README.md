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

- **Findings** with inline figures, result data tables, and methodology cross-references
- **Method decisions** as collapsible dropdowns with tabbed option comparisons (selected option marked with **●**)
- **Insights** supporting each option, with attributed quotes and citation hover previews
- **Universe banner** summarizing active decision selections with links to each decision
- **Verification table** tracking success criteria against produced outputs
- **Live reload** — edits to `astra.yaml`, `universes/*.yaml`, or `results/**/*` trigger an automatic page refresh
- **DOI resolution** with disk-cached citation metadata and formatted bibliography
- **Recursive sub-analyses** rendered as separate pages with their own universe scoping

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
│   ├── inline-parser.ts     Inline markdown → AST (bold, italic, code, links)
│   ├── render-findings.ts   Findings section with evidence + methodology links
│   ├── render-methods.ts    Decisions as details/summary + tabbed options
│   ├── render-evidence.ts   Figures, JSON/CSV tables, cite nodes, quotes
│   ├── render-universe-banner.ts  Collapsible decision summary table
│   ├── render-verification.ts     Success criteria table
│   ├── render-data-sources.ts     Inputs and outputs tables
│   └── render-sub-analyses.ts     Sub-analysis cards
├── loader/                  ASTRA source loading (YAML, universes, results)
├── server/                  Express content server + WebSocket live reload
├── doi/                     DOI resolution, caching, citation formatting
├── theme/                   MyST book-theme launcher
├── types/                   TypeScript interfaces (ASTRA, MyST AST, API)
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

## Content API

When running with `--no-theme`, the content server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /config.json` | Site manifest + table of contents |
| `GET /content/{slug}.json` | Page AST + frontmatter + references |
| `GET /myst.xref.json` | Cross-reference index |
| `GET /static/*` | Result artifacts (images, data files) |
| `WS /socket` | Live reload notifications |

## Development

```bash
npm run dev -- path/to/astra-project/   # Run with tsx (no build step)
npm run build                            # Compile TypeScript
npm test                                 # Run tests
```

## License

MIT
