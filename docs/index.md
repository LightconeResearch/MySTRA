# MySTRA

**MySTRA** lets you write publications on top of [ASTRA](https://astra-spec.org/) analyses — in plain [MyST](https://mystmd.org/) Markdown. You write a normal MyST document and reference ASTRA components — decisions, outputs, findings, prior insights, data tables, live numbers — *by reference*. The components stay single-sourced in your `astra.yaml`; MySTRA reads it at build time and emits standard MyST AST.

It runs on the **stock `myst` CLI and themes** — no custom server, no copy-pasted numbers, no figures that drift out of sync with the analysis.

```markdown
We adopt the {astra}`decisions.algorithm.multigrid` and measure
$\alpha =$ {astra:value col=alpha where="tracer=elg1" err=alpha_std}`outputs.alpha_table`,
consistent with {astra:cite}`prior_insights.recon_sharpens_bao`.

:::{astra} outputs.bao_fit_plot
:::
```

→ the decision links to its full record, the value is interpolated live from the result table (uncertainty included), the prior insight renders as a citation, and the figure is pulled in with its provenance. Edit `astra.yaml` and rerun the analysis; the report updates itself.

[:lucide-rocket: **Get started**](getting-started.md){ .md-button .md-button--primary }
[:lucide-book-open: Authoring guide](authoring/index.md){ .md-button }

!!! warning "Alpha development"
    MySTRA is in active, **pre-1.0 development**. The plugin vocabulary, the resolved-store shape, and the public API may change without notice between releases, and there are rough edges. Pin a specific release tag in your `myst.yml` rather than tracking `latest`, and expect breaking changes. Feedback and issues are very welcome on the [GitHub repo](https://github.com/LightconeResearch/MySTRA/issues).

## Why MySTRA?

ASTRA already holds the *truth* of an analysis — every decision, the inputs and outputs of each step, the findings, and the materialised result products. A write-up usually re-types all of that into prose, where it immediately starts to rot: a number gets stale, a figure is from an old run, a stated assumption no longer matches the spec.

MySTRA removes the duplication. The report references the analysis instead of restating it, so there is **one source of truth for the data** and the prose can focus on the argument.

| Concern | Single source of truth |
|---|---|
| **Data** — what a decision/output/finding *is* | `astra.yaml` (+ `universes/`, `results/`) |
| **Composition** — what appears, where, in what order | your `index.md` |
| **Presentation** — how it looks | the MyST theme |

The plugin is a pure **projector** between data and document: it renders the elements you place, fills in the numbers, and makes no authoring or styling decisions of its own.

## At a glance

One name — `astra` — drives every surface, the MyST way (just as `{math}` is both a role and a directive). You address any part of the analysis with a [path](authoring/paths.md) that mirrors `astra.yaml`:

=== "Report (`index.md`)"

    ```markdown
    # BAO from the ELG sample

    We adopt the {astra}`decisions.algorithm.multigrid` and measure
    $\alpha =$ {astra:value col=alpha where="tracer=elg1" err=alpha_std}`outputs.alpha_table`,
    consistent with {astra:cite}`prior_insights.recon_sharpens_bao`.

    :::{astra} outputs.bao_fit_plot
    :caption: The post-reconstruction BAO fit.
    :::

    :::{astra} findings.bao_detected
    :compact:
    :::
    ```

=== "Analysis (`astra.yaml`)"

    ```yaml
    version: "1.0"
    name: BAO from the ELG sample

    outputs:
      - id: alpha_table
        type: table
        description: Best-fit BAO dilation parameters per tracer.
      - id: bao_fit_plot
        type: figure
        description: Correlation function and best-fit model.

    decisions:
      algorithm:
        label: Reconstruction algorithm
        default: multigrid
        options:
          multigrid: { label: MultiGrid }
          iterative_fft: { label: Iterative FFT }

    findings:
      bao_detected:
        claim: The BAO feature is detected at high significance.
    ```

=== "Run it (`myst.yml`)"

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

    ```bash
    myst start        # → http://localhost:3000
    ```

## What MyST handles for you

MySTRA writes only the ASTRA→AST bridge and leans on the stock `myst` engine for everything else: building, serving, asset hashing and copying, live reload of Markdown, numbering, cross-references, and search. Citations are delegated to MyST too — DOI evidence renders as a `doi.org` link, and a linked reference list comes for free once a project bibliography is wired.

---

[:simple-github: GitHub](https://github.com/LightconeResearch/MySTRA){ .md-button }
[:lucide-file-code: ASTRA specification](https://astra-spec.org/){ .md-button }
