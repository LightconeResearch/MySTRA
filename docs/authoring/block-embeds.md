# Block embeds — the `{astra}` directive

The `{astra}` directive embeds any addressable element, child, or collection as a block. The [path](paths.md) decides what is rendered; the directive makes no styling decisions of its own, so the result is clean on the stock `book-theme` and richer under a dedicated theme.

```markdown
:::{astra} decisions.algorithm
:::
```

## What each path renders

| Path | Renders |
|---|---|
| `decisions.<id>` | The decision: label, rationale, and its options as tabs, with the universe's selection marked |
| `decisions.<id>.options.<id>` | One option: label, description, supporting insights |
| `outputs.<id>` | The output — a real figure, table, or metric — with its provenance |
| `findings.<id>` | The finding: claim + notes + scope + evidence |
| `findings.<id>.evidence.<id>` | One evidence record |
| `prior_insights.<id>` | The prior insight as a "see also" admonition with its evidence |
| `inputs.<id>` | The input as a one-row registry table |
| `<sub-analysis>` | A navigation card linking to the sub-analysis page |
| `universes.<id>` | A table of the universe's decision → selected-option pairs |
| `inputs`, `outputs`, `decisions`, `findings`, `prior_insights`, `analyses`, `universes` | The whole collection — a registry |

Examples:

```markdown
:::{astra} outputs.hubble_diagram
:::                                   # the figure (or table / metric), with provenance

:::{astra} findings.signal_detected
:::                                   # claim + notes + scope + evidence

:::{astra} reconstruction
:::                                   # a nav card linking to the sub-analysis page

:::{astra} outputs
:::                                   # a whole collection → the outputs registry

:::{astra} reconstruction.inputs
:::                                   # the inputs registry for a sub-analysis
```

## Options

Options follow MyST's `:key: value` form:

| Option | Meaning |
|---|---|
| `:label:` | Cross-reference label for the rendered block. This **replaces** the default `<kind>-<id>` anchor — manage the anchor yourself if you set it. |
| `:caption:` | Caption text (figure / table outputs). Markdown is allowed. |
| `:compact:` | Findings: claim + notes + scope only (no evidence). |
| `:show:` | Findings: parts to include, from `claim, notes, scope, evidence` (comma- or space-separated). The claim is always kept. |
| `:hide:` | Findings: parts to exclude (same part names). |
| `:class:` | Extra CSS class(es) on the rendered block. |

```markdown
:::{astra} outputs.bao_fit_plot
:caption: The post-reconstruction fit; see {astra}`decisions.algorithm`.
:label: fig-bao
:::

:::{astra} findings.bao_detected
:hide: evidence, scope
:::
```

## Universes

`:::{astra} universes.<id>` embeds a **selection table** — the decision → selected-option pairs of the project's universe (the first `.yaml` file in `universes/`).

## Cross-referencing an embedded block

Every embedded element carries a stable anchor `<kind>-<id>` (`output-hubble_diagram`, `decision-algorithm`, `finding-signal_detected`, …), so you can point at it from anywhere with plain MyST links (`[](#output-hubble_diagram)`) or `{astra:ref}`. Figures and tables are numbered by MyST as usual.

## Errors

A directive whose path cannot be resolved (unknown id, wrong scope, unmet `when:` condition on a decision) renders an **error admonition** in place, naming the path and the reason — the rest of the page builds normally.
