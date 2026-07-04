# Inline references — the `{astra}` role

The `{astra}` role mentions any addressable element inside a sentence:

```markdown
We adopt the {astra}`decisions/algorithm` and report {astra}`outputs/hubble_diagram`,
which confirms {astra}`findings/signal_detected`.
```

Each reference renders as a neutral text label — the element's `label:` (or its id, humanised) — so the sentence reads naturally on any theme. A [rich theme](../reference/theming.md) upgrades the same token with a kind glyph and a hover preview card; the Markdown does not change.

## Custom display text

Override the label with MyST's `text <target>` convention (as used by `{ref}`):

```markdown
{astra}`our preferred method <decisions/algorithm>`
```

## What you can reference

Any [path](paths.md) works — elements, children, and sub-analyses:

```markdown
{astra}`decisions/algorithm`                    a decision (renders its label)
{astra}`decisions/algorithm/options/gp`         one option (renders the option label)
{astra}`outputs/hubble_diagram`                 an output
{astra}`findings/signal_detected`               a finding
{astra}`prior_insights/recon_sharpens_bao`      a prior insight
{astra}`inputs/raw_catalog`                     an input
{astra}`reconstruction`                         a sub-analysis (renders its name)
{astra}`reconstruction/outputs/xi`              an element inside a sub-analysis
```

## Numbered references — `{astra:numref}`

A few specialised variants follow MyST's colon convention (`{cite:p}` / `{cite:t}`). `{astra:numref}` produces a native numbered cross-reference — "Figure 3" — to an output that is [placed as a block](block-embeds.md) somewhere in the report:

```markdown
{astra:numref}`outputs/hubble_diagram`                # "Figure 3" (like {numref})
{astra:numref}`see Fig. %s <outputs/hubble_diagram>`  # custom text; %s is the number
```

MyST fills in the number during its own reference resolution, exactly as it numbers a plain `[](#some-figure)` link. The target must actually be embedded on some page — a numbered reference to an output that is never placed has nothing to point at.

## Citations — `{astra:cite}` and `{astra:cite:t}`

Findings and prior insights can carry DOI-backed evidence. The cite roles turn that evidence into real bibliographic citations through MyST's citation pipeline:

```markdown
{astra:cite}`prior_insights/recon_sharpens_bao`     # "(Chen et al., 2024)" — parenthetical
{astra:cite:t}`prior_insights/recon_sharpens_bao`   # "Chen et al. (2024)"  — textual
```

- The role accepts **findings and prior-insight paths only**.
- Every distinct DOI on the element's evidence is cited; multiple DOIs render as a citation group.
- An element with **no DOI evidence** falls back to a plain inline reference (same as `{astra}`), so the sentence still reads.

Because the citations go through MyST, they participate in the project bibliography: once your `myst.yml` wires a bibliography, the reference list includes these entries automatically.

## Errors and fallbacks

Inline surfaces degrade gracefully rather than breaking the page: a path that cannot be resolved (unknown id, missing scope) still renders a plain label from the path, and a `{astra:cite}` on a non-citable path renders a small inline error token — so a typo is visible in the preview without hiding the surrounding prose.
