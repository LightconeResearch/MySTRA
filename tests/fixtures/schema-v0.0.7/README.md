# Vendored ASTRA schema — v0.0.7

These YAML files are a frozen copy of `astra-spec/src/astra/schema/`
at version 0.0.7 (commit `ed13f48`). They're the input fixture for
`tests/schema-coverage.test.ts`, which asserts that
`src/types/astra.ts` covers every slot in every class.

## Discipline

Every astra-spec release:

1. Update the vendored copies here from
   `astra-spec/src/astra/schema/*.yaml`.
2. Run `npm test`. The coverage test surfaces every slot the TS
   types haven't absorbed.
3. Fix the type file, then update `src/types/astra.ts`'s docstring
   to declare the new tracked version + commit.

The coverage test is the mechanical guard that replaces "hand-audit
every release." When the test goes green again, MySTRA is back to
parity. The broader rationale for the guard lives in `SPEC.md` and
in the coverage work merged through
[MySTRA PR #1](https://github.com/LightconeResearch/MySTRA/pull/1).
