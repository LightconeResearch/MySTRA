/**
 * Schema-coverage guard.
 *
 * Walks the vendored astra-spec schemas (`tests/fixtures/schema-v0.0.7/`)
 * and asserts that `src/types/astra.ts` declares an interface field for
 * every slot of every class. This is the mechanical replacement for
 * hand-auditing every astra-spec release: when astra-spec adds a slot
 * MySTRA hasn't absorbed, this test fails loudly.
 *
 * The mapping from LinkML class → TS interface lives in
 * `CLASS_TO_INTERFACE`. When astra-spec adds a new top-level class,
 * extend that map (and add the interface in `astra.ts`). Slots
 * intentionally encoded elsewhere (e.g., the `id` slot on `Option`,
 * `Decision`, `UniverseNode`, `DecisionSelection` becomes the
 * `Record<string, …>` key in the parent surface) are listed in
 * `KEY_AS_PARENT_RECORD_KEY` and excluded from the coverage check.
 *
 * See `tests/fixtures/schema-v0.0.7/README.md` for the bump
 * discipline.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, 'fixtures', 'schema-v0.0.7');
const TYPES_FILE = join(__dirname, '..', 'src', 'types', 'astra.ts');

// LinkML class → TypeScript interface name.
//
// `null` means the class is intentionally encoded into a parent
// surface (typically as a Record key) and has no standalone TS
// interface — see KEY_AS_PARENT_RECORD_KEY for the absorbed slots.
const CLASS_TO_INTERFACE: Record<string, string | null> = {
  // analysis.yaml
  KeyValuePair: null, // not currently used by transforms; passthrough metadata
  Narrative: 'ASTRANarrative',
  Resources: 'ASTRAResources',
  Recipe: 'ASTRARecipe',
  Input: 'ASTRAInput',
  Output: 'ASTRAOutput',
  Option: 'ASTRAOption',
  Decision: 'ASTRADecision',
  Analysis: 'ASTRAAnalysis',
  // insight.yaml
  TextQuoteSelector: 'TextQuoteSelector',
  FragmentSelector: 'FragmentSelector',
  Evidence: 'ASTRAEvidence',
  Insight: 'ASTRAInsight',
  InsightCollection: null, // wrapper; consumers use Record<string, ASTRAInsight> directly
  // universe.yaml
  DecisionSelection: null, // collapses to Record<string, string> on parent
  UniverseNode: 'ASTRAUniverseNode',
  Universe: 'ASTRAUniverse',
};

// Slots whose value lives as the *key* of a Record<…> on the parent
// interface (LinkML `identifier: true` slots inlined into a parent
// map). The coverage check skips these — they're present in the TS
// surface, just not as a named field.
const KEY_AS_PARENT_RECORD_KEY = new Set<string>([
  'Option.id',
  'Decision.id', // when keyed by id in Analysis.decisions
  'UniverseNode.id',
  'DecisionSelection.decision_id',
]);

interface LinkMLSchema {
  classes?: Record<string, LinkMLClass>;
  slots?: Record<string, LinkMLSlot>;
}

interface LinkMLClass {
  attributes?: Record<string, LinkMLSlot>;
  slots?: string[];
}

interface LinkMLSlot {
  // Currently unused by the coverage check; declared for clarity.
  description?: string;
}

function loadSchema(filename: string): LinkMLSchema {
  const text = readFileSync(join(SCHEMA_DIR, filename), 'utf-8');
  return yaml.load(text) as LinkMLSchema;
}

function loadAllSchemas(): { sharedSlots: Set<string>; classes: Record<string, LinkMLClass> } {
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.yaml'));
  const classes: Record<string, LinkMLClass> = {};
  const sharedSlots = new Set<string>();
  for (const f of files) {
    const schema = loadSchema(f);
    for (const slotName of Object.keys(schema.slots ?? {})) sharedSlots.add(slotName);
    for (const [name, def] of Object.entries(schema.classes ?? {})) {
      classes[name] = def;
    }
  }
  return { sharedSlots, classes };
}

/**
 * Extract the body of a TypeScript interface as plain text. Used to
 * grep for slot names without parsing TS — keeps the test
 * dependency-free. This is intentionally low-fidelity: it counts a
 * slot as "covered" if its name appears anywhere in the interface
 * body, which catches comments, JSDoc, and renamed fields. False
 * positives are preferable to false negatives here — the test is a
 * smoke alarm, not a static analyzer.
 */
function extractInterfaceBody(source: string, name: string): string | null {
  // Match: `export interface NAME {…}` (single-line or multi-line).
  // Word-boundary anchor stops `ASTRAUniverse` from matching
  // `ASTRAUniverseNode` (or any other `${name}…` prefix collision).
  // The brace counter handles nested braces in JSDoc / generics.
  const re = new RegExp(`export interface ${name}\\b`);
  const match = re.exec(source);
  if (!match) return null;
  const start = match.index;
  const open = source.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function classSlots(klass: LinkMLClass, sharedSlots: Set<string>): string[] {
  const all = new Set<string>();
  for (const name of Object.keys(klass.attributes ?? {})) all.add(name);
  for (const name of klass.slots ?? []) {
    if (sharedSlots.has(name)) all.add(name);
  }
  return [...all];
}

describe('astra-spec coverage in src/types/astra.ts', () => {
  const { sharedSlots, classes } = loadAllSchemas();
  const typesSource = readFileSync(TYPES_FILE, 'utf-8');

  // Sanity: every class in CLASS_TO_INTERFACE actually exists in the
  // vendored schema (catch typos in the mapping).
  it('CLASS_TO_INTERFACE covers every class declared in the schema', () => {
    const declaredClasses = Object.keys(classes).sort();
    const mappedClasses = Object.keys(CLASS_TO_INTERFACE).sort();
    expect(mappedClasses).toEqual(declaredClasses);
  });

  // For each class with a TS interface, every slot must be referenced.
  for (const [className, interfaceName] of Object.entries(CLASS_TO_INTERFACE)) {
    if (!interfaceName) continue;

    it(`${className} → ${interfaceName}: every slot is referenced`, () => {
      const klass = classes[className];
      const slots = classSlots(klass, sharedSlots);
      const body = extractInterfaceBody(typesSource, interfaceName);
      expect(body, `interface ${interfaceName} not found in src/types/astra.ts`).toBeTruthy();

      const missing: string[] = [];
      for (const slot of slots) {
        if (KEY_AS_PARENT_RECORD_KEY.has(`${className}.${slot}`)) continue;
        // Identifier slots that aren't in KEY_AS_PARENT_RECORD_KEY
        // are still expected as a TS field (e.g. Input.id, Output.id,
        // Analysis.id, Universe.id, Evidence.id, Insight.id).
        if (!body!.includes(slot)) missing.push(slot);
      }
      expect(missing).toEqual([]);
    });
  }

  // Whole-class coverage: a new top-level class shouldn't slip past
  // by being missing from the mapping. This is the one place where a
  // missing entry surfaces as a clear error.
  it('every class in the schema has either an interface or an explicit `null`', () => {
    for (const className of Object.keys(classes)) {
      expect(
        Object.prototype.hasOwnProperty.call(CLASS_TO_INTERFACE, className),
        `class ${className} not in CLASS_TO_INTERFACE — add an interface or mark null`,
      ).toBe(true);
    }
  });
});

describe('schema version banner in src/types/astra.ts', () => {
  it('declares the tracked version + commit (so the discipline is auditable)', () => {
    const text = readFileSync(TYPES_FILE, 'utf-8');
    // Loose match — just enforce that *some* "Tracks astra-spec
    // vX.Y.Z (commit …)" line exists. Bumping the version is part
    // of the bump discipline; we don't lock this test to a specific
    // version because then the test has to change every release.
    expect(text).toMatch(/Tracks\s+astra-spec\s+v\d+\.\d+\.\d+\s*\(commit\s+`?[a-f0-9]+`?\)/);
  });
});
