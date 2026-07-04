# Referencing ASTRA components in MySTRA — Design Proposal

> Status: proposal / draft documentation
> Audience: report authors (the humans who write the Markdown)

This document describes a redesigned, ground-up system for referencing **any part
of an ASTRA analysis** from inside a MySTRA report. It is written as
user-facing documentation: if this proposal is adopted, this is roughly the page
an author would read to learn the syntax.

The design follows [MyST's own conventions for roles and directives](https://mystmd.org/guide/syntax-overview)
as closely as possible, so that everything you already know about MyST
cross-references, citations, and embedding carries over directly.

---

## 1. The one idea you need

Every report is a view onto an **ASTRA analysis tree**. That tree is exactly the
structure of your `astra.yaml`:

```yaml
# astra.yaml (sketch)
inputs:        { raw_catalog: {…} }
outputs:       { hubble_diagram: {…} }
decisions:     { algorithm: { options: { gp: {…}, spline: {…} } } }
findings:      { signal_detected: { evidence: { fig1: {…} } } }
prior_insights:{ recon_sharpens_bao: {…} }
analyses:                       # sub-analyses, nested to any depth
  reconstruction:
    decisions: { method: {…} }
    outputs:   { xi: {…} }
```

To reference **anything**, you write the **path to it in that tree**:

```
decisions/algorithm                      the "algorithm" decision (this page's scope)
decisions/algorithm/options/gp           one option of that decision
outputs/hubble_diagram                   an output (figure / table / metric / …)
findings/signal_detected/evidence/fig1   one piece of evidence behind a finding
reconstruction/outputs/xi                an output inside the "reconstruction" sub-analysis
```

There are then only **two things you do with a path**:

| You want to…                                   | Use…                  | MyST kind |
|------------------------------------------------|-----------------------|-----------|
| **mention / cite** it in a sentence (inline)   | the `{astra}` *role*  | inline    |
| **embed / present** it as a block              | the `{astra}` *directive* | block |

That's the whole model. One path grammar, one name (`astra`), used inline as a
role and as a block as a directive — the same way MyST reuses `{math}` both as a
role and a directive. Everything else on this page is detail.

### Design principles (why it looks like this)

1. **One addressing scheme for everything.** A finding's third piece of
   evidence, a single option of a decision, a sub-analysis three levels deep, a
   cell in a results table — all are reachable with the *same* path grammar. If
   it exists in `astra.yaml`, you can point at it.
2. **The path *is* the `astra.yaml` structure.** No second mental model to learn.
   Collection names (`outputs`, `decisions`, `findings`, …) are the YAML keys;
   nesting uses `/` like a file path; `..` and a leading `/` mean what they mean
   in every shell on earth.
3. **Roles for inline, directives for blocks** — the fundamental MyST split. You
   never have to remember which custom name does which; it's `{astra}` either way.
4. **Native MyST first.** Every element is also a normal MyST *cross-reference
   target*, so plain `[text](#…)`, the `@` shorthand, hover previews,
   `![](#…)` figure-embeds, and `{figure}` wrappers all work without learning
   anything ASTRA-specific.
5. **Variants follow MyST's colon convention.** Just as MyST has `{cite:p}` and
   `{cite:t}`, the small number of specialised behaviours are colon-suffixed:
   `{astra:numref}`, `{astra:value}`, `{astra:cite}`. Nothing ad-hoc.

---

## 2. Paths: addressing any component

A path is a slash-separated route through the analysis tree. Read it left to
right exactly like a file path.

### 2.1 Collections and ids

The first meaningful segment is a **collection** (a top-level ASTRA key), and the
next is the **id** of the element inside it:

```
inputs/<id>
outputs/<id>
decisions/<id>
findings/<id>
prior_insights/<id>          (hyphen alias: prior-insights/<id>)
universes/<id>
analyses/<id>                a sub-analysis
```

Examples:

```
outputs/hubble_diagram
decisions/algorithm
findings/signal_detected
prior_insights/recon_sharpens_bao
```

### 2.2 Children (going inside an element)

Some elements contain addressable children. Keep walking the path:

```
decisions/algorithm/options/gp              an Option of a Decision
findings/signal_detected/evidence/fig1      an Evidence record of a Finding
prior_insights/recon_sharpens_bao/evidence/chen2024
```

### 2.3 Scopes (sub-analyses) and the `analyses/` shorthand

Sub-analyses live under `analyses/`. Because sub-analyses are the *only* nestable
container, the `analyses/` segment is **optional** — a bare sub-analysis id at the
front of a path is understood as a scope step:

```
analyses/reconstruction/outputs/xi          full form
reconstruction/outputs/xi                    shorthand — identical meaning
clustering/correlation/outputs/xi            two scopes deep
reconstruction                               the sub-analysis itself
```

### 2.4 Relative, absolute, and parent paths

Paths resolve **relative to the scope of the current page** by default (a page
that renders the `reconstruction` sub-analysis has `reconstruction` as its
scope). Use the familiar file-path markers to move around:

```
outputs/xi              relative to this page's scope
/outputs/xi             absolute — from the root analysis
../outputs/xi           the parent scope
../../decisions/method  two scopes up
```

This single rule is what makes the system *powerful enough to reference any part
of any analysis or sub-analysis from anywhere*: every element has both a stable
absolute address (`/…`) and convenient relative ones.

### 2.5 Grammar (reference)

```
path        ::= ["/"] step* target
step        ::= (".." | sub-analysis-id) "/"          ; ".." climbs, name descends
target      ::= collection "/" id child*
            |   sub-analysis-id                        ; the sub-analysis itself
            |   collection                             ; the whole collection (a registry)
collection  ::= "inputs" | "outputs" | "decisions" | "findings"
             |  "prior_insights" | "analyses" | "universes"
child       ::= "/" ("options" | "evidence") "/" id
```

A path that stops at a **collection** (e.g. `outputs`, `reconstruction/inputs`)
addresses the whole registry — useful for the directive forms in §4.4.

---

## 3. Referencing inline — the `{astra}` role

Wrap a path in the `{astra}` role to drop a smart, linked mention into prose. It
behaves like MyST's `{ref}`: by default it renders the element's label as a
hyperlink, with a hover preview.

```markdown
We adopt the {astra}`decisions/algorithm` and report the
{astra}`outputs/hubble_diagram`, which confirms {astra}`findings/signal_detected`.
```

renders roughly as:

> We adopt the [GP reconstruction] and report the [Hubble diagram], which
> confirms [a >5σ signal].

### 3.1 Custom display text

Use MyST's standard `text <target>` override (identical to `{ref}`):

```markdown
{astra}`our preferred method <decisions/algorithm>`
```

### 3.2 The native link / `@` forms

Because every element is a real cross-reference target, you never *have* to use
the role. These are equivalent and fully MyST-native:

```markdown
{astra}`outputs/hubble_diagram`            the role (most explicit, always works)
[](#astra:outputs/hubble_diagram)          markdown link, auto-filled text
[the diagram](#astra:outputs/hubble_diagram)   markdown link, custom text
@astra:outputs/hubble_diagram              @-shorthand (where your MyST build supports it)
```

Targets are namespaced under the `astra:` scheme so they never collide with your
own labels or bibliography keys. Leaving the link text empty auto-fills the label
or number, exactly as MyST does for figures and sections.

### 3.3 Role variants (the colon family)

Following MyST's `{cite:p}` / `{cite:t}` convention, a few specialised behaviours
are colon-suffixed. Each takes the same path grammar.

| Role | Purpose | Example | Renders |
|------|---------|---------|---------|
| `{astra}` | smart linked reference (default per kind) | `` {astra}`outputs/hubble_diagram` `` | "Hubble diagram" (link) |
| `{astra:numref}` | numbered reference (like `{numref}`) | `` {astra:numref}`outputs/hubble_diagram` `` | "Figure 3" |
| `{astra:value}` | extract a live value (see §6) | `` {astra:value}`outputs/h0` `` | "67.4" |
| `{astra:cite}` | bibliographic citation, parenthetical | `` {astra:cite}`prior_insights/recon_sharpens_bao` `` | "(Chen et al., 2024)" |
| `{astra:cite:t}` | bibliographic citation, textual | `` {astra:cite:t}`prior_insights/recon_sharpens_bao` `` | "Chen et al. (2024)" |

`{astra:numref}` supports the `%s` number placeholder and the `{label}` placeholder
in custom text, just like `{numref}`:

```markdown
{astra:numref}`see Fig. %s <outputs/hubble_diagram>`     → "see Fig. 3"
{astra:numref}`the {label} (Fig. %s) <outputs/hubble_diagram>`
```

---

## 4. Embedding as a block — the `{astra}` directive

Use `{astra}` as a directive (block form) to **render** the addressed component
in place. The path is the directive argument. Use colon fences `:::` (the body is
Markdown) per MyST's recommendation.

```markdown
:::{astra} decisions/algorithm
:::
```

By default each kind gets a sensible presentation (see §5). The directive is
recursive over the path grammar: point it at a single element, a child, or a
whole collection, and it renders the appropriate thing.

### 4.1 Single element

```markdown
:::{astra} outputs/hubble_diagram
:::

:::{astra} findings/signal_detected
:::

:::{astra} reconstruction
:::                              # a sub-analysis → a navigation/summary card
```

### 4.2 Options

```markdown
:::{astra} decisions/algorithm
:::                              # all options, rendered as tabs by default

:::{astra} decisions/algorithm/options/gp
:::                              # just one option
```

### 4.3 Children of findings (evidence)

```markdown
:::{astra} findings/signal_detected
:hide: evidence
:::                              # claim + notes only

:::{astra} findings/signal_detected/evidence/fig1
:::                              # a single evidence figure
```

### 4.4 Collections / registries

Point the directive at a collection to render its registry table:

```markdown
:::{astra} inputs
:::                              # the inputs registry for this scope

:::{astra} reconstruction/outputs
:::                              # the outputs registry for a sub-analysis
```

### 4.5 Directive options

All options follow MyST's standard `:key: value` form.

| Option | Meaning |
|--------|---------|
| `:label:` (alias `:name:`) | Give this rendered block a label so *it* can be cross-referenced (standard MyST). |
| `:caption:` | Caption text for figure/table/card renders. |
| `:as:` | Presentation override. Outputs: `figure \| table \| metric \| value`. Decisions: `tabs \| list \| table`. Collections: `table \| list \| cards`. |
| `:show:` / `:hide:` | Comma-list of parts to include/exclude: `claim, rationale, notes, evidence, options, recipe, provenance`. |
| `:compact:` | Boolean. Dense rendering (label + essentials, no heavy media). |
| `:universe:` | Render the element as it resolves under a named universe, overriding the page's active one. |
| `:class:` | Extra CSS classes (standard MyST). |

Example:

```markdown
:::{astra} outputs/hubble_diagram
:as: table
:caption: Distance–redshift measurements used in the fit.
:label: tbl-hubble
:::
```

### 4.6 Native embedding interop

Outputs are figures/tables, so MyST's native transclusion works directly — handy
when you want to wrap an output in a standard `{figure}` or `{table}`:

```markdown
![](#astra:outputs/hubble_diagram)          # embed the rendered output

:::{figure} #astra:outputs/hubble_diagram
:label: fig-hubble
A caption written here, in the report.
:::
```

---

## 5. How each kind renders

The path's collection determines both the default *auto-label* (what an empty
inline reference fills in) and the default *block presentation*.

| Kind | Inline default (`{astra}`) | Block default (`:::{astra}`) |
|------|----------------------------|------------------------------|
| `inputs/<id>` | input label | a row/card describing the source |
| `outputs/<id>` | output label; `{astra:numref}` → "Figure/Table N" | the figure / table / metric, with caption + provenance |
| `decisions/<id>` | decision label | its options (tabs by default) + rationale |
| `decisions/<id>/options/<id>` | option label | one option (description, support) |
| `findings/<id>` | finding label/claim | claim + scope + notes + evidence blocks |
| `findings/<id>/evidence/<id>` | the evidence (e.g. "Fig. N" or citation) | the single evidence item |
| `prior_insights/<id>` | insight label; auto-appends its citation | a `seealso` admonition (claim + citation) |
| `analyses/<id>` | sub-analysis name | a navigation/summary card linking to its page |
| `universes/<id>` | universe label | the universe's decision selections |

Auto-label resolution always falls back gracefully: explicit `label` →
humanised id. Inline references to outputs participate in MyST numbering, so
`{astra:numref}` yields stable "Figure 3" / "Table 2" style text.

---

## 6. Pulling live values — `{astra:value}`

`{astra:value}` inlines a *number* taken straight from the resolved analysis, so
the prose never drifts from the results. It is the one role with a richer body
grammar, because selecting a scalar sometimes needs a row + column.

```
{astra:value}`<path> [col=<column>] [<key>=<value> …] [±] [err=<column>] [sig=<n>]`
```

| Target | Example | Renders |
|--------|---------|---------|
| **Metric output** (already scalar) | `` {astra:value}`outputs/h0` `` | `67.4` |
| **Table cell** (pick column + filter rows) | `` {astra:value}`outputs/bao_table col=DV_over_rd tracer=lrg3` `` | `19.88` |
| **…with uncertainty** | `` {astra:value}`outputs/bao_table col=DV_over_rd tracer=lrg3 ±` `` | `19.88 ± 0.17` |
| **…explicit error column / precision** | `` {astra:value}`outputs/bao_table col=alpha tracer=elg1 err=alpha_err sig=3` `` | `0.0696` |
| **Decision** (→ selected option under the active universe) | `` {astra:value}`decisions/algorithm` `` | `GP reconstruction` |

Rules:
- `col=` selects the value column (required for table outputs).
- bare `key=value` pairs filter rows (case-insensitive); the match must be unique.
- `±` appends the matching `<col>_std` / `<col>_err` column if present;
  `err=<column>` names it explicitly.
- `sig=<n>` sets significant figures (default 4); `dp=<n>` sets decimal places.

Because the selection rides on the same path, the *same value role* reads a
metric, a table cell, **or** which option a decision resolved to under the active
universe — one role, every scalar in the analysis.

---

## 7. Citations and bibliography

Findings and prior insights carry **evidence**, some of which are DOIs. Those
DOIs flow into MyST's normal citation/bibliography pipeline, so you get author–year
citations and an auto-generated reference list with no extra work.

```markdown
This matches earlier work {astra:cite}`prior_insights/recon_sharpens_bao`.
{astra:cite:t}`prior_insights/recon_sharpens_bao` first reported the effect.
```

renders:

> This matches earlier work (Chen et al., 2024).
> Chen et al. (2024) first reported the effect.

- `{astra:cite}` → parenthetical, mirroring `{cite:p}`.
- `{astra:cite:t}` → textual/narrative, mirroring `{cite:t}`.
- A plain `{astra}` reference to a prior insight links to its rendered card; the
  `{astra:cite}` variants are for when you want a formatted bibliographic citation
  in the sentence.
- Multiple DOIs on one insight are grouped, like MyST's `;`-separated citations.

You can also cite a finding's evidence directly:
`` {astra:cite}`findings/signal_detected/evidence/chen2024` ``.

---

## 8. Cross-referencing what you embed

Anything you embed can be labelled and then referenced like any MyST object,
which closes the loop:

```markdown
:::{astra} outputs/hubble_diagram
:label: fig-hubble
:::

As [](#fig-hubble) shows, the fit is excellent.
```

Two ways to reference, both valid:
- **By ASTRA path** — `{astra}`outputs/hubble_diagram`` or
  `[](#astra:outputs/hubble_diagram)`. Works even with no manual label, anywhere
  in the project.
- **By your own label** — the `:label:` you gave the embed, referenced with plain
  MyST. Best when you want a specific caption/number tied to a specific placement.

---

## 9. Worked example

```markdown
---
title: Hubble Diagram Analysis
---

## Method

We measure the expansion history under several methodological choices. The
central one is {astra}`decisions/algorithm`; we adopt
{astra}`decisions/algorithm/options/gp`, motivated by
{astra:cite:t}`prior_insights/recon_sharpens_bao`.

:::{astra} decisions/algorithm
:::

## Results

The headline result is the {astra:numref}`outputs/hubble_diagram`:

:::{astra} outputs/hubble_diagram
:label: fig-hubble
:::

From the BAO table we recover
{astra:value}`outputs/bao_table col=DV_over_rd tracer=lrg3 ±` for the LRG3
tracer, supporting {astra}`findings/signal_detected`:

:::{astra} findings/signal_detected
:::

A parallel treatment appears in the {astra}`reconstruction` sub-analysis; compare
its {astra}`reconstruction/outputs/xi` with the result above.

## Data products

:::{astra} outputs
:::
```

---

## 10. Cheat sheet

```text
PATHS  (mirror your astra.yaml; '/', '..', leading '/' as in file paths)
  outputs/hubble_diagram                      element in this scope
  decisions/algorithm/options/gp              a child (option)
  findings/sig/evidence/fig1                  a child (evidence)
  reconstruction/outputs/xi                   sub-analysis (analyses/ implied)
  /decisions/method        ../outputs/xi      absolute / parent
  outputs                  reconstruction/inputs   a whole collection (registry)

INLINE  (roles)
  {astra}`PATH`                               smart linked reference
  {astra}`text <PATH>`                        custom display text
  {astra:numref}`PATH`                           "Figure 3" (supports %s, {label})
  {astra:value}`PATH col=C key=v ± sig=3`     live value from results
  {astra:cite}`PATH`   {astra:cite:t}`PATH`   citation (paren / textual)
  [](#astra:PATH)   @astra:PATH               native link / shorthand forms

BLOCK  (directive)
  :::{astra} PATH
  :label:  :caption:  :as:  :show:/:hide:  :compact:  :universe:  :class:
  :::
  ![](#astra:PATH)                            native figure/table embed
  :::{figure} #astra:PATH … :::               wrap an output in a figure
```

---

## Appendix — relationship to the current system

This is a clean-slate design, but for reviewers, here is what changes and why.

- **One grammar instead of two.** Today there are custom kind-named roles
  (`{astra:output}`x``) *and* a separate dotted anchor grammar
  (`[](#outputs.x)`). These are merged into a single slash path that both the
  role and the native MyST link consume.
- **One role + one directive instead of ~5 + ~7.** The kind is read from the
  path's collection segment, so `{astra}` and `:::{astra}` cover every element.
  Specialised behaviour is limited to the small MyST-style colon family
  (`:num`, `:value`, `:cite`, `:cite:t`).
- **The path mirrors `astra.yaml`** (plural collection keys, `/` nesting) rather
  than a bespoke dotted scheme, and adds file-path semantics (`..`, leading `/`)
  for moving between scopes — so referencing across sub-analyses needs no new
  rules.
- **Children and collections are first-class.** Options, evidence, table cells,
  and whole registries are addressable with the same grammar, so there is no
  element the system cannot point at.
- **Native MyST throughout.** Every element registers as a cross-reference target
  under the `astra:` scheme, so `[](#…)`, `@…`, hover previews, `![](#…)`
  embeds, `{figure}`/`{table}` wrappers, and DOI bibliography generation all work
  with no ASTRA-specific knowledge.
