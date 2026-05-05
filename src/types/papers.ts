export interface PaperDecisionLink {
  key: string;
  id: string;
  label: string;
  slug: string;
  href: string;
}

export interface PaperInsightSummary {
  id: string;
  claim: string;
  quote?: string;
  page?: number;
  informs: PaperDecisionLink[];
}
