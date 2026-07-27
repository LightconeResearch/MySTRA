<div align="center">

# MySTRA

**Write publications on top of [ASTRA](https://github.com/LightconeResearch/astra-spec) analyses — in plain [MyST](https://mystmd.org/) Markdown.**

Pull your decisions, outputs, findings, and live numbers in *by reference*.
One source of truth, no copy-pasted values, no figures that drift out of sync.

[![Docs](https://img.shields.io/badge/docs-online-3178C6.svg)](https://lightconeresearch.github.io/MySTRA/)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](./LICENSE)
[![MyST](https://img.shields.io/badge/MyST-plugin-DE5C42.svg)](https://mystmd.org/)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](#)

</div>

---

> [!WARNING]
> **Early development.** MySTRA is in active, pre-1.0 development. The plugin
> vocabulary and public API may change without notice between releases, and
> there are rough edges. Pin a specific release tag in your `myst.yml` rather
> than tracking `latest`, and expect breaking changes. Feedback and issues are
> very welcome.

You write a normal MyST Markdown document and reference ASTRA components —
decisions, outputs, findings, prior insights, data tables, live numbers. The
components stay single-sourced in your `astra.yaml`; MySTRA reads it at build
time and emits standard MyST AST. It runs on the **stock `myst` CLI and themes**
— no custom server, no copy-pasted numbers, no figures that drift out of sync
with the analysis.

```markdown
We adopt the {astra}`decisions.algorithm.multigrid` and measure
$\alpha =$ {astra:value col=alpha where="tracer=elg1" pm=true}`outputs.alpha_table`,
consistent with {astra:cite}`prior_insights.recon_sharpens_bao`.

:::{astra} outputs.bao_fit_plot
:::
```

→ the decision links to its full record, the value is interpolated live from
the result table (uncertainty included), the prior insight renders as a
citation, and the figure is pulled in with its provenance. Edit `astra.yaml`
and rerun the analysis; the report updates itself.

**[Full documentation →](https://lightconeresearch.github.io/MySTRA/)**

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [Authoring](#authoring)
- [ASTRA project layout](#astra-project-layout)
- [Themes](#themes)
- [What MyST handles for you](#what-myst-handles-for-you)
- [Developing](#developing)
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
`astra.yaml` from the working directory — run `myst` from the ASTRA project
root — and resolves the first universe in `universes/`.

For a five-minute walk-through, see
[getting started](https://lightconeresearch.github.io/MySTRA/getting-started/).

## Authoring

You reference **any part** of an ASTRA analysis with one idea: a **path** that
mirrors `astra.yaml`. One name — `astra` — drives both surfaces, the MyST way
(just as `{math}` is both a role and a directive): wrap a path in the `{astra}`
*role* to mention it inline, or use the `{astra}` *directive* to embed it as a
block.

### Paths — addressing any element

A path is a dot-separated route through the analysis tree — the same dotted
spelling `astra.yaml` itself uses for element references (`when:
decision.option`, `from: scope.id`). Leading segments step into sub-analyses;
the first collection keyword fixes the target.

```
outputs.hubble_diagram                  an output (figure / table / metric / …)
decisions.algorithm                     a decision
decisions.algorithm.gp                  a child — one option of a decision
findings.sig.fig1                       a child — one evidence record of a finding
prior_insights.recon_sharpens_bao       a prior insight
inputs.raw_catalog                      an input
reconstruction.outputs.xi               an output in the `reconstruction` sub-analysis
reconstruction                          the sub-analysis itself
outputs                                 a whole collection (a registry)
```

Collections are the `astra.yaml` keys: `inputs`, `outputs`, `decisions`,
`findings`, `prior_insights` (hyphen alias `prior-insights`), `analyses`,
`universes`. A sub-analysis id may be written directly (the `analyses.` prefix is
implied) and nests to any depth (`clustering.correlation.outputs.xi`). Paths
always resolve from the **root analysis**, so a path means the same thing on
every page (a leading `/` is tolerated).

### Inline references — the `{astra}` role

```markdown
We adopt the {astra}`decisions.algorithm` and report {astra}`outputs.hubble_diagram`,
which confirms {astra}`findings.signal_detected`.

{astra}`our preferred method <decisions.algorithm>`     # custom display text
```

Each renders as a neutral text label (a rich theme adds a kind glyph and a hover
preview card). A few specialised variants follow MyST's colon convention
(`{cite:p}` / `{cite:t}`):

```markdown
{astra:ref}`outputs.hubble_diagram`                     # "Figure 3" (like {ref}; supports %s)
{astra:ref}`see Fig. %s <outputs.hubble_diagram>`       # ({astra:numref} works as an alias)
{astra:cite}`prior_insights.recon_sharpens_bao`         # "(Chen et al., 2024)"  — parenthetical
{astra:cite:t}`prior_insights.recon_sharpens_bao`       # "Chen et al. (2024)"   — textual
```

### Block embeds — the `{astra}` directive

```markdown
:::{astra} decisions.algorithm
:::                                   # the decision + its tabbed options
:::{astra} outputs.hubble_diagram
:::                                   # the figure (or table / metric), with provenance
:::{astra} findings.signal_detected
:::                                   # claim + notes + scope + evidence
:::{astra} prior_insights.recon_sharpens_bao
:::                                   # the prior insight as an admonition
:::{astra} reconstruction
:::                                   # a nav card linking to the sub-analysis page
:::{astra} outputs
:::                                   # a whole collection → the outputs registry
:::{astra} reconstruction.inputs
:::                                   # the inputs registry for a sub-analysis
```

Options follow MyST's `:key: value` form:

| Option | Meaning |
|---|---|
| `:label:` | Cross-reference label for the rendered block (manage the anchor yourself). |
| `:caption:` | Caption text (figure / table outputs). |
| `:compact:` | Findings: claim + notes + scope only (no evidence figures). |
| `:show:` / `:hide:` | Findings: parts to include / exclude (`claim, notes, scope, evidence`). |
| `:class:` | Extra CSS class(es) on the rendered block. |

### Live values — never hard-type a measured number

Pull a number straight from the resolved analysis at build time:

```markdown
{astra:value col=DV_over_rd where="tracer=lrg3_elg1" pm=true}`outputs.bao_distance_table`  → 19.88 ± 0.17
{astra:value col=alpha1 where="tracer=elg1 recon=Pre" sig=3}`outputs.bao_alpha_values`     → 0.0696
{astra:value}`outputs.chi2_reduced`                                                         → a metric's scalar
{astra:value}`decisions.algorithm`                                                          → the selected option
```

The body is the path; the selection is expressed as role options: `col=` picks
the column, `where="key=val …"` filters rows (all pairs must match,
case-insensitively), `pm=true` appends the `± <col>_std` uncertainty
(`err=<col>` names an explicit column), and `sig=N` sets significant figures. A
metric output interpolates its scalar directly with no options; a
`decisions.<id>` path renders the option selected under the active universe.

### Native cross-references

Every embedded element carries a stable MyST anchor `<kind>-<id>`
(`output-hubble_diagram`, `decision-algorithm`, `finding-signal_detected`, …),
so plain MyST links work against it from anywhere in the project:

```markdown
[](#output-hubble_diagram)              # auto-filled, numbered link text
[the diagram](#output-hubble_diagram)   # custom text
```

Everything else — prose, math, figures you author yourself, the table of
contents, multi-page structure — is ordinary MyST. The
[authoring guide](https://lightconeresearch.github.io/MySTRA/authoring/) covers
each surface in depth, including
[multi-page reports](https://lightconeresearch.github.io/MySTRA/authoring/multi-page/)
that mirror your sub-analyses.

## Themes

On the stock `book-theme` with no stylesheet, the document is already clean and
readable: decisions are dropdowns, outputs are real figures/tables, findings and
prior insights are cards, numbers show their value. **No user CSS required.**

A dedicated MyST theme can go further — kind glyphs, per-kind colours, hover
preview cards — driven by the stable `astra-*` classes and the resolved data
store the plugin bakes into every page. Building one? The contract is documented
in [theming](https://lightconeresearch.github.io/MySTRA/reference/theming/).

For project-wide inventory views, MySTRA also emits a versioned
`data.astraInventory` snapshot on each root-scoped project page. Snapshot v1
keeps each record in its declaring scope and routes previewable result images
through MyST's asset pipeline. Themes consume that resolved payload; they do not
parse `astra.yaml`.

## What MyST handles for you

MySTRA writes only the ASTRA→AST bridge and leans on the stock `myst` engine for
everything else: building, serving, asset hashing/copying, live reload of
Markdown, numbering, cross-references, and search. **Citations** are delegated to
MyST too — DOI evidence renders as a `doi.org` link, and a linked reference list
comes for free once a project bibliography is wired.

## Developing

Working on the plugin itself (not needed to *use* it):

```bash
npm install
npm run build    # type-check + compile
npm run bundle   # bundle the single-file plugin → dist/mystra.mjs
npm test         # plugin-emission + store + parser tests
```

## License

[BSD 3-Clause](./LICENSE)
