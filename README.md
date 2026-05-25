# MySTRA

**A MyST plugin that imports/cites [ASTRA](https://github.com/LightconeResearch/ASTRA) analysis components into Markdown reports.**

You write a normal [MyST](https://mystmd.org/) Markdown report and pull in ASTRA
components — decisions, outputs, findings, prior insights, data tables — *by
reference*. They stay single-sourced in `astra.yaml`. MySTRA is a MyST plugin
(directives + roles + transforms) that reads `astra.yaml` at build time and
emits standard MyST AST, so it runs on the **stock `myst` CLI and themes** — no
custom server.

> This is the "Strategy A" architecture. It replaces an earlier
> generate-everything content server; see
> [`STRATEGY-A-REFACTOR.md`](./STRATEGY-A-REFACTOR.md) for the full rationale and
> [`SPEC.md`](./SPEC.md) for the design.

## The idea: three single sources

| Concern | Single source of truth |
|---|---|
| **Data** — what a decision/output/finding *is* | `astra.yaml` (+ `universes/`, `results/`) |
| **Composition** — what appears, where, in what order | your `index.md` |
| **Presentation** — how it looks | the theme |

The plugin is a pure **projector**: it reads the data and emits (a) rendered,
neutral semantic AST for the elements you placed (the baseline any theme shows)
and (b) — for rich themes — the resolved ASTRA data, once, keyed by id. It makes
no authoring or styling decisions.

## Quick start

```bash
npm install
npm run build         # compiles the plugin to dist/

cd prototype          # a worked DESI DR1 BAO example
ASTRA_PROJECT_ROOT="$PWD" npx mystmd start    # → http://localhost:3000
```

Register the plugin in your project's `myst.yml` and point `ASTRA_PROJECT_ROOT`
at the ASTRA project (defaults to the working directory; pick a universe with
`ASTRA_UNIVERSE`):

```yaml
version: 1
project:
  plugins:
    - mystra            # or a local path to dist/index.js
  toc:
    - file: index.md
site:
  template: book-theme  # the clean baseline; swap for a rich ASTRA theme later
```

## Two render modes

- **Basic — plugin only.** Registering the plugin is all you need. On the stock
  `book-theme` with no stylesheet the document is clean and readable: decisions
  render as dropdowns with tabbed options, outputs as real figures/tables,
  findings and prior insights as cards, interpolated numbers show their value,
  and inline references show a plain label. Preview cards are hidden by default,
  so a bare viewer never spills card content inline. **No user CSS required.**
- **Rich — a `lightcone-astra` theme.** Glyphs, per-kind colours, hover preview
  cards, and "powerful patterns" (e.g. a product-dependency graph) are
  appearance keyed on the `astra-*` classes the plugin emits, driven from the
  resolved store. The only change is the `template:` line. (The theme is a
  separate deliverable; until it ships, `book-theme` is the baseline. The
  prototype's `custom.css` is a reference stylesheet that previews the rich mode
  on book-theme via `site.options.style`.)

## Authoring vocabulary

**Block "import" directives** (one component, by id):

```markdown
:::{astra:decision} covariance_source
:::
:::{astra:output} bao_fit_plot
:::
:::{astra:finding} bao_detected_post_recon
:::
:::{astra:prior-insight} recon_sharpens_bao_peak
:::
:::{astra:inputs}
:::                                   # full inputs registry table (root scope)
:::{astra:outputs} clustering
:::                                   # outputs table for the clustering sub-analysis
:::{astra:subanalysis} reconstruction
:::                                   # nav card to the sub-analysis page
```

`:::{astra:output}` figures carry the `output-<id>` anchor and a collapsed
provenance disclosure (type, upstream products, decisions, recipe); tables
render as a clean numbered `container[table]`. `:::{astra:finding}` accepts
`:compact:` to render claim + notes + scope only.

**Inline "cite" roles** — a neutral token (label) carrying a hidden preview card:

```markdown
{astra:decision}`covariance_source`
{astra:output}`hubble_diagram_plot`
{astra:finding}`subpercent_alpha_iso_precision`
{astra:prior-insight}`recon_sharpens_bao_peak|the recovered peak`   # |display override
{astra:analysis}`reconstruction`
```

**Inline value interpolation** — never hard-type a measured number; pull it live
from a result product at build time:

```markdown
{astra:value}`bao_distance_table tracer=lrg3_elg1 col=DV_over_rd pm`   → 19.88 ± 0.17
{astra:value}`bao_alpha_values tracer=elg1 recon=Pre col=alpha1_std`   → 0.0696
```

Grammar: `<output-path> col=<col> [<key>=<val> …] [pm] [err=<col>] [sig=N]`. It
reads the materialised CSV/JSON, filters rows by `key=val`, and renders the cell
(with `± std` via `pm`/`err=`).

**Anchor grammar** — `[text](#decisions.x)`, `#outputs.y`, `#analyses.sub.…`
resolve to cross-references, alongside plain MyST `[](#output-bao_fit_plot)`.

**Scoping** — a path is `<id>` (root analysis) or `<sub>.<id>` (sub-analysis),
e.g. `reconstruction.algorithm`, `clustering.xi_multipoles_plot`. Each
sub-analysis is its own page (`reconstruction.md`, `clustering.md`).

## Recognition markers & the resolved store

Every placed block carries a stable `astra-<kind>` class (`astra-decision`,
`astra-output`/`--figure`, `astra-finding`, `astra-prior-insight`,
`astra-inputs`/`astra-outputs`, `astra-subanalysis`) on the node bearing its
`<kind>-<id>` identifier. Inline tokens are neutral
(`span.astra-ref--<kind>` + label + a hidden `span.astra-card`).

For rich themes, the plugin bakes a **resolved store** onto a hidden
`div.astra-store` carrier's `data` (per page scope): the resolved outputs
(project-relative paths, parsed table/metric values, recipes, provenance),
inputs, decisions (selected option), findings, prior insights, and
sub-analyses — all keyed by id. A theme selects a placed node by
`identifier`/class and joins it to the store; it never reads `astra.yaml`.

## Project structure

```
src/
├── index.ts                  The MyST plugin + package entry (default export = the plugin)
├── loader.ts                 Load a project for one universe (via the SDK) + resolve result files
└── transform/                Per-component renderers used by the plugin
    ├── ast-helpers.ts        Pure AST node constructors
    ├── prose.ts              Parse component Markdown (myst-parser) + resolve ASTRA anchors
    ├── parse-table-data.ts   CSV/JSON table parser
    ├── resolve-output.ts     Resolves `from:` output/alias chains
    ├── resolved-store.ts     Builds the resolved data store for rich themes
    ├── render-methods.ts     renderDecision (details/summary + tabbed options)
    ├── render-findings.ts    renderFinding (claim + notes + scope + evidence)
    ├── render-evidence.ts    renderOneOutput + evidence/table rendering (Output.type)
    └── render-data-sources.ts  Inputs/outputs registry tables
```

Data-model types are imported directly from **`@astra-spec/sdk`** (`Analysis`,
`Decision`, `Output`, …) — MySTRA defines none of its own.

## ASTRA project layout

```
my-analysis/
├── astra.yaml          Analysis specification (decisions, findings, outputs, …)
├── universes/
│   └── baseline.yaml   Decision selections for the baseline universe
├── results/
│   └── baseline/<output-id>/<output-id>.png   Materialised result artifacts
├── myst.yml            Registers the plugin; lists pages
└── index.md (+ sub-analysis pages)            Your report
```

A sub-analysis that declares `path: ./analyses/<sub>` roots its own
`results/<universe>/` there. MySTRA never scans the results tree: it computes
each output's directory deterministically from this convention (the analysis's
`path:` + universe + output id) and resolves the artifact file lazily, on render.

## What MyST does for us

We lean on the stock `myst` engine for everything it already does: building,
serving, asset hashing/copying (it rewrites the plugin's project-relative image
paths into hashed assets), live reload of Markdown, numbering, cross-references,
and search. We write only the ASTRA→AST bridge.

**Citations** are delegated to MyST. DOI evidence renders as a plain `doi.org`
link; MySTRA carries no DOI resolver or cache of its own. Author–year labels and
a linked reference list come for free once a project bibliography is wired — a
clean follow-up (see the citation note in the spec).

## Development

```bash
npm run build    # compile the plugin
npm test         # plugin-emission + store + parser tests (vitest)
```

`astra.yaml` is parsed once and cached; `myst start` watches Markdown, not
`astra.yaml`, so editing the spec needs a server restart.

## License

MIT
