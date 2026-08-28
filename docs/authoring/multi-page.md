# Multi-page reports

A report can mirror the analysis tree: one page for the root analysis, and one page per sub-analysis. Pages are ordinary MyST pages — you list them in `myst.yml`'s `toc:` — and MySTRA maps each page to an active ASTRA **scope** for rich-theme context.

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

A page whose filename does not name an analysis (for example, an appendix) uses the root as its active scope. An explicit `astra_scope` that names an unknown analysis is reported as an error and also falls back to the root. The complete [publication bundle](../reference/theming.md) is available on every page either way.

## What the scope changes — and what it doesn't

- **Roles and directives always resolve from the root analysis**, on every page. `` {astra}`reconstruction.outputs.xi` `` means the same thing everywhere.
- **The scope selects `activeAnalysisPath` in the [publication bundle](../reference/theming.md)** — rich themes can use it as page context. The bundle itself always contains the complete resolved project.
- **Analysis-reference links come only from this configured page map.** If exactly one concrete `file:` entry in `project.toc` maps to a sub-analysis, `` {astra}`reconstruction` `` exposes that page's MyST route to a rich theme. Unlisted, multiply mapped, or pattern-expanded pages remain unlinked; MySTRA never turns an analysis id into a guessed URL.
- **Cross-page links remain ordinary MyST:** give a placed block an explicit `:label:` and reference that label with `{ref}`.

## Sub-analysis summaries

Embed a sub-analysis by its bare path to get a neutral summary card, or embed the whole `analyses` registry for one card per sub-analysis. Summary cards remain neutral content; page navigation itself stays in MyST's table of contents:

```markdown
:::{astra} reconstruction
:::

:::{astra} analyses
:::
```

## Results for sub-analyses

Artifact paths come directly from the SDK's deterministic bindings, including inline and path-backed sub-analyses. MySTRA does not scan result directories or reconstruct that convention itself. Nothing is configured on the report side.
