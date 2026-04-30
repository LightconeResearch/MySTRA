# MySTRA owns the entire ASTRA → mdast translation

**Status:** active (constitution; phases A–E open)
**Date:** 2026-05-01
**Scope:** ride alongside the v0.0.6 catchup PR ([#1](https://github.com/LightconeResearch/MySTRA/pull/1)) — formalizes the "no spec leaks" principle and audits coverage against astra-spec v0.0.7.

## The principle

MySTRA's job is to consume the entire ASTRA surface — every element type, every slot — and emit a complete mdast representation. Renderers (lightcone-ui, vellum, anything downstream) receive *only* the emitted mdast and never read `astra.yaml` directly. Any consumer reading the spec is a leak: it means MySTRA isn't emitting something a renderer needs, and the workaround puts spec-shape knowledge in two places.

This is the same logic as why mystra is the public API surface: MySTRA's mdast is the canonical boundary between spec and rendering. If the boundary leaks, the boundary isn't real.

## Why this constitution

The leak surfaced today (2026-05-01) when reviewing astra-spec v0.0.7's impact:

- **astra-spec v0.0.7 PR [#19](https://github.com/LightconeResearch/astra-spec/pull/19)** moved per-output provenance from `Recipe.inputs` / `Recipe.decisions` onto the Output itself: `Output.inputs` and `Output.decisions`. The Recipe simplifies to *how*; the Output carries the *what-from* contract.
- **lightcone-ui main commit [`ed0e69c`](https://github.com/LightconeResearch/lightcone-ui/commit/ed0e69c)** ("Read provenance from Output.inputs / Output.decisions") tracks PR #19 — but it does so *by reading the spec directly from the bundle*, not by pattern-matching on mystra-emitted nodes.
- **MySTRA's `cail/spec-catchup` branch** (this PR) hasn't moved to absorb PR #19. The `ASTRAOutput` interface in `src/types/astra.ts` lists `id, label, type, description, from, when, recipe` but is **missing `inputs` and `decisions`**. There is no `render-output-provenance.ts` module.

So: the schema added two slots; the consumer started reading them straight off the bundle; mystra wasn't in the loop. That's the shape of the leak this constitution prevents.

The principle isn't new — it's been implicit in the parent direction (mystra IS public API). What's new is the discipline: every astra-spec release triggers a MySTRA coverage audit, and any consumer touching `astra.yaml` directly is a documented exception with a follow-up to land emission in MySTRA.

## Desired state — full coverage matrix

For every element type in astra-spec, MySTRA has a named transform module that emits it, with a documented output node shape (`kind`, `identifier`, `data`) so renderers can pattern-match without re-reading the spec.

| ASTRA element | Source schema | MySTRA module | Output node shape | Status |
|---|---|---|---|---|
| Analysis (top-level) | `analysis.yaml: Analysis` | `index.ts` (orchestrator) | root mdast tree | ✅ |
| Narrative (5-key) | `analysis.yaml: Narrative` | `render-narrative.ts` + `narrative-parser.ts` | named addressable chunks `#narrative-<section>` | ✅ |
| Decision + Options | `analysis.yaml: Decision, Option` | `render-methods.ts` | h4 + details/summary; `decision-<id>` anchor | ✅ |
| Finding + evidence | `analysis.yaml` (findings via narrative) + `insight.yaml` evidence | `render-findings.ts` + `render-evidence.ts` | h3 `finding-<id>` blocks | ✅ |
| Prior insight + evidence | `insight.yaml: Insight` | `render-prior-insights.ts` + `render-evidence.ts` | container `prior-insight` with structured data | ✅ |
| Input | `analysis.yaml: Input` | `render-data-sources.ts` | table row in inputs registry | ⚠️ Partial — registry only |
| Output | `analysis.yaml: Output` | `render-data-sources.ts` | table row in outputs registry | ⚠️ Partial — registry only |
| **Output.inputs** (provenance, v0.0.7 #19) | `analysis.yaml: Output.inputs` | **(none)** | — | ❌ **Missing** |
| **Output.decisions** (provenance, v0.0.7 #19) | `analysis.yaml: Output.decisions` | **(none)** | — | ❌ **Missing** |
| **Recipe** | `analysis.yaml: Recipe` | **(none)** | — | ❌ **Decision pending** (PR #1 already lists this as deferred) |
| Sub-analyses | `analysis.yaml: Analysis.analyses` | `render-sub-analyses.ts` | sub-analysis cards | ✅ |
| Universe (selected options) | `universe.yaml: Universe` | `render-universe-banner.ts` | collapsible banner | ✅ (needs `data.astraKind` marker — separate issue) |
| Evidence (selectors) | `insight.yaml: TextQuoteSelector, FragmentSelector, ArtifactEvidence` | `render-evidence.ts` | per-type rendering | ✅ |
| Resources / KeyValuePair | `analysis.yaml: Resources, KeyValuePair` | (none) | — | ⚠️ Likely passthrough; needs audit |

Three rows are red. They're the actionable scope.

## Current state — coverage audit (2026-05-01)

### Type-file completeness vs astra-spec v0.0.7

`src/types/astra.ts` self-declares: *"Tracks astra-spec v0.0.6 (commit 1d948cf)"*. `1d948cf` is PR #18 (`from_ref` → `from` rename). The types file therefore covers PR #18 but **not** PR #19's Output-as-provenance-unit changes.

Missing from `ASTRAOutput`:

```ts
export interface ASTRAOutput {
  id: string;
  label?: string;
  type: 'metric' | 'figure' | 'table' | 'data' | 'report';
  description?: string;
  from?: string;
  when?: string[];
  recipe?: ASTRARecipe;
  // MISSING:
  // inputs?: string[];     // upstream artifact IDs (resolved to Input or sibling Output)
  // decisions?: string[];  // decision IDs that parameterize this output
}
```

The astra-spec v0.0.7 `Output` definition canonically has both `inputs: multivalued` and `decisions: multivalued` slots, with documented semantics about cache keys, universe selection, and runtime delivery to recipes:

> `inputs: IDs of upstream artifacts this output depends on. Each reference resolves to either an Input declared on the surrounding analysis (an external dataset/file/analysis) or a sibling Output (another artifact in scope).`
>
> `decisions: Decision IDs (in the surrounding scope) that parameterize this output. Declares the output's provenance contract: re-running with a different option for any listed decision must be expected to produce a different output.`

`ASTRAInput` likely needs a parallel audit — v0.0.7 may have added or changed slots there too. `ASTRARecipe` itself was *modernized* in PR #19 (Recipe vocabulary modernization); current MySTRA Recipe interface needs a side-by-side check against the new schema.

### Transform-module gaps

`grep -rE "(recipe|Recipe|\.recipe)" src/transform/` returns zero hits. The transform code does not emit Recipe in any form. There is no `render-output-provenance.ts`. There is no place in `render-data-sources.ts` (which renders the Inputs/Outputs registry tables) that emits per-Output `inputs:` or `decisions:` listings.

### Consumer leak — lightcone-ui

`lightcone-ui` commit `ed0e69c` reads provenance directly from the bundle:

> The renderer was still reading the old shape and parsing `from:` with `indexOf('.')`, so new-format YAMLs silently rendered as if recipes had no inputs or decisions.

The fix went into the renderer's bundle-loader, not into mystra. That's the leak.

### No element-id → mdast-location index

`src/transform/index.ts` exposes a `results: Map<string, string>` for slug-keyed result paths, but there is no exposed map from element-id (`output-<id>`, `decision-<id>`, `prior_insight-<id>`, etc.) to its location in the emitted mdast tree. Consumers that need to locate a specific element have to walk the tree.

This isn't a v0.0.7 leak per se, but it's adjacent: when MySTRA is the public API, consumers asking *"where does decision-X render"* should get an answer from MySTRA, not by tree-walking.

## Phase plan

Each phase ships as its own commit (or PR if the scope warrants). The constitution stays open until **Phase E** lands.

### Phase A — type-file completeness pass

Bring `src/types/astra.ts` to v0.0.7 parity:

- [ ] `ASTRAOutput`: add `inputs?: string[]`, `decisions?: string[]`
- [ ] `ASTRAOutput`: cross-check the rest of v0.0.7's slot list (the audit might surface other drift)
- [ ] `ASTRAInput`: parallel cross-check vs v0.0.7's Input definition
- [ ] `ASTRARecipe`: side-by-side check against the modernized Recipe vocabulary in PR #19
- [ ] Update the file's docstring to declare v0.0.7 + the latest tracked commit
- [ ] Audit the rest of the interfaces (`ASTRAEvidence`, `ASTRAInsight`, `ASTRADecision`, `ASTRAOption`, `ASTRAAnalysis`, `ASTRAUniverse`) against the v0.0.7 schema yaml — anything else drifted?

This phase is read-only diff between two YAMLs and one TS file. Mechanical, fast, low-risk. Single commit.

### Phase B — emit Output provenance as structured mdast

The work the `ed0e69c` commit pulled into lightcone-ui directly, ported back into MySTRA:

- [ ] New module `render-output-provenance.ts` (or fold into `render-data-sources.ts` as a per-Output secondary block)
- [ ] For each Output with non-empty `inputs:` and/or `decisions:`, emit a structured node:
  ```
  container, kind: 'output-provenance', identifier: 'output-<id>-provenance',
  data: { outputId, inputs: [...resolved IDs], decisions: [...resolved IDs] }
  ```
- [ ] Resolve `from:` chains so consumers don't need to: an aliased input refers back to the source via the chain, surface the resolved source ID in the data slot
- [ ] Decide where it sits in the document order — adjacent to the Output's table row? At the Output's anchor location (so it's hover-discoverable)?

Once this lands, lightcone-ui's bundle-loader provenance reading collapses into a pattern-match on the mdast node.

### Phase C — Recipe: deliberate decision

Recipe is currently invisible in mystra output. PR #1's "Follow-up" already calls this out:

> *Recipe / Output.recipe is wired through types but not yet rendered — viewing how a job ran (command, container, script) is desired future surface.*

Two coherent positions:

- **Hide.** Recipe is execution detail; readers don't want to see Snakemake commands and container hashes. The reader sees Output.description (the "what") and the inputs/decisions provenance (the "from"); the recipe (the "how") is for runners, not readers.
- **Render as collapsible technical detail.** Per-Output `details/summary` block titled "Recipe" with the command + container as code, optional. Discoverable by the technically curious without bloating the prose.

Either is defensible; the current state of "hidden by accident" is not. This phase resolves the question and implements whichever direction wins. Discussion with @EiffL probably useful — Recipe vocabulary is his.

### Phase D — port consumer reads back through MySTRA

Once Phase B lands:

- [ ] `lightcone-ui` `ed0e69c`'s direct-bundle provenance read becomes a pattern-match on `kind: 'output-provenance'` mdast nodes
- [ ] Audit other lightcone-ui call sites that read `astra.yaml` directly; each becomes either a mystra-emission gap or a documented exception
- [ ] Lock in: a new consumer reading `astra.yaml` directly is a code-review red flag; the request goes to MySTRA first

### Phase E — coverage test in CI

Mechanical guard against future drift:

- [ ] Test that walks `astra-spec/src/astra/schema/*.yaml` and asserts every defined element's slots have at least one TypeScript interface field in `src/types/astra.ts`
- [ ] Optionally: test that asserts each defined element kind has at least one transform module reference (a name match in `src/transform/render-*.ts`)
- [ ] Both tests live in MySTRA. They fail loudly when astra-spec adds a slot MySTRA hasn't absorbed.

This is the discipline replacement for "every astra-spec release triggers a hand audit."

## Schema-version-tracking discipline

Until Phase E lands as a CI check, the discipline is manual:

1. Every astra-spec release (or every merge to astra-spec main, if releases are infrequent) triggers a MySTRA coverage check.
2. The check: read the release notes, walk new/changed slots, verify type-file and transform coverage. The check costs ~20 minutes if there's nothing material; multi-hour if there's drift.
3. Commits that bring MySTRA's type file to a new astra-spec version update the *single* docstring at the top of `src/types/astra.ts` declaring the tracked version and commit. No drift between commit message and reality.

This isn't a substitute for Phase E. It's the bridge until Phase E.

## Open questions

1. **Recipe rendering (Phase C).** Hidden, collapsible-technical, or something in between (e.g., command visible, container hash hidden)? Need François's read.

2. **Inputs and Outputs registry tables vs inline provenance.** Once `Output.inputs` / `Output.decisions` are emitted as per-Output provenance blocks, do the registry tables (`render-data-sources.ts`'s parallel inputs/outputs tables) become redundant, or do they stay as a top-of-document index? Probably stay — they're a registry view, the per-Output block is a provenance view. Different reader needs.

3. **Element-id → mdast-location index.** Should MySTRA expose a flat map (`{ "output-density": "/path/to/node", "decision-fitter": ..., ... }`) so consumers can locate any element in O(1)? Or is tree-walking fine? Probably useful for hover-cards / cross-page navigation; deferrable.

4. **Resources and KeyValuePair coverage.** Untested. Probably trivially passthrough (just metadata), but the audit hasn't covered them — will surface in Phase A's broader interface check.

5. **Evidence registry.** Each Finding and PriorInsight carries evidence; today `render-evidence.ts` emits per-evidence rendering inline. Is there a need for an evidence-id → location index too? Adjacent to question 3.

## Discipline for this constitution

Phase A is mechanical and fast — do first. Phase B is the substantive emission work. Phase C is a decision that can land out of order. Phase D is the cleanup once B lands. Phase E is the guardrail.

The constitution stays open until Phase E lands and we have a CI guard against future drift. **Closing too early is the failure mode** — without the guard, the next astra-spec release re-introduces the leak.

## Related

- [`SPEC.md`](../../SPEC.md) — MySTRA's implementation overview; sections describing identifier convention and xref contract are upstream of the coverage matrix here
- [LightconeResearch/MySTRA#1](https://github.com/LightconeResearch/MySTRA/pull/1) — parent PR; this constitution rides along
- [LightconeResearch/astra-spec PR #19](https://github.com/LightconeResearch/astra-spec/pull/19) — Output as unit of provenance (the change that surfaced the leak)
- [LightconeResearch/astra-spec PR #18](https://github.com/LightconeResearch/astra-spec/pull/18) — `from_ref` → `from` rename (already absorbed)
- [LightconeResearch/astra-spec v0.0.7 release](https://github.com/LightconeResearch/astra-spec/releases/tag/v0.0.7)
- [LightconeResearch/lightcone-ui commit ed0e69c](https://github.com/LightconeResearch/lightcone-ui/commit/ed0e69c) — the direct-bundle provenance read that Phase D ports back through mystra
