<div align="center">

# MySTRA

**Write publications on top of [ASTRA](https://github.com/LightconeResearch/ASTRA) analyses — in plain [MyST](https://mystmd.org/) Markdown.**

Pull your decisions, outputs, findings, and live numbers in *by reference*.
One source of truth, no copy-pasted values, no figures that drift out of sync.

[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](./LICENSE)
[![MyST](https://img.shields.io/badge/MyST-plugin-DE5C42.svg)](https://mystmd.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](#)

</div>

---

You write a normal MyST Markdown document and reference ASTRA components —
decisions, outputs, findings, prior insights, data tables, live numbers. The
components stay single-sourced in your `astra.yaml`; MySTRA reads it at build
time and emits standard MyST AST. It runs on the **stock `myst` CLI and themes**
— no custom server, no copy-pasted numbers, no figures that drift out of sync
with the analysis.

```markdown
The combined LRG3+ELG1 bin reaches
$D_V/r_d =$ {astra:value}`bao_distance_table tracer=lrg3_elg1 col=DV_over_rd pm`
at $z_\mathrm{eff} =$ {astra:value}`bao_distance_table tracer=lrg3_elg1 col=z_eff`,
consistent with the {astra:finding}`bao_detected_post_recon` detection.

:::{astra:output} bao_fit_plot
:::
```

→ the values are interpolated live from the result product, the finding renders
as a card with its full record, and the figure is pulled in with its provenance.
Edit `astra.yaml` and rerun the analysis; the report updates itself.

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [Authoring](#authoring)
- [ASTRA project layout](#astra-project-layout)
- [Two render modes](#two-render-modes)
- [What MyST handles for you](#what-myst-handles-for-you)
- [How it works (for theme authors)](#how-it-works-for-theme-authors)
- [Project structure](#project-structure)
- [Developing MySTRA](#developing-mystra)
- [License](#license)

## Why

ASTRA already holds the *truth* of an analysis — every decision, the inputs and
outputs of each step, the findings, and the materialised result products. A
write-up usually re-types all of that into prose, where it immediately starts to
rot: a number gets stale, a figure is from an old run, a stated assumption no
longer matches the spec.

MySTRA removes the duplication. The report references the analysis instead of
restating it, so there is **one source of truth for the data** and the prose can
focus on the argument.

| Concern | Single source of truth |
|---|---|
| **Data** — what a decision/output/finding *is* | `astra.yaml` (+ `universes/`, `results/`) |
| **Composition** — what appears, where, in what order | your `index.md` |
| **Presentation** — how it looks | the MyST theme |

The plugin is a pure **projector** between data and document: it renders the
elements you place, fills in the numbers, and makes no authoring or styling
decisions of its own.

## Quick start

MyST loads a plugin from a single bundled `.mjs` file referenced by URL — there
is nothing to `npm install`. Point your ASTRA project's `myst.yml` at the latest
release artifact and list your pages:

```yaml
version: 1
project:
  plugins:
    - https://github.com/LightconeResearch/MySTRA/releases/latest/download/mystra.mjs
  toc:
    - file: index.md
site:
  template: book-theme
```

The `…/releases/latest/download/…` URL always tracks the newest release; pin a
specific version by swapping `latest` for a tag (e.g. `download/v0.0.1/`). MyST
fetches and caches the file on the first build.

Then run the stock MyST CLI from the project directory:

```bash
myst start        # → http://localhost:3000
```

That's it — no custom server and no build step of your own. MySTRA reads
`astra.yaml` from the working directory and resolves the first universe in
`universes/`. Two optional environment variables override those defaults:

| Variable | Default | Purpose |
|---|---|---|
| `ASTRA_PROJECT_ROOT` | `process.cwd()` | The ASTRA project directory (where `astra.yaml` lives) |
| `ASTRA_UNIVERSE` | first in `universes/` | Which universe's decision selections to resolve |

## Authoring

The directive and role vocabulary below *is* your compositional surface — what
you place is what appears.

### Block directives — import a component by id

```markdown
:::{astra:decision} covariance_source
:::                                   # dropdown: the choice + tabbed options
:::{astra:output} bao_fit_plot
:::                                   # the figure (or table), with provenance
:::{astra:finding} bao_detected_post_recon
:::                                   # claim + notes + scope + evidence  (:compact: trims to claim only)
:::{astra:prior-insight} recon_sharpens_bao_peak
:::                                   # the prior insight as an admonition
:::{astra:inputs}
:::                                   # the inputs registry table (root scope)
:::{astra:outputs} clustering
:::                                   # outputs table for the `clustering` sub-analysis
:::{astra:subanalysis} reconstruction
:::                                   # a nav card linking to the sub-analysis page
```

### Inline roles — cite a component in a sentence

Each renders as a neutral text label (a rich theme adds a kind glyph and a hover
preview card):

```markdown
{astra:decision}`covariance_source`
{astra:output}`hubble_diagram_plot`
{astra:finding}`subpercent_alpha_iso_precision`
{astra:prior-insight}`recon_sharpens_bao_peak|the recovered peak`   # |display override
{astra:analysis}`reconstruction`
```

### Live values — never hard-type a measured number

Pull a cell straight from a materialised result product at build time:

```markdown
{astra:value}`bao_distance_table tracer=lrg3_elg1 col=DV_over_rd pm`   → 19.88 ± 0.17
{astra:value}`bao_alpha_values tracer=elg1 recon=Pre col=alpha1_std`   → 0.0696
```

Grammar: `<output-path> col=<col> [<key>=<val> …] [pm] [err=<col>] [sig=N]`.
It reads the output's CSV/JSON, filters rows by each `key=val`, and renders the
selected cell — append `pm` (or `err=<col>`) to show `± std`, `sig=N` to set
significant figures.

### Cross-references and scoping

- **Anchors**: `[text](#decisions.x)`, `#outputs.y`, `#analyses.sub.…` resolve
  to cross-references, alongside plain MyST `[](#output-bao_fit_plot)`.
- **Scoping**: a component path is `<id>` for the root analysis or `<sub>.<id>`
  for a sub-analysis (e.g. `reconstruction.algorithm`), and can nest
  (`a.b.id`). Each sub-analysis is typically its own page.

Everything else — prose, math, figures you author yourself, the table of
contents, multi-page structure — is ordinary MyST.

## ASTRA project layout

```
my-analysis/
├── astra.yaml          Analysis specification (decisions, findings, outputs, …)
├── universes/
│   └── baseline.yaml   Decision selections for the baseline universe
├── results/
│   └── baseline/<output-id>/<output-id>.png   Materialised result artifacts
├── myst.yml            Registers the plugin; lists pages
└── index.md            Your report (+ optional sub-analysis pages)
```

MySTRA never scans the results tree: it computes each output's directory
deterministically from the convention above (the analysis's `path:` + universe +
output id) and resolves the artifact file lazily, as it renders. A sub-analysis
that declares `path: ./analyses/<sub>` roots its own `results/<universe>/` there.

## Two render modes

- **Basic — plugin only.** On the stock `book-theme` with no stylesheet, the
  document is already clean and readable: decisions are dropdowns, outputs are
  real figures/tables, findings and prior insights are cards, numbers show their
  value, and inline references show a plain label. **No user CSS required.**
- **Rich — a dedicated ASTRA theme.** A MyST theme keyed on the `astra-*`
  classes the plugin emits can add glyphs, per-kind colours, hover preview
  cards, and richer patterns (e.g. a product-dependency graph), all driven from
  the resolved data the plugin bakes into the build. The only change is the
  `site.template:` line. (This theme is a separate deliverable; until it ships,
  `book-theme` is the baseline.)

## What MyST handles for you

MySTRA writes only the ASTRA→AST bridge and leans on the stock `myst` engine for
everything else: building, serving, asset hashing/copying (it rewrites the
plugin's project-relative image paths into hashed assets), live reload of
Markdown, numbering, cross-references, and search. **Citations** are delegated to
MyST too — DOI evidence renders as a `doi.org` link, and a linked reference list
comes for free once a project bibliography is wired.

## How it works (for theme authors)

Every placed block carries a stable `astra-<kind>` class
(`astra-decision`, `astra-output`/`--figure`, `astra-finding`,
`astra-prior-insight`, `astra-inputs`/`astra-outputs`, `astra-subanalysis`) on
the node bearing its `<kind>-<id>` identifier; inline tokens are neutral
(`span.astra-ref--<kind>`). For rich rendering the plugin also bakes a **resolved
store** onto a hidden `div.astra-store` carrier's `data` (per page): the fully
resolved outputs (project-relative paths, parsed table/metric values, recipes,
provenance), inputs, decisions, findings, prior insights, and sub-analyses, all
keyed by id. A theme selects a placed node by class/identifier and joins it to
the store — it never reads `astra.yaml`. Insight DOIs are additionally emitted
as hidden `cite` nodes (a `div.astra-cites` carrier) so MyST's citation
pipeline resolves them at build time and a theme can render the formatted
citation (author–year + bibliography entry) instead of the raw DOI.

The exact shape a theme consumes is defined by
[`src/transform/resolved-store.ts`](./src/transform/resolved-store.ts) and its
exported `ResolvedStore` / `Serialized*` types.

## Project structure

```
src/
├── index.ts                  The MyST plugin + package entry (default export = the plugin)
├── loader.ts                 Load a project for one universe (via the SDK) + resolve result files
└── transform/                Per-component renderers used by the plugin
    ├── ast-helpers.ts        Pure AST node constructors
    ├── prose.ts              Parse component Markdown + resolve ASTRA anchors
    ├── parse-table-data.ts   CSV/JSON table parser
    ├── resolve-output.ts     Resolves `from:` output/alias chains
    ├── provenance.ts         Traces an output's decision/input provenance frames
    ├── resolved-store.ts     Builds the resolved data store for rich themes
    ├── render-methods.ts     renderDecision (details/summary + tabbed options)
    ├── render-findings.ts    renderFinding (claim + notes + scope + evidence)
    ├── render-evidence.ts    renderOneOutput + evidence/table rendering
    └── render-data-sources.ts  Inputs/outputs registry tables
```

Data-model types come directly from **`@astra-spec/sdk`** (`Analysis`,
`Decision`, `Output`, …) — MySTRA defines none of its own.

## Developing MySTRA

Working on the plugin itself (not needed to *use* it):

```bash
npm install
npm run build    # type-check + compile src/ → dist/ (tsc)
npm run bundle   # bundle the single-file plugin → dist/mystra.mjs
npm test         # plugin-emission + store + parser tests (vitest)
```

`astra.yaml` is parsed once and cached; `myst start` watches Markdown, not
`astra.yaml`, so editing the spec needs a server restart.

### Releasing

Distribution is a single bundled `.mjs` attached to a GitHub Release — MyST does
not consume npm packages ([why](https://mystmd.org/guide/plugins-distribute)).
Cutting a release is just pushing a tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

The [`release`](./.github/workflows/release.yml) workflow then tests, bundles
`dist/mystra.mjs`, and publishes a GitHub Release with that file attached — which
is the URL users reference in `myst.yml` (above).

## License

[BSD 3-Clause](./LICENSE)
