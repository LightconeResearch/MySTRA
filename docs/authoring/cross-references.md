# Cross-references — the `#astra:` scheme

Every ASTRA element is also a MyST cross-reference target under the `astra:` scheme, so **plain MyST link and embed syntax** works alongside the roles and directives:

```markdown
[](#astra:outputs/hubble_diagram)              # auto-filled link text
[the diagram](#astra:outputs/hubble_diagram)   # custom text
![](#astra:outputs/hubble_diagram)             # embed a figure output
```

Use this surface when you want MyST-native behaviour — numbered links, figure embeds with your own caption — rather than the plugin's rendered blocks.

## Figure embeds with your own caption

The image form composes with MyST's `{figure}` directive, which lets the caption and label live in the report while the image stays single-sourced in the results tree:

```markdown
:::{figure} #astra:outputs/hubble_diagram
:label: fig-hubble
A caption written here, in the report.
:::
```

## Resolution is page-relative

Unlike [roles and directives](paths.md#where-paths-resolve-from) (which resolve from the root analysis), `#astra:` paths resolve **relative to the current page's scope** (see [multi-page reports](multi-page.md)), and support the full relative grammar:

```markdown
[](#astra:outputs/xi)              # `xi` in this page's scope
[](#astra:../outputs/xi)           # climb one scope towards the root
[](#astra:/outputs/hubble)         # absolute — from the root analysis
[](#astra:features/outputs/pca)    # descend into the `features` sub-analysis
```

On the root `index.md` page the two conventions coincide.

## Same page or another page?

MySTRA resolves each `#astra:` link to wherever the element actually lives:

- If the target element belongs to **this page's scope**, the link becomes an in-page cross-reference to the element's anchor (`<kind>-<id>`).
- If it belongs to **another scope** — a sub-analysis with its own page — the link points at that page.

## Anchors from `astra.yaml` prose too

The same scheme works *inside* the analysis: narrative sections, decision rationales, option descriptions, and finding notes written in `astra.yaml` may contain `#astra:` links, and MySTRA resolves them when it renders that prose into the report. Anchors written for ASTRA's own narrative validation keep working in the published document.

## When to use which reference surface

| You want | Write |
|---|---|
| A semantic mention with a hover card on rich themes | `` {astra}`decisions/algorithm` `` |
| "Figure 3"-style numbering | `` {astra:ref}`outputs/hubble_diagram` `` |
| A plain MyST link (auto or custom text) | `[](#astra:outputs/hubble_diagram)` |
| The output embedded with the plugin's provenance block | `:::{astra} outputs/hubble_diagram` |
| The bare image under your own figure/caption | `:::{figure} #astra:outputs/hubble_diagram` |
