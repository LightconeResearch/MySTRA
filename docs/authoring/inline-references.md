# Inline references — the `{astra}` role

The `{astra}` role mentions any addressable element inside a sentence:

```markdown
We adopt the {astra}`decisions.algorithm` and report {astra}`outputs.hubble_diagram`,
which confirms {astra}`findings.signal_detected`.
```

Each reference renders as a neutral text label — the element's `label:` (or its id, humanised) — so the sentence reads naturally on any theme. A [rich theme](../reference/theming.md) upgrades the same token with a kind glyph and a hover preview card; the Markdown does not change.

## Custom display text

Override the label with MyST's `text <target>` convention (as used by `{ref}`):

```markdown
{astra}`our preferred method <decisions.algorithm>`
```

## What you can reference

Any [path](paths.md) works — elements, children, and sub-analyses:

```markdown
{astra}`decisions.algorithm`                    a decision (renders its label)
{astra}`decisions.algorithm.gp`                 one option (renders the option label)
{astra}`outputs.hubble_diagram`                 an output
{astra}`findings.signal_detected`               a finding
{astra}`prior_insights.recon_sharpens_bao`      a prior insight
{astra}`inputs.raw_catalog`                     an input
{astra}`reconstruction`                         a sub-analysis (renders its name)
{astra}`reconstruction.outputs.xi`              an element inside a sub-analysis
```

## Numbered references — `{astra:ref}`

A few specialised variants follow MyST's colon convention (`{cite:p}` / `{cite:t}`). `{astra:ref}` produces a native numbered cross-reference — "Figure 3" — to an output that is [placed as a block](block-embeds.md) somewhere in the report:

```markdown
{astra:ref}`outputs.hubble_diagram`                # "Figure 3" (like {ref})
{astra:ref}`see Fig. %s <outputs.hubble_diagram>`  # custom text; %s is the number
```

MyST fills in the number during its own reference resolution, exactly as it numbers a plain `[](#some-figure)` link — the role is sugar for writing `[Fig. %s](#output-hubble_diagram)` without knowing the anchor convention. The target must actually be embedded on some page — a numbered reference to an output that is never placed has nothing to point at. `{astra:numref}` is accepted as an alias (mirroring MyST, where `numref` is itself an alias of `{ref}`).

## Citations — `{astra:cite}` and `{astra:cite:t}`

Findings and prior insights can carry DOI-backed evidence. The cite roles turn that evidence into real bibliographic citations through MyST's citation pipeline:

```markdown
{astra:cite}`prior_insights.recon_sharpens_bao`     # "(Chen et al., 2024)" — parenthetical
{astra:cite:t}`prior_insights.recon_sharpens_bao`   # "Chen et al. (2024)"  — textual
```

- The role accepts **findings and prior-insight paths only**.
- Every distinct DOI on the element's evidence is cited; multiple DOIs render as a citation group.
- An element with **no DOI evidence** falls back to a plain inline reference (same as `{astra}`), so the sentence still reads.

Because the citations go through MyST, they participate in the project bibliography: once your `myst.yml` wires a bibliography, the reference list includes these entries automatically.

## Errors and fallbacks

Inline surfaces degrade gracefully rather than breaking the page: a path that cannot be resolved (unknown id, missing scope) still renders a plain label from the path, and a `{astra:cite}` on a non-citable path renders a small inline error token — so the surrounding prose keeps reading.

Every unresolved path is **reported** on the build's diagnostics channel, with the file and line:

```
⛔️ index.md:12:3 astra "outputs.does_not_exist": no output "does_not_exist" in this scope — rendering a plain label
```

This matters because the fallback label is derived from the id (`does_not_exist` → "does not exist"), which can read as ordinary English. Renaming an element in `astra.yaml` breaks every reference to it; the diagnostic is what stops the broken references from reaching a reader as fluent prose.

An element that *exists* but declares no `label:` is not an error — its humanized id is the intended label. Universe ids are also not checked: the active universe is one file among however many the project ships.

A decision re-exported into a sub-analysis (`from: ../algorithm`) is a pure pointer that declares neither a label nor options. Both `` {astra}`sub.decisions.alias` `` and `` {astra}`sub.decisions.alias.option` `` follow the pointer to the scope that declares it, so they read the source's labels rather than the alias id.
