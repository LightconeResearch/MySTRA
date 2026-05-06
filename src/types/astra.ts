/**
 * TypeScript interfaces for the ASTRA data model.
 *
 * Tracks astra-spec v0.0.7 (commit ed13f48) at
 * https://w3id.org/ASTRA/. The schemas live at
 * `astra-spec/src/astra/schema/*.yaml`; this file is hand-maintained
 * to match them, with consumers (transform, server) typed off these
 * interfaces.
 *
 * Field-level fidelity: every slot the schema declares appears here
 * (modulo identifier slots that are encoded as map keys — Option,
 * Decision, UniverseNode, DecisionSelection). When astra-spec adds a
 * slot, MySTRA absorbs it here first so emission code can pattern-
 * match against a well-typed surface.
 */

// ── W3C Web Annotation Selectors ──
//
// The schema declares only the structural attributes; JSON-LD `@type`
// is implicit in the LinkML class_uri (`oa:TextQuoteSelector`,
// `oa:FragmentSelector`) and not a runtime field on parsed YAML.

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface FragmentSelector {
  value?: string;
  page?: number;
}

// ── Evidence ──

export interface ASTRAEvidence {
  id: string;

  // Source: exactly one of doi or artifact
  doi?: string;
  /**
   * Reference to an output by id. The output's `type` (figure /
   * table / metric / data / report) drives how the artifact
   * renders; the output's `label` and `description` carry the
   * caption-equivalent metadata. There is no separate
   * figure/table selector on Evidence — those would conflate the
   * 'what kind' concern that already lives on Output.
   */
  artifact?: string;

  // Literature-specific
  version?: number;

  // Artifact-specific
  snapshot?: string;
  source_commit?: string;

  // Content selectors
  quote?: TextQuoteSelector;

  // Location hint
  location?: FragmentSelector;
}

// ── Insight (shared model for prior_insights and findings) ──

export interface ASTRAInsight {
  id: string;
  /** Short human-readable handle for compact rendering; falls back to id. */
  label?: string;
  claim: string;
  created_at: string;
  evidence: ASTRAEvidence[];
  derived?: boolean;
  scope?: string;
  tags?: string[];
  notes?: string;
}

// ── Input ──
//
// As of v0.0.7, an aliased Input (one with `from:`) is a pure pointer:
// type/description/source/ref/ref_version/use_outputs are forbidden on
// the alias and inherited from the source. The non-aliased case still
// requires `type` (validator-enforced), but TypeScript can't express
// "required iff `from` absent" without a discriminated union, so the
// surface uses optional fields and consumers defend at usage sites.

export interface ASTRAInput {
  id: string;
  /** Short human-readable handle for compact rendering; falls back to id. */
  label?: string;
  type?: 'data' | 'analysis';
  description?: string;

  // Data inputs
  source?: string;

  // Analysis inputs
  ref?: string;
  ref_version?: string;
  use_outputs?: string[];

  /**
   * Path to the source: `../id` (ancestor input), `../../id` (further
   * ancestor), or `../scope.out_id` (sibling sub's output). Reaching
   * downward into own children is not allowed — consume those via
   * Output re-export instead. When set, the local node is a pure
   * pointer; all content fields are inherited from the source.
   */
  from?: string;
}

// ── Recipe & Resources ──
//
// PR #19 (`Make Output the unit of provenance; modernize Recipe
// vocabulary`) restructured Recipe to be pure *how*: provenance
// (`inputs`, `decisions`, `when`) lives on the parent Output. Recipe
// itself shrinks to {command, resources, container}. Resources gained
// `disk` for cluster runners that schedule scratch space.

export interface ASTRAResources {
  /** CPU cores requested. Fractional allowed (CPU shares). */
  cpus?: number;
  /** Memory requirement as a string with units (e.g. '16Gi', '8GB'). */
  memory?: string;
  /** Disk requirement as a string with units (e.g. '10Gi', '500Mi'). */
  disk?: string;
  /** Number of GPUs (>= 1 when set). */
  gpus?: number;
  /** Maximum wall time as a duration string (e.g. '2h', '30m'). */
  time_limit?: string;
}

export interface ASTRARecipe {
  /**
   * POSIX shell command. The command is a template — runners
   * substitute `{inputs.<id>}`, `{inputs}`, `{decisions.<id>}`, and
   * `{output}` placeholders before invoking it. Provenance lives on
   * the parent `Output` (`Output.inputs`, `Output.decisions`); this
   * recipe is pure *how*.
   */
  command?: string;
  /**
   * Container reference. Either an image name (pulled at runtime, e.g.
   * `python:3.9`, `ghcr.io/org/img:latest`) or a path to a Containerfile
   * (built from source, e.g. `Containerfile`, `containers/Dockerfile`).
   * Disambiguation is the runtime's job, not the schema's.
   */
  container?: string;
  resources?: ASTRAResources;
}

// ── Output ──
//
// As of v0.0.7 (PR #19) the Output is the unit of provenance:
// `inputs` and `decisions` declare what materializing this artifact
// depends on, and the recipe is pure *how*. Aliased outputs (those
// with `from:`) inherit type/description/inputs/decisions/recipe
// from the source — only `id`, `from`, and `when` are legal on the
// alias node itself. Resolving the alias is the consumer's job;
// MySTRA emits the resolved view to renderers.

export interface ASTRAOutput {
  id: string;
  /** Short human-readable handle for compact rendering; falls back to id. */
  label?: string;
  type?: 'metric' | 'figure' | 'table' | 'data' | 'report';
  description?: string;
  /**
   * Path to a descendant Output: `child.out_id` (own child sub-
   * analysis's output) or `child.grand.out_id` (deeper). Reaching
   * upward is not allowed. When set, this Output is a re-export
   * pointer; type/description/inputs/decisions/recipe are inherited
   * from the source.
   */
  from?: string;
  when?: string[];
  /**
   * IDs of upstream artifacts this output depends on. Each reference
   * resolves to an Input declared on the surrounding analysis or a
   * sibling Output. `from:` chains in the surrounding scope are
   * walked transparently (an aliased Input is a valid local
   * reference). Drives runner cache keys and recipe input
   * substitution.
   */
  inputs?: string[];
  /**
   * Decision IDs (in the surrounding scope) that parameterize this
   * output. Declares the output's provenance contract: re-running
   * with a different option for any listed decision must be expected
   * to produce a different output. Drives per-output cache keys,
   * minimal-universe pruning, and decision-value delivery to
   * recipes.
   */
  decisions?: string[];
  recipe?: ASTRARecipe;
}

// ── Option ──

export interface ASTRAOption {
  label: string;
  description?: string;
  insights?: string[];
  incompatible_with?: string[];
  requires?: string[];
  excluded?: boolean;
  excluded_reason?: string;
}

// ── Decision ──

export interface ASTRADecision {
  // Reference to parent decision (mutually exclusive with local definition)
  from?: string;

  // Local definition fields
  label?: string;
  rationale?: string;
  tags?: string[];
  when?: string[];
  default?: string;
  options?: Record<string, ASTRAOption>;
}

// ── Narrative (structured prose for an Analysis) ──

/**
 * Free-form Markdown prose describing an Analysis, organized into five
 * optional sections. Each section may contain anchor links of the form
 * `[text](#path.to.element)` (tree-path-first, e.g. `#findings.foo` or
 * `#analyses.preprocessing.outputs.features`); `astra validate` enforces
 * a conditional requirement that a section be present whenever the
 * corresponding structured data exists on the Analysis node.
 */
export interface ASTRANarrative {
  summary?: string;
  findings?: string;
  methods?: string;
  inputs?: string;
  outputs?: string;
}

// ── Analysis (self-similar, recursive) ──

export interface ASTRAAnalysis {
  $schema?: string;
  id?: string;
  version?: string;
  name?: string;
  authors?: string[];
  tags?: string[];
  narrative?: ASTRANarrative;
  inputs?: ASTRAInput[];
  outputs?: ASTRAOutput[];
  // decisions / prior_insights / findings are multivalued inlined in
  // the spec with no `required: true`, so a stub analysis legitimately
  // has none. Optional in TypeScript matches that semantics; render
  // helpers already defend with `?? {}` everywhere they read these.
  decisions?: Record<string, ASTRADecision>;
  prior_insights?: Record<string, ASTRAInsight>;
  findings?: Record<string, ASTRAInsight>;
  /** Image name to pull, or path to a Containerfile to build. */
  container?: string;
  path?: string;
  analyses?: Record<string, ASTRAAnalysis>;
}

// ── Universe ──

export interface ASTRAUniverseNode {
  /**
   * Name of a universe in the sub-analysis's universes/ directory;
   * an alternative to inline `decisions`. Mirrors the spec's
   * `UniverseNode.universe` slot (universe.yaml:46).
   */
  universe?: string;
  decisions: Record<string, string>;
  analyses?: Record<string, ASTRAUniverseNode>;
}

export interface ASTRAUniverse {
  $schema?: string;
  id: string;
  description?: string;
  decisions: Record<string, string>;
  analyses?: Record<string, ASTRAUniverseNode>;
}
