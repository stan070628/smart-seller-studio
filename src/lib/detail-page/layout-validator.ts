// src/lib/detail-page/layout-validator.ts
import { z } from 'zod';
import { checkProhibitedPhrases } from '@/lib/ai/prompts/detail-page';
import { normalizeImageBlocks } from './layout-image-blocks';
import type { LayoutBlock } from '@/types/detail-page';

export interface Violation {
  code:
    | 'schema' | 'cjk' | 'broken_text' | 'empty_block'
    | 'duplicate' | 'section_count' | 'prohibited';
  path: string;
  message: string;
  severity: 'error' | 'warning';
  autoFixable: boolean;
}

export interface ValidationResult {
  violations: Violation[];
  isClean: boolean; // error severity가 하나도 없으면 true
}

// ── CJK 정규식: test용(non-global, lastIndex 버그 회피)과 strip용(global) 분리 ──
// U+4E00-U+9FFF: CJK Unified Ideographs, U+3400-U+4DBF: CJK Ext-A, U+F900-U+FAFF: CJK Compatibility
const CJK_TEST = /[一-鿿㐀-䶿豈-﫿]/;
const CJK_GLOBAL = /[一-鿿㐀-䶿豈-﫿]/g;

// ── Zod 스키마: types/detail-page.ts LayoutBlock union 반영 ──
const zLayoutBlock: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('badge'), text: z.string(), color: z.enum(['primary', 'accent', 'neutral']).optional() }),
    z.object({ type: z.literal('heading'), text: z.string(), size: z.enum(['xl', 'lg', 'md']), bold: z.boolean().optional(), color: z.enum(['primary', 'text', 'accent']).optional() }),
    z.object({ type: z.literal('subtext'), text: z.string(), align: z.enum(['left', 'center']).optional() }),
    z.object({ type: z.literal('image'), attachedIndex: z.number(), width: z.string().optional(), align: z.enum(['center', 'left', 'right']).optional(), rounded: z.boolean().optional() }),
    z.object({ type: z.literal('stat_row'), items: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string().optional() })) }),
    z.object({ type: z.literal('bullet_list'), items: z.array(z.string()), icon: z.enum(['dot', 'check', 'arrow']).optional() }),
    z.object({ type: z.literal('columns'), cols: z.array(z.array(zLayoutBlock)), gap: z.number().optional() }),
    z.object({ type: z.literal('divider') }),
    z.object({ type: z.literal('spacer'), height: z.number() }),
    z.object({ type: z.literal('progress_bar'), items: z.array(z.object({ label: z.string(), value: z.number(), displayValue: z.string().optional(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('process_flow'), direction: z.enum(['horizontal', 'vertical']).optional(), items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('icon_grid'), cols: z.union([z.literal(2), z.literal(3)]).optional(), items: z.array(z.object({ icon: z.string(), title: z.string(), subtitle: z.string().optional() })) }),
    z.object({ type: z.literal('option_grid'), cols: z.union([z.literal(2), z.literal(3)]).optional(), items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('layout_bar_chart'), title: z.string().optional(), unit: z.string().optional(), groups: z.array(z.string()), groupColors: z.array(z.string()), items: z.array(z.object({ label: z.string(), values: z.array(z.number()) })), showLegend: z.boolean().optional() }),
    z.object({ type: z.literal('radar_chart'), axes: z.array(z.object({ label: z.string(), value: z.number(), max: z.number().optional() })), color: z.string().optional() }),
    z.object({ type: z.literal('timeline'), items: z.array(z.object({ stage: z.string(), icon: z.string().optional(), value: z.string().optional(), highlight: z.boolean().optional() })) }),
  ])
);

const zClaudeSection = z.object({
  type: z.literal('claude_layout'),
  title: z.string(),
  points: z.array(z.string()).optional(),
  blocks: z.array(zLayoutBlock),
  bgStyle: z.enum(['white', 'light', 'dark', 'primary']).optional(),
  padding: z.enum(['normal', 'compact', 'wide']).optional(),
  imageSlots: z.array(z.object({ slotType: z.string(), promptHint: z.string().optional(), imageRef: z.number().optional() })).optional(),
});

// ── 헬퍼 ──
/** 객체 트리의 모든 문자열에 콜백(path는 점/인덱스 표기) */
function forEachString(node: unknown, cb: (s: string, path: string) => void, prefix = ''): void {
  if (typeof node === 'string') { cb(node, prefix); return; }
  if (Array.isArray(node)) { node.forEach((v, i) => forEachString(v, cb, `${prefix}[${i}]`)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) forEachString(v, cb, prefix ? `${prefix}.${k}` : k);
  }
}

/** 섹션의 blocks(및 columns.cols 재귀)를 순회 */
function forEachBlock(sec: unknown, cb: (block: Record<string, unknown>, path: string) => void): void {
  const blocks = (sec as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return;
  const walk = (arr: unknown[], prefix: string): void => {
    arr.forEach((b, i) => {
      if (b && typeof b === 'object') {
        const path = `${prefix}[${i}]`;
        cb(b as Record<string, unknown>, path);
        const cols = (b as { cols?: unknown }).cols;
        if (Array.isArray(cols)) cols.forEach((col, ci) => { if (Array.isArray(col)) walk(col, `${path}.cols[${ci}]`); });
      }
    });
  };
  walk(blocks, 'blocks');
}

/** 텍스트/항목이 비어 렌더링이 무의미한 블록인지 */
export function isEmptyBlock(block: Record<string, unknown>): boolean {
  const t = block.type;
  if ((t === 'heading' || t === 'subtext' || t === 'badge') &&
      (typeof block.text !== 'string' || block.text.trim() === '')) return true;
  const itemTypes = ['bullet_list', 'stat_row', 'icon_grid', 'option_grid', 'process_flow', 'progress_bar', 'timeline'];
  if (itemTypes.includes(t as string) && Array.isArray(block.items) && block.items.length === 0) return true;
  return false;
}

/** JSON 값 트리를 재귀 순회하며 문자열에서 CJK·U+FFFD를 제거 */
export function stripCjk(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(CJK_GLOBAL, '').replace(/�/g, '').trim();
  if (Array.isArray(value)) return value.map(stripCjk);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripCjk(v)]));
  }
  return value;
}

export { zLayoutBlock, zClaudeSection };

/** 생성된 PRO 레이아웃을 결정적으로 검증한다. 의미 오류는 여기서 다루지 않는다(LLM 담당). */
export function validateProLayout(sections: unknown): ValidationResult {
  if (!Array.isArray(sections)) {
    return {
      violations: [{ code: 'schema', path: 'sections', message: 'sections는 배열이어야 합니다.', severity: 'error', autoFixable: false }],
      isClean: false,
    };
  }

  const violations: Violation[] = [];

  if (sections.length < 6 || sections.length > 10) {
    violations.push({ code: 'section_count', path: 'sections', message: `섹션 ${sections.length}개 (권장 6~10)`, severity: 'warning', autoFixable: false });
  }

  sections.forEach((sec, i) => {
    const base = `sections[${i}]`;

    // 스키마
    const parsed = zClaudeSection.safeParse(sec);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        violations.push({ code: 'schema', path: `${base}.${issue.path.join('.')}`, message: issue.message, severity: 'error', autoFixable: false });
      }
    }

    // 연속 중복
    if (i > 0 && JSON.stringify(sec) === JSON.stringify(sections[i - 1])) {
      violations.push({ code: 'duplicate', path: base, message: '이전 섹션과 완전 동일', severity: 'warning', autoFixable: true });
    }

    // 문자열 기반 검사(cjk/broken_text/prohibited)
    forEachString(sec, (str, spath) => {
      const fullPath = spath ? `${base}.${spath}` : base;
      if (CJK_TEST.test(str)) violations.push({ code: 'cjk', path: fullPath, message: `한자 포함: "${str}"`, severity: 'error', autoFixable: true });
      if (str.includes('�')) violations.push({ code: 'broken_text', path: fullPath, message: '깨진 문자(U+FFFD) 포함', severity: 'warning', autoFixable: true });
      const prob = checkProhibitedPhrases(str);
      if (prob.violations.length > 0) violations.push({ code: 'prohibited', path: fullPath, message: `금지어: ${prob.violations.join(', ')}`, severity: 'error', autoFixable: false });
    });

    // 빈 블록
    forEachBlock(sec, (block, bpath) => {
      if (isEmptyBlock(block)) violations.push({ code: 'empty_block', path: `${base}.${bpath}`, message: `빈 블록(${String(block.type)})`, severity: 'warning', autoFixable: true });
    });
  });

  const isClean = !violations.some((v) => v.severity === 'error');
  return { violations, isClean };
}

/**
 * 섹션 blocks의 image 블록을 imageSlots 개수에 맞춰 정규화한다.
 * (attachedIndex 범위 클램프 + imageSlots가 있는데 image 블록이 없으면 주입)
 * 렌더러가 blocks의 image 블록으로만 그리므로, 이 보정이 없으면 슬롯 이미지가 무음 드롭된다.
 */
function normalizeSectionImages(sec: unknown): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = sec as Record<string, unknown>;
  if (!Array.isArray(s.blocks)) return sec;
  const slotCount = Array.isArray(s.imageSlots) ? s.imageSlots.length : 0;
  if (slotCount === 0) return sec;
  return { ...s, blocks: normalizeImageBlocks(s.blocks as LayoutBlock[], slotCount) };
}

/** 섹션의 빈/스키마무효 블록을 제거 */
function pruneBlocks(sec: unknown): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (Array.isArray(s.blocks)) {
    s.blocks = (s.blocks as unknown[]).filter(
      (b) => b !== null && typeof b === 'object'
        && !isEmptyBlock(b as Record<string, unknown>)
        && zLayoutBlock.safeParse(b).success
    );
  }
  return s;
}

/**
 * 결정적 코드 폴백. autoFixable 문제를 코드로 강제 교정하고,
 * 교정 후에도 남은 위반을 warnings로 반환한다.
 */
export function sanitizeProLayout(sections: unknown[]): { sections: unknown[]; warnings: Violation[] } {
  if (!Array.isArray(sections)) return { sections: [], warnings: validateProLayout(sections).violations };

  // 1) CJK·U+FFFD 삭제
  let cleaned = stripCjk(sections) as unknown[];
  // 2) 빈/무효 블록 제거
  cleaned = cleaned.map(pruneBlocks);
  // 3) 연속 중복 섹션 제거
  cleaned = cleaned.filter((sec, i) => i === 0 || JSON.stringify(sec) !== JSON.stringify(cleaned[i - 1]));
  // 4) image 블록 ↔ imageSlots 정합성 (범위 클램프 + 부재 시 주입)
  cleaned = cleaned.map(normalizeSectionImages);

  const { violations } = validateProLayout(cleaned);
  return { sections: cleaned, warnings: violations };
}
