# Paths — addressing any element

A **path** is a dot-separated route through the analysis tree — the same structure as `astra.yaml`, and the same dotted spelling the spec itself uses for element references (`when: decision.option`, `from: scope.id`, recipe placeholders `{inputs.id}`). Dots address elements; slashes are reserved for files. A path is read left-to-right: leading segments step into sub-analyses, and the first collection keyword fixes the target. One grammar drives every surface: the `{astra}` role, the `{astra}` directive, and the `{astra:*}` variants.

```
outputs.hubble_diagram                  an output (figure / table / metric / …)
decisions.algorithm                     a decision
decisions.algorithm.options.gp          a child — one option of a decision
findings.sig.evidence.fig1              a child — one evidence record of a finding
prior_insights.recon_sharpens_bao       a prior insight
inputs.raw_catalog                      an input
reconstruction.outputs.xi               an output in the `reconstruction` sub-analysis
reconstruction                          the sub-analysis itself
outputs                                 a whole collection (a registry)
```

## Collections

The recognised collections are exactly the `astra.yaml` keys:

| Collection | Contains | Singular kind |
|---|---|---|
| `inputs` | Declared input datasets | `input` |
| `outputs` | Figures, tables, metrics, data, reports | `output` |
| `decisions` | Methodological choices and their options | `decision` |
| `findings` | Claims with notes, scope, and evidence | `finding` |
| `prior_insights` | Cited claims from the literature | `prior_insight` |
| `analyses` | Nested sub-analyses | `analysis` |
| `universes` | Decision-selection sets | `universe` |

`prior-insights` (hyphenated) is accepted as an alias for `prior_insights`.

## Sub-analyses

A sub-analysis id may be written directly — the `analyses.` prefix is implied — and nests to any depth:

```
reconstruction.outputs.xi               shorthand
analyses.reconstruction.outputs.xi      the explicit long form
clustering.correlation.outputs.xi       two levels deep
reconstruction                          the sub-analysis itself (renders a nav card)
```

Each segment before the first collection keyword is a step into a sub-analysis; the first collection keyword fixes the target.

## Children

Two element kinds have addressable children:

```
decisions.<id>.options.<option-id>      one option of a decision
findings.<id>.evidence.<evidence-id>    one evidence record of a finding
prior_insights.<id>.evidence.<id>       one evidence record of a prior insight
```

## Registries

A path that stops at a collection addresses the **whole collection** — in a [block embed](block-embeds.md) this renders a registry (a table of inputs or outputs, all findings, all decisions, …):

```
outputs                                 the outputs registry of the root analysis
reconstruction.inputs                   the inputs registry of a sub-analysis
```

## Where paths resolve from

A path always resolves from the **root analysis**, so it means the same thing on every page; a leading `/` is tolerated (`decisions.algorithm` and `/decisions.algorithm` are the same). To address something inside a sub-analysis, spell the scope out: `reconstruction.outputs.xi`.

## IDs and labels

The final path segments are the `id`s you declared in `astra.yaml` (`snake_case` by convention). When MySTRA needs a human-readable label — an inline reference with no display text, for instance — it prefers the element's `label:` (or `name:` for analyses) and falls back to the id with underscores replaced by spaces.
