# Multi-page reports

A report can mirror the analysis tree: one page for the root analysis, and one page per sub-analysis. Pages are ordinary MyST pages — you list them in `myst.yml`'s `toc:` — and MySTRA maps each page to an ASTRA **scope** that determines which elements the page's [resolved store](../reference/theming.md) contains.

## The dotted-filename convention

A page's scope is derived from its file name: each `.`-separated segment is one analysis level.

| File | Scope |
|---|---|
| `index.md` | The root analysis |
| `reconstruction.md` | The `reconstruction` sub-analysis |
| `reconstruction.features.md` | `features` inside `reconstruction` |

```yaml title="myst.yml"
version: 1
project:
  plugins:
    - https://github.com/LightconeResearch/MySTRA/releases/latest/download/mystra.mjs
  toc:
    - file: index.md
    - file: reconstruction.md
    - file: reconstruction.features.md
```

## Overriding the scope

A page whose name doesn't follow the convention can declare its scope explicitly with the `astra_scope` frontmatter key — either dotted or as a list:

```markdown
---
astra_scope: reconstruction.features
---

# Feature extraction
```

```markdown
---
astra_scope:
  - reconstruction
  - features
---
```

Use `astra_scope: ""` to map a page onto the **root** analysis.

A page that maps to no valid scope (e.g. an appendix about something else entirely) simply gets no ASTRA scope: roles and directives still work — they resolve from the root — but the per-page store is skipped. If such a page contains astra elements, the build warns that rich themes will render them as neutral fallbacks; an explicit `astra_scope` that names an unknown scope is reported as an error.

## What the scope changes — and what it doesn't

- **Roles and directives always resolve from the root analysis**, on every page. `` {astra}`reconstruction.outputs.xi` `` means the same thing everywhere.
- **The scope only selects the page's [resolved store](../reference/theming.md)** — which elements a rich theme can join against on that page.
- **Cross-page links work through plain MyST anchors:** every placed block carries a `<kind>-<id>` identifier, and MyST resolves `[](#output-xi)` project-wide to whichever page embeds it.

## Navigation between pages

Embed a sub-analysis by its bare path to get a navigation card linking to its page, or embed the whole `analyses` registry for one card per sub-analysis:

```markdown
:::{astra} reconstruction
:::

:::{astra} analyses
:::
```

## Results for sub-analyses

A sub-analysis that declares `path: ./analyses/<sub>` in `astra.yaml` roots its own `results/<universe>/` tree there, beside its own spec. An **inline** sub-analysis has no directory of its own, so its results nest one level deeper in the parent's tree: `results/<universe>/<sub>/<output-id>.<format>`. MySTRA derives each scope's artifact paths from the right base automatically — nothing to configure on the report side. See [Results layout](../reference/configuration.md#results-layout).
