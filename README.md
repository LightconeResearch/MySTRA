<div align="center">

# MySTRA

**Write publications on top of [ASTRA](https://github.com/LightconeResearch/astra-spec) analyses — in plain [MyST](https://mystmd.org/) Markdown.**

Pull your decisions, outputs, findings, and live numbers in *by reference*.
One source of truth, no copy-pasted values, no figures that drift out of sync.

[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](./LICENSE)
[![MyST](https://img.shields.io/badge/MyST-plugin-DE5C42.svg)](https://mystmd.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](#)

</div>

---

> [!WARNING]
> **Early development.** MySTRA is in active, pre-1.0 development. The plugin
> vocabulary, the resolved-store shape, and the public API may change without
> notice between releases, and there are rough edges. Pin a specific release
> tag in your `myst.yml` rather than tracking `latest`, and expect breaking
> changes. Feedback and issues are very welcome.

You write a normal MyST Markdown document and reference ASTRA components —
decisions, outputs, findings, prior insights, data tables, live numbers. The
components stay single-sourced in your `astra.yaml`; MySTRA reads it at build
time and emits standard MyST AST. It runs on the **stock `myst` CLI and themes**
— no custom server, no copy-pasted numbers, no figures that drift out of sync
with the analysis.

```markdown
The combined LRG3+ELG1 bin reaches
$D_V/r_d =$ {astra:value}`outputs/bao_distance_table col=DV_over_rd tracer=lrg3_elg1 ±`
at $z_\mathrm{eff} =$ {astra:value}`outputs/bao_distance_table col=z_eff tracer=lrg3_elg1`,
consistent with the {astra}`findings/bao_detected_post_recon` detection.

:::{astra} outputs/bao_fit_plot
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

You reference **any part** of an ASTRA analysis with one idea: a **path** that
mirrors `astra.yaml`. One name — `astra` — drives both surfaces, the MyST way
(just as `{math}` is both a role and a directive): wrap a path in the `{astra}`
*role* to mention it inline, or use the `{astra}` *directive* to embed it as a
block.

### Paths — addressing any element

A path is a slash-separated route through the analysis tree. Read it like a file
path; the first meaningful segment is a top-level `astra.yaml` collection.

```
outputs/hubble_diagram                  an output (figure / table / metric / …)
decisions/algorithm                     a decision
decisions/algorithm/options/gp          a child — one option of a decision
findings/sig/evidence/fig1              a child — one evidence record of a finding
prior_insights/recon_sharpens_bao       a prior insight
inputs/raw_catalog                      an input
reconstruction/outputs/xi               an output in the `reconstruction` sub-analysis
reconstruction                          the sub-analysis itself
outputs                                 a whole collection (a registry)
```

Collections are the `astra.yaml` keys: `inputs`, `outputs`, `decisions`,
`findings`, `prior_insights` (hyphen alias `prior-insights`), `analyses`,
`universes`. A sub-analysis id may be written directly (the `analyses/` prefix is
implied) and nests to any depth (`clustering/correlation/outputs/xi`). In roles
and directives a path resolves from the **root analysis** (a leading `/` is
optional); the `#astra:` link scheme (below) resolves relative to the **page**,
and additionally supports `../` to climb scopes.

### Inline references — the `{astra}` role

```markdown
We adopt the {astra}`decisions/algorithm` and report {astra}`outputs/hubble_diagram`,
which confirms {astra}`findings/signal_detected`.

{astra}`our preferred method <decisions/algorithm>`     # custom display text
```

Each renders as a neutral text label (a rich theme adds a kind glyph and a hover
preview card). A few specialised variants follow MyST's colon convention
(`{cite:p}` / `{cite:t}`):

```markdown
{astra:numref}`outputs/hubble_diagram`                     # "Figure 3" (like {numref}; supports %s)
{astra:numref}`see Fig. %s <outputs/hubble_diagram>`
{astra:cite}`prior_insights/recon_sharpens_bao`         # "(Chen et al., 2024)"  — parenthetical
{astra:cite:t}`prior_insights/recon_sharpens_bao`       # "Chen et al. (2024)"   — textual
```

### Block embeds — the `{astra}` directive

```markdown
:::{astra} decisions/algorithm
:::                                   # the decision + its tabbed options
:::{astra} outputs/hubble_diagram
:::                                   # the figure (or table / metric), with provenance
:::{astra} findings/signal_detected
:::                                   # claim + notes + scope + evidence
:::{astra} prior_insights/recon_sharpens_bao
:::                                   # the prior insight as an admonition
:::{astra} reconstruction
:::                                   # a nav card linking to the sub-analysis page
:::{astra} outputs
:::                                   # a whole collection → the outputs registry
:::{astra} reconstruction/inputs
:::                                   # the inputs registry for a sub-analysis
```

Options follow MyST's `:key: value` form:

| Option | Meaning |
|---|---|
| `:label:` | Cross-reference label for the rendered block (manage the anchor yourself). |
| `:caption:` | Caption text (figure / table outputs). |
| `:compact:` | Findings: claim + notes + scope only (no evidence figures). |
| `:show:` / `:hide:` | Findings: parts to include / exclude (`claim, notes, scope, evidence`). |
| `:universe:` | Render the element as resolved under a specific universe id. |
| `:class:` | Extra CSS class(es) on the rendered block. |

### Live values — never hard-type a measured number

Pull a number straight from the resolved analysis at build time:

```markdown
{astra:value}`outputs/bao_distance_table col=DV_over_rd tracer=lrg3_elg1 ±`   → 19.88 ± 0.17
{astra:value}`outputs/bao_alpha_values col=alpha1 tracer=elg1 recon=Pre sig=3` → 0.0696
{astra:value}`decisions/algorithm`                                            → the selected option
```

Grammar: `<path> [col=<col>] [<key>=<val> …] [±|pm] [err=<col>] [sig=N]`. For a
table output it reads the CSV/JSON, filters rows by each `key=val`, and renders
the selected cell — append `±` (or `pm`/`err=<col>`) to show `± std`, `sig=N` to
set significant figures. A metric output renders its scalar; a `decisions/<id>`
path renders the option selected under the active universe.

### Native cross-references and embeds

Every element is also a MyST cross-reference target under the `astra:` scheme, so
plain MyST links work — resolved relative to the current page, with `../` and a
leading `/`:

```markdown
[](#astra:outputs/hubble_diagram)              # auto-filled link text
[the diagram](#astra:outputs/hubble_diagram)   # custom text
![](#astra:outputs/hubble_diagram)             # embed a figure output

:::{figure} #astra:outputs/hubble_diagram
:label: fig-hubble
A caption written here, in the report.
:::
```

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
`astra-prior-insight`, `astra-input`/`astra-inputs`/`astra-outputs`,
`astra-option`, `astra-universe`, `astra-subanalysis`) on the node bearing its
`<kind>-<id>` identifier; inline tokens are neutral
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
├── path.ts                   The unified reference path grammar (parse + resolve)
├── loader.ts                 Load a project for one universe (via the SDK) + resolve result files
└── transform/                Per-component renderers used by the plugin
    ├── ast-helpers.ts        Pure AST node constructors
    ├── prose.ts              Parse component Markdown + resolve #astra: cross-references
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
