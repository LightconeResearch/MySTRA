---
name: MySTRA owns the entire ASTRA → mdast translation
status: closed
tags:
    - constitution
    - mystra
    - astra
    - schema
    - coverage
    - architecture
created-at: 2026-05-01T01:07:02.437378+02:00
outcome: |-
    REALIZED AND PUBLISHED. MySTRA `cail/spec-catchup` now owns
    astra-spec v0.0.7 coverage end-to-end: type surface, both
    emission carriers (output provenance + output recipe), and the
    schema coverage guard are in place and pushed to
    `origin/cail/spec-catchup`.

    **Phase A — type-file v0.0.7 parity** (commit `2a6aea6`):
    `ASTRAOutput` gains `inputs?` / `decisions?`; `ASTRARecipe`
    drops the dead `inputs?` slot; `ASTRAResources` gains `disk?`;
    `ASTRAInput` / `ASTRAOutput` `type` becomes optional (aliased
    nodes inherit). Header docstring tracks v0.0.7 (`ed13f48`).

    **Phase B — Output provenance emission** (commit `8984766`):
    new `render-output-provenance.ts` emits one
    `container.kind=output-provenance` per Output with non-empty
    inputs/decisions. `data: { astraKind, outputId, inputs,
    decisions, from, unresolved }` is the consumer contract.
    Aliased outputs resolve via `resolve-output.ts`. 9 test cases.

    **Phase C — Output recipe emission** (commit `f76da78`):
    new `render-output-recipe.ts` emits one
    `container.kind=output-recipe` per Output with a non-empty
    resolved recipe. `data: { astraKind, outputId, command,
    container, resources, from, unresolved }` is the consumer
    contract. Display is downstream (renderers suppress for
    "hide" or pattern-match `data` for "render"). 8 test cases.

    **Phase E — CI coverage guard** (commit `2938612`):
    `tests/schema-coverage.test.ts` walks vendored
    `tests/fixtures/schema-v0.0.7/*.yaml` and asserts every slot
    is referenced in `src/types/astra.ts`.

    Consumer cleanup (porting lightcone-ui's vanilla `bundle.ts`
    direct-read of `Output.inputs/decisions` into pattern-matches
    on mystra's emitted `output-provenance` / `output-recipe`
    containers) is tracked downstream in
    `lightcone-ui/.felt/mainline-parity` — not MySTRA's scope.
    Phase D is removed from this constitution: once mystra emits,
    consumers absorb on their own schedule.

    Verification: `npm test -- --run` → 110 passing. `npm run
    build` → clean.
---

Constitution rides alongside the v0.0.6 catchup [PR #1](https://github.com/LightconeResearch/MySTRA/pull/1) — formalizes the "no spec leaks" principle and audits coverage against astra-spec v0.0.7.

## The principle

MySTRA's job is to consume the entire ASTRA surface — every element type, every slot — and emit a complete mdast representation. Renderers (lightcone-ui, vellum, anything downstream) receive *only* the emitted mdast and never read `astra.yaml` directly. Any consumer reading the spec is a leak: it means MySTRA isn't emitting something a renderer needs, and the workaround puts spec-shape knowledge in two places.

This is the same logic as why mystra is the public API surface: MySTRA's mdast is the canonical boundary between spec and rendering. If the boundary leaks, the boundary isn't real.

### Emission style — pure containers, never display primitives

A corollary that the work surfaced: MySTRA emits **structured ASTRA-element containers** (`type: 'container', kind: '<element-kind>', identifier: '<element-id>', data: {...}`) plus the author's prose parsed as standard mdast. Layout primitives — `table`, `heading` (as section markers, not narrative content), `details/summary` — are the renderer's call. Renderers pattern-match on `kind` and decide display.

The role models in the existing transform are `render-prior-insights.ts` and `render-narrative.ts` (typed/container emission). The new `render-output-provenance.ts` from Phase B follows the same pattern. Some older modules (`render-data-sources` emitting `table`, `render-methods` emitting `heading + details/summary`, `render-findings` emitting `heading`) predate the principle — retrofitting them is future work; the constitution names the discipline so new modules don't drift.

## Why this constitution

The leak surfaced today (2026-05-01) when reviewing astra-spec v0.0.7's impact:

- **astra-spec v0.0.7 PR [#19](https://github.com/LightconeResearch/astra-spec/pull/19)** moved per-output provenance from `Recipe.inputs` / `Recipe.decisions` onto the Output itself: `Output.inputs` and `Output.decisions`. The Recipe simplifies to *how*; the Output carries the *what-from* contract.
- **lightcone-ui main commit [`ed0e69c`](https://github.com/LightconeResearch/lightcone-ui/commit/ed0e69c)** ("Read provenance from Output.inputs / Output.decisions") tracks PR #19 — but it does so *by reading the spec directly from the bundle*, not by pattern-matching on mystra-emitted nodes.
- **MySTRA's `cail/spec-catchup` branch** (this PR) hadn't moved to absorb PR #19. The `ASTRAOutput` interface was missing `inputs` and `decisions`. There was no `render-output-provenance.ts` module.

So: the schema added two slots; the consumer started reading them straight off the bundle; mystra wasn't in the loop. That's the leak Phase B closed and Phase E guards against recurring.

The principle wasn't new — it's been implicit in the parent direction (mystra IS public API). What's new is the discipline: every astra-spec release triggers a coverage audit (now CI-enforced via Phase E); every consumer reading `astra.yaml` directly is a documented exception with a follow-up to land emission in MySTRA.

## Coverage matrix (current state, 2026-05-01 post-A/B/E)

| ASTRA element | Source schema | MySTRA module | Status |
|---|---|---|---|
| Analysis (top-level) | `analysis.yaml: Analysis` | `index.ts` orchestrator | ✅ |
| Narrative (5-key) | `analysis.yaml: Narrative` | `render-narrative.ts` + `narrative-parser.ts` | ✅ Pure-container role model |
| Prior insight + evidence | `insight.yaml: Insight` | `render-prior-insights.ts` + `render-evidence.ts` | ✅ Pure-container role model |
| Decision + Options | `analysis.yaml: Decision, Option` | `render-methods.ts` | ✅ Coverage; ⚠️ emits `heading` + `details/summary` (retrofit candidate) |
| Finding + evidence | `analysis.yaml` (findings) + `insight.yaml` | `render-findings.ts` + `render-evidence.ts` | ✅ Coverage; ⚠️ emits `heading` (retrofit candidate) |
| Input | `analysis.yaml: Input` | `render-data-sources.ts` | ✅ Registry; ⚠️ emits `table` (retrofit candidate) |
| Output | `analysis.yaml: Output` | `render-data-sources.ts` | ✅ Registry; ⚠️ emits `table` (retrofit candidate) |
| **Output.inputs / Output.decisions** (provenance) | `analysis.yaml: Output.inputs/decisions` (v0.0.7 #19) | **`render-output-provenance.ts`** (new in Phase B) | ✅ Pure container `kind: 'output-provenance'` |
| Output.recipe | `analysis.yaml: Recipe` | `render-output-recipe.ts` | ✅ Phase C landed |
| Sub-analyses | `analysis.yaml: Analysis.analyses` | `render-sub-analyses.ts` | ✅ |
| Universe (selected options) | `universe.yaml: Universe` | `render-universe-banner.ts` | ✅ |
| Evidence (selectors) | `insight.yaml: TextQuoteSelector, FragmentSelector, ArtifactEvidence` | `render-evidence.ts` | ✅ |
| Resources / KeyValuePair | `analysis.yaml: Resources, KeyValuePair` | (passthrough via Phase A type addition) | ✅ types; emission as needed |

Phase E's CI guard now enforces that every spec slot has at least one TS interface field. New ASTRA classes/slots without TS landing surface fail tests loudly.

## Phase plan

### Phase A — type-file v0.0.7 parity ✅ landed `2a6aea6`

- `ASTRAOutput` gains `inputs?` / `decisions?`
- `ASTRARecipe` drops the dead `inputs?` slot (modernized vocabulary per PR #19)
- `ASTRAResources` gains `disk?`
- `ASTRAInput` / `ASTRAOutput` `type` becomes optional (aliased nodes inherit type from source)
- Selector types stripped of unused JSON-LD discriminators
- Header docstring tracks v0.0.7 (commit `ed13f48`)

### Phase B — emit Output provenance as structured mdast ✅ landed `8984766`

- New `render-output-provenance.ts` emits one container per Output with non-empty inputs/decisions:
  ```
  type: 'container', kind: 'output-provenance', identifier: 'output-<id>-provenance',
  data: { astraKind, outputId, inputs, decisions, from, unresolved }
  ```
- Inline `crossReference` chips render as a fallback / inline view alongside the structured `data`
- New `resolve-output.ts` walks `Output.from` chains through nested `analyses` so aliased outputs inherit type/description/inputs/decisions/recipe
- Multi-segment descent (`outer.inner.leaf`) and chained re-exports both handled
- Smoke-tested on `astra-spec/examples/iris_pipeline` — all six outputs emit correct provenance carriers across top + two sub-pages
- 9 new test cases

The consumer contract is the `data` slot. Pattern-matching on `kind: 'output-provenance'` is the consumer's job (e.g., the React port handles this in `packages/renderer/src/layout/Section.tsx`); how each consumer absorbs the emission is downstream of mystra.

### Phase C — emit Output.recipe as structured mdast ✅ landed `f76da78`

`render-output-recipe.ts` emits one `container.kind=output-recipe` per Output with a non-empty resolved recipe. The consumer contract:

```
type: 'container', kind: 'output-recipe', identifier: 'output-<id>-recipe',
data: {
  astraKind: 'output-recipe',
  outputId: '<id>',
  command, container, resources, from, unresolved
}
```

Fallback children are a single `details` block (open=false) holding a `summary 'Recipe'`, a fenced bash `code` block for the command, and labeled paragraphs for container and resources — sensible default for renderers that don't pattern-match on `data`. Renderers that do pattern-match on `data` ignore the fallback and render their own shape.

Display is downstream (suppress for "hide", pattern-match for "render"). Recipe vocabulary is frozen at v0.0.7 (`command` template, `resources`, `container`); no ambiguity to defer.

8 new test cases.

### Phase D — *removed (consumer concern, not MySTRA's)*

The earlier draft of this constitution included a "port lightcone-ui's `bundle.ts` direct-reads through mystra-emitted nodes" phase. That's overreach: once mystra emits, what consumers do with the emission is downstream. The consumer cleanup arc (porting lightcone-ui's vanilla bundle path to pattern-match on `output-provenance` containers) lives in `lightcone-ui/.felt/mainline-parity` as Phase 13 of the React port catchup, where it belongs.

What MySTRA owes its consumers: stable emission shape (the `data` slot contract), publication of the new emissions (push the branch, cut a release), and discipline to keep emitting completely (Phase E's CI guard). The consumer-side "stop reading the spec directly" arc is a *consequence* of the principle being held in mystra, not an additional phase mystra ships.

### Phase E — CI coverage guard ✅ landed `2938612`

- `tests/schema-coverage.test.ts` walks vendored `tests/fixtures/schema-v0.0.7/*.yaml` and asserts every slot is referenced in `src/types/astra.ts`
- Bump discipline lives at `tests/fixtures/schema-v0.0.7/README.md` — when astra-spec releases a new version, vendor the new schema fixtures, run the test, fix any gaps
- New classes/slots without a TS landing surface fail loudly in CI

This is the discipline replacement for "every astra-spec release triggers a hand audit."

## Future work (outside the numbered phases)

**Emission-style retrofit of existing modules.** `render-data-sources` (tables), `render-methods` (heading + details/summary), `render-findings` (heading) emit display primitives instead of pure containers. New modules follow the principle (Phase B's `render-output-provenance` is the canonical example); retrofitting older ones is a separate, larger arc that should sequence with renderer-side kind-handler updates so visible breakage doesn't ride a single mystra commit.

**Element-id → mdast-location index.** Public `Map<string, NodePath>` keyed by addressable identifier (`output-<id>`, `decision-<id>`, `prior_insight-<id>`, `finding-<id>`, `evidence-<id>`, etc.) so consumers locate elements in O(1) without tree-walking. Built during emit. Not yet shipped; useful when consumers need cross-element lookups (hover-cards, cross-page navigation).

**Emission-style CI lint.** Tree-walk over emitted mdast that flags `table` / `heading` (other than as inline prose mdast inside narrative) / `details` / `summary` nodes appearing outside the role-model `container` shape. Fails CI if a render-* module reverts to layout-primitive emission. Augments Phase E's coverage guard with a purity guard.

## Schema-version-tracking discipline

Phase E now enforces this in CI, but the human discipline remains:

1. Every astra-spec release triggers a coverage check.
2. Vendor the new `*.yaml` schemas into `tests/fixtures/schema-vX.Y.Z/`, update the test fixture path, run `npm test`. Test failures point at the missing slots.
3. Fix the gaps in `src/types/astra.ts` (and emission as needed); update the header docstring's tracked version.

## Resolved questions

| Question | Resolution |
|---|---|
| Recipe emission (Phase C) | Landed `f76da78`. Pure container (`kind: 'output-recipe'`) with `data: { command, container, resources, ... }`; renderer decides display. |
| Inputs/Outputs registry tables vs inline provenance | Both. Registry is the top-of-doc index; inline provenance (Phase B) is the per-Output view. Renderer chooses what to show. |
| Element-id → mdast-location index | Yes, expose. Filed as future work — not blocking the constitution. Built once during emit, O(1) lookup. |
| Resources / KeyValuePair | Phase A's TS audit added them as needed; emission as consumers require. |
| Evidence-id index | Same fate as element-id index — fold into the unified index. Future work. |

## A note to the iteration

You're working in MySTRA on `cail/spec-catchup`. Phases A, B, E are landed; tests pass; build clean. The remaining open phases:

**Phases A, B, C, E are landed.** All four substantive phases shipped on `cail/spec-catchup` over 2026-05-01: types parity (`2a6aea6`), provenance emission (`8984766`), recipe emission (`f76da78`), CI guard (`2938612`). MySTRA's job at the boundary is done.

**Consumer-side cleanup** (the vanilla bundle's direct-read collapsing into pattern-match) is tracked downstream in `lightcone-ui/.felt/mainline-parity` Phase 13, not here. MySTRA's job at the boundary ends with stable emission and publication; how consumers absorb the new kinds is their call.

The principle is the load-bearing thing. Even outside the numbered phases: when a new astra-spec slot arrives without mystra coverage, that's the leak this constitution was written to prevent. The CI guard (Phase E) catches future drift on the emit side; consumer-side discipline (no direct astra.yaml reads) is each consumer's own constitution to hold.

## Related

- [`SPEC.md`](../../SPEC.md) — MySTRA's implementation overview
- [LightconeResearch/MySTRA#1](https://github.com/LightconeResearch/MySTRA/pull/1) — parent PR; this constitution rides along
- [LightconeResearch/astra-spec PR #19](https://github.com/LightconeResearch/astra-spec/pull/19) — Output as unit of provenance (the change that surfaced the leak)
- [LightconeResearch/astra-spec PR #18](https://github.com/LightconeResearch/astra-spec/pull/18) — `from_ref` → `from` rename
- [LightconeResearch/astra-spec v0.0.7 release](https://github.com/LightconeResearch/astra-spec/releases/tag/v0.0.7)
- [LightconeResearch/lightcone-ui commit ed0e69c](https://github.com/LightconeResearch/lightcone-ui/commit/ed0e69c) — the direct-bundle provenance read that surfaced the leak (consumer-side cleanup tracked in `lightcone-ui/.felt/mainline-parity`)
- `lightcone-ui/.felt/mainline-parity` — sibling constitution for the React port; Phase 13 there picks up MySTRA's emitted `output-provenance` containers via kind-handlers
- `tests/fixtures/schema-v0.0.7/README.md` — bump discipline for the CI coverage guard
