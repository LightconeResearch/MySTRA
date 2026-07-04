# Authoring overview

You reference **any part** of an ASTRA analysis with one idea: a **[path](paths.md)** that mirrors `astra.yaml`. One name — `astra` — drives both surfaces, the MyST way (just as `{math}` is both a role and a directive): wrap a path in the `{astra}` *role* to mention it inline, or use the `{astra}` *directive* to embed it as a block.

Everything else — prose, math, figures you author yourself, the table of contents, multi-page structure — is ordinary MyST. If you have never written MyST Markdown before, skim the [MyST authoring guide](https://mystmd.org/guide/typography) first; MySTRA adds vocabulary, it doesn't change the language.

## Choosing a surface

| I want to… | Use | Example |
|---|---|---|
| Mention an element in a sentence | [`{astra}` role](inline-references.md) | `` {astra}`decisions/algorithm` `` |
| Refer to a figure by number ("Figure 3") | [`{astra:numref}`](inline-references.md#numbered-references-astranumref) | `` {astra:numref}`outputs/hubble_diagram` `` |
| Cite the literature behind an insight | [`{astra:cite}` / `{astra:cite:t}`](inline-references.md#citations-astracite-and-astracitet) | `` {astra:cite}`prior_insights/recon` `` |
| Put a measured number in prose | [`{astra:value}`](live-values.md) | `` {astra:value}`outputs/table col=alpha ±` `` |
| Embed a figure, decision, finding, … as a block | [`{astra}` directive](block-embeds.md) | `:::{astra} outputs/hubble_diagram` |
| Link or embed with plain MyST syntax | [`#astra:` scheme](cross-references.md) | `[](#astra:outputs/hubble_diagram)` |
| Split the report along sub-analyses | [Multi-page reports](multi-page.md) | `reconstruction.md` |

## The golden rule

**Never hard-type a measured number, restate a decision, or re-describe an output.** If it exists in `astra.yaml` or in a result product, reference it. The whole point of MySTRA is that the report cannot drift out of sync with the analysis — every restated fact is a place where it can.

## A complete miniature report

```markdown
# BAO from the ELG sample

## Method

We adopt the {astra}`decisions/algorithm` for density-field reconstruction;
the {astra}`decisions/algorithm/options/multigrid` option follows
{astra:cite:t}`prior_insights/recon_sharpens_bao`.

:::{astra} decisions/algorithm
:::

## Results

The fit yields $\alpha =$ {astra:value}`outputs/alpha_table col=alpha tracer=elg1 ±`
({astra:numref}`see Fig. %s <outputs/bao_fit_plot>`).

:::{astra} outputs/bao_fit_plot
:caption: Correlation function and best-fit model, post-reconstruction.
:::

## Findings

:::{astra} findings
:::
```
