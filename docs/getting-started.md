# Getting started

This walk-through takes you from an existing ASTRA project to a live, self-updating report in about five minutes. You will install the MyST CLI, register the plugin, write your first references, and preview the site.

If you'd rather see the authoring vocabulary first, jump to the [authoring guide](authoring/index.md).

## Prerequisites

MySTRA renders reports *on top of* an ASTRA analysis, so you need:

1. **An ASTRA 0.1 project** — a folder in a Git repository with an `astra.yaml`, authored universe entries, tracked inputs and materialized results. Git must be available on PATH. New to ASTRA? Start with the [ASTRA getting-started guide](https://astra-spec.org/latest/getting-started/) first.
2. **The MyST CLI** (`mystmd`), which needs Node ≥ 20:

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

In your ASTRA project directory, create a `myst.yml` that points at a release of the plugin and lists your pages:

```yaml title="myst.yml"
version: 1
project:
  plugins:
    - https://github.com/astra-project/MySTRA/releases/download/v0.1.0rc1/mystra.mjs
  toc:
    - file: index.md
site:
  template: book-theme
```

The URL pins `v0.1.0rc1`, the first release that reads ASTRA 0.1. MyST fetches and caches the file on the first build.

!!! tip "Pinned or latest"
    MySTRA is pre-1.0 and the vocabulary may change between releases, so keep a pinned tag for anything you intend to keep building. To track the newest stable release instead, use:

    ```yaml
    - https://github.com/astra-project/MySTRA/releases/latest/download/mystra.mjs
    ```

    GitHub's `latest` skips release candidates, so this URL reads ASTRA 0.1 analyses only from v0.1.0 on.

## Project layout

MySTRA expects the standard ASTRA conventions:

```
my-analysis/
├── astra.yaml          Analysis specification, including universes
├── results/
│   └── baseline/<output-id>.png               Materialised result artifacts
├── myst.yml            Registers the plugin; lists pages
└── index.md            Your report (+ optional sub-analysis pages)
```

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

MySTRA reads `astra.yaml` from the working directory and resolves all universes through the native TypeScript SDK. Page presentation defaults to the first authored root universe; set `astra_universe: universes.baseline` in page frontmatter to choose explicitly. See [configuration](reference/configuration.md#project-root-and-universe).

!!! note "Editing `astra.yaml` while the server runs"
    `myst start` watches your Markdown files, not the ASTRA spec. Whenever MyST renders a page, the plugin obtains fresh reports and result bytes; only concurrent work is shared. A re-render is still triggered by a Markdown change, so after editing `astra.yaml`, re-save any `.md` page (or restart the server) to see the update.

## Build for publication

```bash
myst build --html
```

produces a static site in `_build/html/` that you can host anywhere. MyST's asset pipeline copies and hashes every result a page displays, so the output is fully self-contained. Data outputs are named by their file path rather than copied.

## Next steps

- Learn the full [path grammar](authoring/paths.md) — one idea that drives every surface.
- Split a large report into [multiple pages](authoring/multi-page.md) that mirror your sub-analyses.
- Building a theme? See [theming](reference/theming.md) for the classes, SDK refs and publication bundle the plugin emits.
