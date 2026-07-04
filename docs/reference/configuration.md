# Configuration

MySTRA is deliberately configuration-light: one plugin line in `myst.yml`, two optional environment variables, and a results-layout convention. Everything else is data (`astra.yaml`) or composition (your Markdown).

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

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ASTRA_PROJECT_ROOT` | `process.cwd()` | The ASTRA project directory (where `astra.yaml` lives) |
| `ASTRA_UNIVERSE` | first in `universes/` | Which universe's decision selections to resolve |

```bash
ASTRA_UNIVERSE=no_recon myst build --html
```

The active universe determines every decision selection in the report: which option a decision block marks as selected, what `` {astra:value}`decisions.<id>` `` renders, which conditional (`when:`) decisions are shown, and which `results/<universe>/` tree artifacts resolve from. Individual blocks can override it with the [`:universe:` option](../authoring/block-embeds.md#options).

## Results layout

MySTRA never scans the results tree. It computes each output's artifact location deterministically from the convention:

```
<analysis path>/results/<universe-id>/<output-id>/<output-id>.<ext>
```

and resolves the file lazily, as it renders. A sub-analysis that declares `path: ./analyses/<sub>` in `astra.yaml` roots its own `results/<universe>/` tree at that path. Image artifacts are handed to MyST's asset pipeline, which hashes and copies them into the build.

## Caching and live reload

- `astra.yaml` is parsed once per build and cached; the cache is invalidated when `astra.yaml` or the active universe file changes on disk (by modification time).
- `myst start` watches **Markdown files only**. After editing `astra.yaml` or a universe file, re-save any `.md` page (or restart the server) to trigger a re-render — the plugin will pick up the fresh spec at that point.
- Result artifacts are not watched: a rebuild that regenerates them is the expected re-entry point.

## Two render modes

- **Basic — plugin only.** On the stock `book-theme` with no stylesheet, the document is already clean and readable: decisions are dropdowns, outputs are real figures/tables, findings and prior insights are cards, numbers show their value, and inline references show a plain label. **No user CSS required.**
- **Rich — a dedicated ASTRA theme.** A MyST theme keyed on the `astra-*` classes the plugin emits can add glyphs, per-kind colours, hover preview cards, and richer patterns, all driven from the [resolved store](theming.md) the plugin bakes into the build. The only change is the `site.template:` line. (This theme is a separate deliverable; until it ships, `book-theme` is the baseline.)

## Bibliography

Citations are delegated to MyST. Every DOI attached to prior-insight or finding evidence is registered with MyST's citation pipeline at build time, so `{astra:cite}` / `{astra:cite:t}` render formatted author–year citations and the entries appear in the project's reference list once a bibliography is wired in `myst.yml`.
