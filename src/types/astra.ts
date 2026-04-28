/**
 * TypeScript interfaces for the ASTRA data model.
 *
 * Tracks astra-spec v0.0.6 (commit 1d948cf) at
 * https://w3id.org/ASTRA/. The schemas live at
 * `astra-spec/src/astra/schema/*.yaml`; this file is hand-maintained
 * to match them, with consumers (transform, server) typed off these
 * interfaces.
 */

// ── W3C Web Annotation Selectors ──

export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface FragmentSelector {
  type: 'FragmentSelector';
  conformsTo?: string;
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

export interface ASTRAInput {
  id: string;
  /** Short human-readable handle for compact rendering; falls back to id. */
  label?: string;
  type: 'data' | 'analysis';
  description?: string;

  // Data inputs
  source?: string;

  // Analysis inputs
  ref?: string;
  ref_version?: string;
  use_outputs?: string[];

  // Sub-analysis wiring (YAML key: `from`)
  from?: string;
}

// ── Recipe & Resources ──

export interface ASTRAResources {
  cpus?: number;
  memory?: string;
  gpus?: number;
  time_limit?: string;
}

export interface ASTRARecipe {
  command: string;
  inputs?: string[];
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

export interface ASTRAOutput {
  id: string;
  /** Short human-readable handle for compact rendering; falls back to id. */
  label?: string;
  type: 'metric' | 'figure' | 'table' | 'data' | 'report';
  description?: string;
  /** Sub-analysis output that produces this (YAML key: `from`). */
  from?: string;
  when?: string[];
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
