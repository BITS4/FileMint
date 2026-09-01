import { describe, expect, it } from 'vitest';

import { CONVERT_TOOLS } from './tools.convert';
import {
  CATEGORIES,
  PREMIUM_TOOL_IDS,
  pickTools,
  STATUS_LABEL,
  TOOLS,
  findTool,
  searchTools,
  toolsByCategory,
} from './tools';

describe('tool catalog', () => {
  it('keeps every tool id unique', () => {
    const ids = TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the extracted conversion catalog exactly once', () => {
    for (const tool of CONVERT_TOOLS) {
      expect(TOOLS.filter((candidate) => candidate.id === tool.id)).toHaveLength(1);
    }
  });

  it('derives premium metadata from the canonical premium set', () => {
    for (const tool of TOOLS) {
      expect(Boolean(tool.premium)).toBe(PREMIUM_TOOL_IDS.has(tool.id));
    }
  });

  it('finds and filters tools by stable metadata', () => {
    expect(findTool('pdf-to-docx')?.title).toBe('PDF to Word');
    expect(findTool()).toBeUndefined();
    expect(toolsByCategory('convert').every((tool) => tool.category === 'convert')).toBe(true);
    expect(searchTools('spreadsheet').some((tool) => tool.id === 'pdf-to-xlsx')).toBe(true);
    expect(searchTools('   ')).toEqual([]);
    expect(pickTools(['pdf-to-docx', 'missing', 'open-pdf']).map((tool) => tool.id)).toEqual([
      'pdf-to-docx',
      'open-pdf',
    ]);
  });

  it('publishes category and status metadata from the focused catalog module', () => {
    expect(CATEGORIES.map((category) => category.key)).toEqual([
      'convert',
      'organize',
      'edit',
      'scan',
      'ocr',
      'security',
      'view',
    ]);
    expect(STATUS_LABEL).toEqual({ ready: 'Ready', beta: 'Beta', backend: 'Server', soon: 'Soon' });
  });
});
