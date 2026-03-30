/**
 * Extended MyST AST node types.
 *
 * myst-spec provides core types (Heading, Paragraph, etc.).
 * These extensions cover directive-derived nodes (tabSet, tabItem, card)
 * that the book-theme renders but aren't in the base spec package.
 */

import type { FlowContent, PhrasingContent } from 'myst-spec';

export type { FlowContent, PhrasingContent };

// Re-export core types we use frequently
export type {
  Root,
  Heading,
  Paragraph,
  Text,
  Strong,
  Emphasis,
  InlineCode,
  Link,
  Blockquote,
  ThematicBreak,
  Image,
  Table,
  TableRow,
  TableCell,
  Code,
  Admonition,
  AdmonitionTitle,
  Container,
  Caption,
  CrossReference,
} from 'myst-spec';

// ── Extension nodes rendered by the book-theme ──

export interface TabSetNode {
  type: 'tabSet';
  children: TabItemNode[];
}

export interface TabItemNode {
  type: 'tabItem';
  title: string;
  selected?: boolean;
  children: any[];
}

export interface CardNode {
  type: 'card';
  url?: string;
  title?: string;
  children: any[];
}

// ── Citation nodes ──

export interface CiteNode {
  type: 'cite';
  label: string;
  identifier?: string;
  kind?: 'narrative' | 'parenthetical';
  children: any[];
}

export interface CiteGroupNode {
  type: 'citeGroup';
  kind: 'narrative' | 'parenthetical';
  children: CiteNode[];
}

// ── Collapsible / structural nodes ──

export interface DetailsNode {
  type: 'details';
  open?: boolean;
  children: any[];
}

export interface SummaryNode {
  type: 'summary';
  children: any[];
}

export interface BlockBreakNode {
  type: 'blockBreak';
  meta?: string;
}

// ── General AST node union for our purposes ──

export type AnyASTNode =
  | FlowContent
  | PhrasingContent
  | TabSetNode
  | TabItemNode
  | CardNode
  | CiteNode
  | CiteGroupNode
  | DetailsNode
  | SummaryNode
  | BlockBreakNode
  | { type: string; [key: string]: any };
