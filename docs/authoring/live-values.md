# Live values — the `{astra:value}` role

`{astra:value}` interpolates a real number from the resolved analysis at build time, so **no measured value is ever hard-typed into prose**. The role body is a [path](paths.md); everything else — which cell, how many digits — is expressed as **role options**, written inside the curly braces like MyST inline attributes:

```markdown
{astra:value col=DV_over_rd where="tracer=lrg3_elg1" err=DV_over_rd_std}`outputs.bao_distance_table`   → 19.88 ± 0.17
{astra:value col=alpha1 where="tracer=elg1 recon=Pre" sig=3}`outputs.bao_alpha_values`                 → 0.0696
{astra:value}`outputs.chi2_reduced`                                                                     → 1.5
{astra:value}`decisions.algorithm`                                                                      → MultiGrid
```

Edit `astra.yaml` or rerun the analysis, rebuild, and every number in the prose updates itself.

## Options

| Option | Meaning |
|---|---|
| `col=<column>` | The column to read (required for table outputs). |
| `where="<key>=<val> …"` | Row filters — space- or comma-separated `key=value` pairs; every pair must match, case-insensitively. Alias: `filter=`. |
| `err=<column>` | Uncertainty column to append as `± <value>` (table outputs). A metric's own uncertainty, when it has one, is appended automatically — no option needed. |
| `sig=<N>` | Significant figures for the value (default 4; uncertainties render with 2). |

Option values without spaces can be unquoted (`col=alpha`); quote anything with spaces (`where="tracer=lrg3 recon=Post"`).

!!! note "Requires a current `mystmd`"
    Role options use MyST's [inline options](https://mystmd.org/guide/inline-options) syntax, available in current `mystmd` releases (marked beta upstream). If `myst` reports an unknown role for `` {astra:value col=…}` `` , update the CLI.

## Table outputs

For a table output MySTRA reads the materialised CSV/JSON result, filters rows by each `where=` pair, and renders the selected cell:

```markdown
The LRG3 bin gives $D_V/r_d =$
{astra:value col=DV_over_rd where="tracer=lrg3" err=DV_over_rd_std}`outputs.bao_distance_table`.
```

The filter must select **exactly the row you mean** — if no row matches, the role renders an inline error naming the filter, so a stale filter is visible in the preview rather than silently wrong. Naming an `err=` column that doesn't exist is treated the same way: it renders an inline error rather than silently dropping the uncertainty, since you asked for that column by name. Omit `err=` if the table has no uncertainty to show.

## Metric outputs

A metric output — a JSON scalar, a `[value, uncertainty]` pair, or a `{value, uncertainty, unit}` object — interpolates its value directly, no options needed. If it carries an uncertainty, that uncertainty is appended automatically:

```markdown
The combined fit gives $\chi^2_\nu =$ {astra:value}`outputs.chi2_reduced`,
with $\alpha =$ {astra:value}`outputs.alpha_best`.
```

## Decisions

A `decisions.<id>` path renders the **label of the option selected under the active universe**:

```markdown
All results use the {astra:value}`decisions.algorithm` reconstruction.
```

This is subtly different from `` {astra}`decisions.algorithm` ``: the plain role names the *decision* ("Reconstruction algorithm"), while the value role names the *selection* ("MultiGrid"). Use the value form whenever the prose depends on which option is active — it changes automatically when the universe does.

## Errors

A value that cannot be resolved — missing result file, unknown column, no matching row, a non-tabular product — renders as a small inline code token describing the problem (e.g. ``⟨value: no column "alpha2" in "bao_table"⟩``). The page still builds; the broken value is impossible to miss.
