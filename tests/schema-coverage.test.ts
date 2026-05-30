/**
 * SDK contract guard.
 *
 * MySTRA consumes ASTRA's canonical TypeScript surface from
 * `@astra-spec/sdk`; it no longer maintains a local schema mirror in
 * `src/types/astra.ts`. This test keeps the dependency explicit by
 * type-checking the symbols MySTRA aliases throughout the renderer and by
 * asserting the validation/runtime helpers expected from the SDK exist.
 */

import {
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';
import {
  astraSchemaUrl,
  collectNodeDecisions,
  getInputIds,
  getOutputIds,
  isConditionMet,
  loadYaml,
  parseYamlString,
  validateAnalysis,
  validateAnalysisData,
  validateAnalysisFile,
  validateNarrativeAnchors,
  validateUniverse,
  validateUniverseData,
  validateUniverseFile,
} from '@astra-spec/sdk';
import type {
  Analysis,
  Decision,
  Evidence,
  FragmentSelector,
  Input,
  Insight,
  Narrative,
  Option,
  Output,
  Recipe,
  Resources,
  TextQuoteSelector,
  Universe,
  UniverseNode,
} from '@astra-spec/sdk';

describe('@astra-spec/sdk type surface', () => {
  it('exports the ASTRA structural types MySTRA renders', () => {
    expectTypeOf<Analysis>().toHaveProperty('inputs').toEqualTypeOf<Input[] | undefined>();
    expectTypeOf<Analysis>().toHaveProperty('outputs').toEqualTypeOf<Output[] | undefined>();
    expectTypeOf<Analysis>()
      .toHaveProperty('decisions')
      .toEqualTypeOf<Record<string, Decision> | undefined>();
    expectTypeOf<Analysis>()
      .toHaveProperty('prior_insights')
      .toEqualTypeOf<Record<string, Insight> | undefined>();
    expectTypeOf<Analysis>()
      .toHaveProperty('findings')
      .toEqualTypeOf<Record<string, Insight> | undefined>();
    expectTypeOf<Analysis>()
      .toHaveProperty('narrative')
      .toEqualTypeOf<Narrative | undefined>();

    expectTypeOf<Input>().toHaveProperty('from').toEqualTypeOf<string | undefined>();
    expectTypeOf<Output>().toHaveProperty('recipe').toEqualTypeOf<Recipe | undefined>();
    expectTypeOf<Recipe>().toHaveProperty('resources').toEqualTypeOf<Resources | undefined>();
    expectTypeOf<Option>().toHaveProperty('excluded_reason').toEqualTypeOf<string | undefined>();
    expectTypeOf<Evidence>().toHaveProperty('quote').toEqualTypeOf<TextQuoteSelector | undefined>();
    expectTypeOf<Evidence>().toHaveProperty('location').toEqualTypeOf<FragmentSelector | undefined>();

    expectTypeOf<Universe>().toHaveProperty('decisions').toEqualTypeOf<Record<string, string> | undefined>();
    expectTypeOf<Universe>().toHaveProperty('analyses').toEqualTypeOf<Record<string, UniverseNode> | undefined>();
    expectTypeOf<UniverseNode>().toHaveProperty('analyses').toEqualTypeOf<Record<string, UniverseNode> | undefined>();
  });
});

describe('@astra-spec/sdk runtime surface', () => {
  it('exports the parser, validation, and inspection helpers MySTRA depends on', () => {
    expect(astraSchemaUrl('0.0.7')).toBe('https://astra-spec.org/0.0.7/schema/astra.schema.json');
    expect(typeof loadYaml).toBe('function');
    expect(typeof parseYamlString).toBe('function');
    expect(typeof isConditionMet).toBe('function');
    expect(typeof collectNodeDecisions).toBe('function');
    expect(typeof getInputIds).toBe('function');
    expect(typeof getOutputIds).toBe('function');
    expect(typeof validateAnalysisData).toBe('function');
    expect(typeof validateUniverseData).toBe('function');
    expect(typeof validateAnalysisFile).toBe('function');
    expect(typeof validateUniverseFile).toBe('function');
    expect(typeof validateAnalysis).toBe('function');
    expect(typeof validateUniverse).toBe('function');
    expect(typeof validateNarrativeAnchors).toBe('function');
  });
});
