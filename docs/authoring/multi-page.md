# Multi-page reports

A report can mirror the analysis tree: one page for the root analysis, and one page per sub-analysis. Pages are ordinary MyST pages — you list them in `myst.yml`'s `toc:` — and MySTRA maps each page to an ASTRA **scope** that governs how [`#astra:` links](cross-references.md) resolve and which elements the page's [resolved store](../reference/theming.md) contains.

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

A page that maps to no valid scope (e.g. an appendix about something else entirely) simply gets no ASTRA scope: roles and directives still work — they resolve from the root — but page-relative `#astra:` links and the per-page store are skipped.

## What the scope changes — and what it doesn't

- **Roles and directives always resolve from the root analysis**, on every page. `` {astra}`reconstruction.outputs.xi` `` means the same thing everywhere.
- **`#astra:` links resolve from the page's scope.** On `reconstruction.md`, `[](#astra:outputs.xi)` finds the sub-analysis's own `xi`; `[](#astra:../outputs.hubble)` climbs to the root; `[](#astra:/outputs.hubble)` is always absolute.
- **Cross-page links do the right thing:** a link to an element rendered on another page points at that page.

## Navigation between pages

Embed a sub-analysis by its bare path to get a navigation card linking to its page, or embed the whole `analyses` registry for one card per sub-analysis:

```markdown
:::{astra} reconstruction
:::

:::{astra} analyses
:::
```

## Results for sub-analyses

A sub-analysis that declares `path: ./analyses/<sub>` in `astra.yaml` roots its own `results/<universe>/` tree there; MySTRA resolves each scope's artifacts from the right base automatically. Nothing to configure on the report side.
