# Configuration

MySTRA is deliberately configuration-light: one plugin line in `myst.yml` and a results-layout convention. Everything else is data (`astra.yaml`) or composition (your Markdown).

## `myst.yml`

MyST loads a plugin from a single bundled `.mjs` file referenced by URL — there is nothing to `npm install`:

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

The `…/releases/latest/download/…` URL always tracks the newest release; pin a specific version by swapping `latest` for a tag (e.g. `download/v0.0.1/`). MyST fetches and caches the file on the first build. All other `myst.yml` settings — theme, numbering, math macros, bibliography, export targets — are [standard MyST project configuration](https://mystmd.org/guide/frontmatter).

## Project root and universe

MySTRA reads `astra.yaml` from the working directory — run `myst` from the ASTRA project root. The SDK selects the first `.yaml` or `.yml` universe filename in lexical order when files exist, or uses authored defaults when they do not. That resolved universe determines decision selections, active conditional records, and artifact bindings.

The SDK validates the complete project before rendering. Structural or reference errors are reported through MyST with their source file, authored path, and validation code; MySTRA does not publish a partial resolved bundle. The affected syntax remains visibly represented by fallback error text so a preview never hides the failure.

## Results layout

MySTRA delegates artifact resolution to `@astra-spec/sdk`. The SDK never scans the results tree; it derives each known location deterministically:

```
results/<universe-id>/<output-id>.<format>                  # root output
results/<universe-id>/<analysis-id>.<output-id>.<format>   # inline child
```

Deeper inline analysis ids continue the dotted namespace. A path-backed sub-analysis starts a fresh `results/` namespace at its own project root. Every materialized artifact becomes an SDK binding and is handed to MyST's asset pipeline, which hashes and copies it into the build.

## Caching and live reload

- The resolved SDK bundle is shared across pages. The cache tracks every file, directory listing, missing artifact, and metadata entry the SDK reads; a changed nested analysis, universe set, or materialized artifact invalidates it.
- `myst start` watches **Markdown files only**. After editing `astra.yaml` or a universe file, re-save any `.md` page (or restart the server) to trigger a re-render — the plugin will pick up the fresh spec at that point.
- Result artifacts are part of cache freshness, but MyST still needs a Markdown save or restart to trigger the plugin transform after an external tool writes one.

## Two render modes

- **Basic — plugin only.** On the stock `book-theme` with no stylesheet, the document is already clean and readable: decisions are dropdowns, outputs are real figures/tables, findings and prior insights are cards, numbers show their value, and inline references show a plain label. **No user CSS required.**
- **Rich — a dedicated ASTRA theme.** A MyST theme keyed on the `astra-*` classes and canonical paths can add shared ASTRA UI components, record dialogs, and branded treatments, driven by the SDK [publication bundle](theming.md) baked into the build. The only change is the `site.template:` line.

## Bibliography

Citations are delegated to MyST. Every DOI attached to prior-insight or finding evidence is registered with MyST's citation pipeline at build time, so `{astra:cite}` / `{astra:cite:t}` render formatted author–year citations and the entries appear in the project's reference list once a bibliography is wired in `myst.yml`.
