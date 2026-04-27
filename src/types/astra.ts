/**
 * TypeScript interfaces for the ASTRA data model.
 *
 * Mirrors the canonical Pydantic models in extern/ASTRA/models/.
 * Tracks astra-spec v0.0.6 (commit 1d948cf):
 *   - Analysis.description replaced by Analysis.narrative (structured prose,
 *     five Markdown sections: summary, findings, methods, inputs, outputs)
 *   - container + container_build unified into a single string `container`
 *   - Input/Output/Insight gained an optional `label`
 *   - YAML field is `from` (LinkML alias of the python-keyword-shy from_ref)
 *   - IDs may not be one of the reserved category keywords (inputs, outputs,
 *     decisions, findings, prior_insights, analyses, options, content,
 *     narrative); enforcement is upstream in `astra validate`.
 */

// ── W3C Web Annotation Selectors ──

export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface FigureSelector {
  type: 'FigureSelector';
  label: string;
  caption?: string;
}

export interface TableSelector {
  type: 'TableSelector';
  label: string;
  caption?: string;
  region?: string;
}

export interface FragmentSelector {
  type: 'FragmentSelector';
  conformsTo?: string;
  value?: string;
  page?: number;
}

// ── Checksum ──

export interface ASTRAChecksum {
  algorithm: 'sha256' | 'sha512' | 'md5';
  value: string;
}

// ── Evidence ──

export interface ASTRAEvidence {
  id: string;

  // Source: exactly one of doi or artifact
  doi?: string;
  artifact?: string;

  // Literature-specific
  version?: number;

  // Artifact-specific
  checksum?: ASTRAChecksum;
  snapshot?: string;
  source_commit?: string;

  // Content selectors
  quote?: TextQuoteSelector;
  figure?: FigureSelector;
  table?: TableSelector;

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
  checksum?: ASTRAChecksum;

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
  when?: string | string[];
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
  when?: string | string[];
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
  /** Replaces the v0.0.5 free-form `description` field. */
  narrative?: ASTRANarrative;
  inputs?: ASTRAInput[];
  outputs?: ASTRAOutput[];
  decisions: Record<string, ASTRADecision>;
  prior_insights: Record<string, ASTRAInsight>;
  findings: Record<string, ASTRAInsight>;
  /** Image name to pull, or path to a Containerfile to build. */
  container?: string;
  path?: string;
  analyses?: Record<string, ASTRAAnalysis>;
}

// ── Universe ──

export interface ASTRAUniverseNode {
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
