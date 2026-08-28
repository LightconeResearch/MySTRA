# Getting started

This walk-through takes you from an existing ASTRA project to a live, self-updating report in about five minutes. You will install the MyST CLI, register the plugin, write your first references, and preview the site.

If you'd rather see the authoring vocabulary first, jump to the [authoring guide](authoring/index.md).

## Prerequisites

MySTRA renders reports *on top of* an ASTRA analysis, so you need:

1. **An ASTRA project** — a directory with an `astra.yaml`, a universe in `universes/` (its decision selections drive the report), and (for figures/tables/values) materialised results in `results/`. New to ASTRA? Start with the [ASTRA getting-started guide](https://astra-spec.org/latest/getting-started/) first.
2. **The MyST CLI** (`mystmd`), which needs Node ≥ 18:

    === "npm"

        ```bash
        npm install -g mystmd
        ```

    === "pip / uv"

        ```bash
        uv tool install mystmd     # or: pip install mystmd
        ```

    Verify with `myst --version`.

There is nothing to install for MySTRA itself: MyST loads a plugin from a single bundled `.mjs` file referenced by URL.

## Register the plugin

In your ASTRA project directory, create a `myst.yml` that points at the latest release artifact and lists your pages:

```yaml title="myst.yml"
version: 1
project:
  plugins:
    - https://github.com/LightconeResearch/MySTRA/releases/latest/download/mystra.mjs
  toc:
    - file: index.md
site:
  template: book-theme
```

The `…/releases/latest/download/…` URL always tracks the newest release; MyST fetches and caches the file on the first build.

!!! tip "Pin a version"
    MySTRA is pre-1.0 and the vocabulary may change between releases. For anything you intend to keep building, pin a specific version by swapping `latest` for a tag:

    ```yaml
    - https://github.com/LightconeResearch/MySTRA/releases/download/v0.0.1/mystra.mjs
    ```

## Project layout

MySTRA expects the standard ASTRA conventions:

```
my-analysis/
├── astra.yaml          Analysis specification (decisions, findings, outputs, …)
├── universes/
│   └── baseline.yaml   Decision selections for the baseline universe
├── results/
│   └── baseline/<output-id>.png               Materialised result artifacts
├── myst.yml            Registers the plugin; lists pages
└── index.md            Your report (+ optional sub-analysis pages)
```

MySTRA never scans the results tree. The SDK derives each artifact binding from the selected universe, analysis namespace, output id, and declared `format`; path-backed sub-analyses start their own `results/` namespace.

## Write your first references

Create an `index.md` and reference the analysis instead of restating it. Everything is addressed by a [path](authoring/paths.md) that mirrors `astra.yaml`:

```markdown title="index.md"
# My analysis report

We adopt the {astra}`decisions.fit_method` and find
{astra:value col=slope sig=3}`outputs.fit_params`
for the slope of the relation.

:::{astra} outputs.fit_params
:::

:::{astra} decisions.fit_method
:::
```

Three surfaces, one vocabulary:

- the **`{astra}` role** mentions an element inline — [inline references](authoring/inline-references.md);
- the **`{astra}` directive** embeds it as a block — [block embeds](authoring/block-embeds.md);
- the **`{astra:value}` role** interpolates a live number — [live values](authoring/live-values.md).

Everything else — prose, math, figures you author yourself, the table of contents, multi-page structure — is ordinary MyST.

## Preview

Run the stock MyST CLI from the project directory:

```bash
myst start        # → http://localhost:3000
```

That's it — no custom server and no build step of your own. MySTRA reads `astra.yaml` from the working directory and delegates full validation, universe selection, and resolution to the SDK. With multiple universe files, the SDK selects the first `.yaml` or `.yml` filename in lexical order; with none, it uses authored defaults.

!!! note "Editing `astra.yaml` while the server runs"
    `myst start` watches your Markdown files, not the ASTRA spec. The plugin does detect spec and universe edits (it checks file modification times), but a re-render is only triggered by a Markdown change — so after editing `astra.yaml`, re-save any `.md` page (or restart the server) to see the update.

## Build for publication

```bash
myst build --html
```

produces a static site in `_build/html/` that you can host anywhere. All referenced result artifacts are copied and hashed by MyST's asset pipeline; the output is fully self-contained.

## Next steps

- Learn the full [path grammar](authoring/paths.md) — one idea that drives every surface.
- Split a large report into [multiple pages](authoring/multi-page.md) that mirror your sub-analyses.
- Building a theme? See [theming](reference/theming.md) for the classes, canonical paths, and SDK publication bundle the plugin emits.
