/**
 * Pure AST node constructors for MyST-spec compliant nodes.
 * Every function returns a plain object — no side effects, no state.
 */

// ── Inline nodes ──

export function text(value: string) {
  return { type: 'text' as const, value };
}

export function strong(children: any[]) {
  return { type: 'strong' as const, children };
}

export function emphasis(children: any[]) {
  return { type: 'emphasis' as const, children };
}

export function inlineCode(value: string) {
  return { type: 'inlineCode' as const, value };
}

export function link(url: string, children: any[]) {
  return { type: 'link' as const, url, children };
}

// ── Block nodes ──

export function heading(depth: 1 | 2 | 3 | 4 | 5 | 6, children: any[], identifier?: string, label?: string) {
  return {
    type: 'heading' as const,
    depth,
    ...(identifier ? { identifier, label: label ?? identifier } : {}),
    children,
  };
}

export function paragraph(children: any[]) {
  return { type: 'paragraph' as const, children };
}

export function blockquote(children: any[]) {
  return { type: 'blockquote' as const, children };
}

// ── Container nodes ──

export function admonition(kind: string, children: any[], opts?: { open?: boolean; class?: string }) {
  return {
    type: 'admonition' as const,
    kind,
    ...(opts?.open !== undefined ? { open: opts.open } : {}),
    ...(opts?.class ? { class: opts.class } : {}),
    children,
  };
}

export function admonitionTitle(children: any[]) {
  return { type: 'admonitionTitle' as const, children };
}

export function container(kind: string, children: any[], identifier?: string, label?: string) {
  return {
    type: 'container' as const,
    kind,
    ...(identifier ? { identifier, label: label ?? identifier } : {}),
    children,
  };
}

export function caption(children: any[]) {
  return { type: 'caption' as const, children };
}

export function image(url: string, alt?: string, width?: string) {
  return {
    type: 'image' as const,
    url,
    ...(alt ? { alt } : {}),
    ...(width ? { width } : {}),
  };
}

// ── Table nodes ──

export function table(children: any[]) {
  return { type: 'table' as const, children };
}

export function tableRow(children: any[], isHeader?: boolean) {
  return {
    type: 'tableRow' as const,
    ...(isHeader ? { isHeader: true } : {}),
    children,
  };
}

export function tableCell(children: any[], header?: boolean) {
  return {
    type: 'tableCell' as const,
    ...(header ? { header: true } : {}),
    children,
  };
}

// ── Extension nodes (myst-spec-ext) ──

export function tabSet(children: any[]) {
  return { type: 'tabSet' as const, children };
}

/**
 * Per-transform tabItem factory. The book-theme React renderer
 * requires a unique `key` per tabItem; we mint one with a closure-
 * scoped counter so two consecutive transform passes produce the
 * same keys (downstream consumers diffing AST JSON shouldn't see
 * spurious `key` changes from a module-global counter).
 */
export function makeTabItem(): (
  title: string,
  children: any[],
  selected?: boolean,
) => any {
  let counter = 0;
  return function tabItem(title, children, selected) {
    const key = `tab-${(counter++).toString(36)}`;
    return {
      type: 'tabItem' as const,
      title,
      key,
      ...(selected ? { selected: true } : {}),
      children,
    };
  };
}

export function card(title: string, children: any[], url?: string) {
  return {
    type: 'card' as const,
    title,
    ...(url ? { url } : {}),
    children,
  };
}

// ── Citation nodes ──

export function cite(label: string, children: any[], kind?: 'narrative' | 'parenthetical') {
  return {
    type: 'cite' as const,
    label,
    identifier: label.toLowerCase().replace(/\s+/g, '_'),
    ...(kind ? { kind } : {}),
    children,
  };
}

export function citeGroup(children: any[], kind: 'narrative' | 'parenthetical' = 'narrative') {
  return { type: 'citeGroup' as const, kind, children };
}

// ── Collapsible / structural nodes ──

export function details(children: any[], open = false) {
  return { type: 'details' as const, open, children };
}

export function summary(children: any[]) {
  return { type: 'summary' as const, children };
}

// ── Generic nodes & tree utilities ──

/**
 * A visible block `div` grouping a component's neutral fallback under the one
 * node that bears its `<kind>-<id>` identifier. A rich theme that overrides the
 * carrier replaces the whole fallback with it (no double render); stock themes
 * render a plain `<div>` (the same node the `:::{div}` directive emits) with
 * the children inside, and the identifier still anchors cross-references.
 */
export function carrierDiv(children: any[], identifier: string) {
  return { type: 'div' as const, identifier, label: identifier, children };
}

/**
 * A hidden carrier `<div style="display:none">` — invisible on every theme, but
 * its subtree and `data` survive into the build for a rich theme to read.
 */
export function hiddenDiv(cls: string, children: any[] = []) {
  return { type: 'div' as const, class: cls, style: { display: 'none' }, children };
}

/**
 * Depth-first visit of an mdast node (or array of nodes): call `visit` on every
 * object node and recurse into its `children`. Non-objects are skipped.
 */
export function walkNodes(node: any, visit: (n: any) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walkNodes(n, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node.children)) for (const c of node.children) walkNodes(c, visit);
}

// ── ASTRA reference metadata ──

/** Generic inline `span` with a class and children. */
function span(cls: string, children: any[]) {
  return { type: 'span' as const, class: cls, children };
}

/** A neutral inline ASTRA reference keyed by the SDK's canonical record path. */
export function refNode(
  kind: string,
  id: string,
  label: string,
  subtype?: string,
  canonicalPath?: string | null,
) {
  const mods = subtype ? [kind, subtype] : [kind];
  const cls = ['astra-ref', ...mods.map((k) => `astra-ref--${k}`)].join(' ');
  const node: any = span(cls, [text(label)]);
  node.data = {
    astra: {
      kind,
      id,
      ...(canonicalPath ? { canonicalPath } : {}),
    },
  };
  return node;
}
