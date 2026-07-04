# Live values — the `{astra:value}` role

`{astra:value}` interpolates a real number from the resolved analysis at build time, so **no measured value is ever hard-typed into prose**:

```markdown
{astra:value}`outputs.bao_distance_table col=DV_over_rd tracer=lrg3_elg1 ±`   → 19.88 ± 0.17
{astra:value}`outputs.bao_alpha_values col=alpha1 tracer=elg1 recon=Pre sig=3` → 0.0696
{astra:value}`decisions.algorithm`                                             → MultiGrid
```

Edit `astra.yaml` or rerun the analysis, rebuild, and every number in the prose updates itself.

## Grammar

The role body is whitespace-separated:

```
<path> [col=<column>] [<key>=<val> …] [±|pm] [err=<column>] [sig=N]
```

| Token | Meaning |
|---|---|
| `<path>` | A table or metric output (`outputs.bao_table`; sub-analysis scopes allowed), or a decision (`decisions.algorithm` → its selected option). |
| `col=<column>` | The column to read (required for table outputs). |
| `<key>=<val>` | Row filters — every pair must match, e.g. `tracer=lrg3 recon=Post`. Matching is case-insensitive. |
| `±` or `pm` | Also render `± <col>_std` when that column exists in the table. |
| `err=<column>` | Explicit uncertainty column (instead of the `<col>_std` convention). |
| `sig=N` | Significant figures for the value (default 4; uncertainties render with 2). |

## Table outputs

For a table output MySTRA reads the materialised CSV/JSON result, filters rows by each `key=val`, and renders the selected cell:

```markdown
The LRG3 bin gives $D_V/r_d =$
{astra:value}`outputs.bao_distance_table col=DV_over_rd tracer=lrg3 ±`.
```

The filters must select **exactly the row you mean** — if no row matches, the role renders an inline error naming the filter, so a stale filter is visible in the preview rather than silently wrong.

## Metric outputs

A metric output renders its scalar value directly — no `col=` needed beyond what the product's tabular form requires.

## Decisions

A `decisions.<id>` path renders the **label of the option selected under the active universe**:

```markdown
All results use the {astra:value}`decisions.algorithm` reconstruction.
```

This is subtly different from `` {astra}`decisions.algorithm` ``: the plain role names the *decision* ("Reconstruction algorithm"), while the value role names the *selection* ("MultiGrid"). Use the value form whenever the prose depends on which option is active — it changes automatically when the universe does.

## Errors

A value that cannot be resolved — missing result file, unknown column, no matching row, a non-tabular product — renders as a small inline code token describing the problem (e.g. ``⟨value: no column "alpha2" in "bao_table"⟩``). The page still builds; the broken value is impossible to miss.
