/**
 * Tests for tableNodeFromData: table cells must parse as inline MyST (like
 * MyST's native csv-table / list-table directives), not render as literal text.
 */

import { describe, it, expect } from 'vitest';
import { tableNodeFromData } from '../src/transform/render-evidence.js';
import { proseParser } from '../src/transform/prose.js';
import type { TableData } from '../src/transform/parse-table-data.js';

function collectNodes(node: any, type: string): any[] {
  const collected: any[] = [];
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.type === type) collected.push(n);
    Object.values(n).forEach(walk);
  };
  walk(node);
  return collected;
}

describe('tableNodeFromData', () => {
  it('parses LaTeX math in a cell to an inlineMath node, not literal text', () => {
    const data: TableData = {
      headers: ['tracer', 'value'],
      rows: [['lrg', '$\\chi^2_{red}$']],
    };
    const node = tableNodeFromData(data, proseParser);
    const math = collectNodes(node, 'inlineMath');
    expect(math).toHaveLength(1);
    expect(math[0].value).toBe('\\chi^2_{red}');
    // The raw dollar-quoted string must not survive as a literal text node.
    const texts = collectNodes(node, 'text').map((t) => t.value);
    expect(texts.join('')).not.toContain('$');
  });

  it('parses markdown emphasis/links in headers and cells', () => {
    const data: TableData = {
      headers: ['**Tracer**', 'note'],
      rows: [['lrg', 'see [docs](https://example.org)']],
    };
    const node = tableNodeFromData(data, proseParser);
    expect(collectNodes(node, 'strong')).toHaveLength(1);
    expect(collectNodes(node, 'link')).toHaveLength(1);
  });

  it('keeps the nested-object first column bold around parsed content', () => {
    const data: TableData = {
      headers: ['', 'value'],
      rows: [['$\\Omega_m$', '0.3']],
    };
    const node = tableNodeFromData(data, proseParser);
    const firstCell = node.children[1].children[0];
    expect(firstCell.children[0].type).toBe('strong');
    expect(collectNodes(firstCell, 'inlineMath')).toHaveLength(1);
  });

  it('renders an empty cell as a single empty text node, not a crash', () => {
    const data: TableData = { headers: ['a', 'b'], rows: [['x', '']] };
    const node = tableNodeFromData(data, proseParser);
    const cells = node.children[1].children;
    expect(cells[1].children).toEqual([{ type: 'text', value: '' }]);
  });
});
