/**
 * TypeScript interfaces for the ASTRA data model.
 * Mirrors the canonical Pydantic models in extern/ASTRA/models/.
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
  type: 'data' | 'analysis';
  description?: string;

  // Data inputs
  source?: string;
  checksum?: ASTRAChecksum;

  // Analysis inputs
  ref?: string;
  ref_version?: string;
  use_outputs?: string[];

  // Sub-analysis wiring
  from?: string;
}

// ── Recipe & Resources ──

export interface ASTRAResources {
  cpus?: number;
  memory?: string;
  gpus?: number;
  time_limit?: string;
}

export interface ASTRAContainerBuildSpec {
  build: string;
  context?: string;
  args?: Record<string, string>;
}

export interface ASTRARecipe {
  command: string;
  inputs?: string[];
  container?: string | ASTRAContainerBuildSpec;
  resources?: ASTRAResources;
}

// ── Output ──

export interface ASTRAOutput {
  id: string;
  type: 'metric' | 'figure' | 'table' | 'data' | 'report';
  description?: string;
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

// ── Success Criterion ──

export interface ASTRASuccessCriterion {
  claim: string;
  output?: string;
  condition?: string;
}

// ── Analysis (self-similar, recursive) ──

export interface ASTRAAnalysis {
  $schema?: string;
  version?: string;
  name?: string;
  authors?: string[];
  tags?: string[];
  description?: string;
  success_criteria?: ASTRASuccessCriterion[];
  inputs?: ASTRAInput[];
  outputs?: ASTRAOutput[];
  decisions: Record<string, ASTRADecision>;
  prior_insights: Record<string, ASTRAInsight>;
  findings: Record<string, ASTRAInsight>;
  container?: string | ASTRAContainerBuildSpec;
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
