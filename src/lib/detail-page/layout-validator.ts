// src/lib/detail-page/layout-validator.ts
import { z } from 'zod';
import { checkProhibitedPhrases } from '@/lib/ai/prompts/detail-page';
import { normalizeImageBlocks } from './layout-image-blocks';
import type { LayoutBlock } from '@/types/detail-page';
import { collectOptionCoverage, type OptionSection } from './product-options';
import { BEATS, checkNarrative, type NarrativeSection } from './narrative';
import { sanitizeProgressBars } from './progress-hygiene';
import { hasVisualAnchor, countMismatch } from './section-shape';
// gen-slots.ts는 import 없는 leaf 모듈이다 — 정의를 거기 하나로 두고 여기서는
// re-export만 한다. page.tsx(클라이언트 컴포넌트)가 이 이름들만 쓰려고 이
// 파일을 통째로 import하면 아래 zod 스키마(zLayoutBlock 등)가 tree-shake되지
// 않고 클라이언트 번들에 그대로 들어간다(esbuild 실측 313KB, 그중 310KB가 zod).
export { GEN_SLOT_TYPES, isGenSlotType, type GenSlotType } from './gen-slots';

export interface Violation {
  code:
    | 'schema' | 'cjk' | 'broken_text' | 'empty_block'
    | 'duplicate' | 'section_count' | 'prohibited'
    | 'option_compare' | 'option_coverage' | 'option_image' | 'narrative'
    | 'visual_anchor' | 'count_mismatch';
  path: string;
  message: string;
  severity: 'error' | 'warning';
  autoFixable: boolean;
}

export interface ValidationResult {
  violations: Violation[];
  isClean: boolean; // error severity가 하나도 없으면 true
}

export interface ProLayoutOpts {
  /** stat_row 위생. 생성 경로에서만 true (draft/render는 사용자 편집본이라 건드리지 않는다) */
  statHygiene?: boolean;
  /** 옵션 모드일 때 imageIndex → 옵션명. (다음 작업에서 사용) */
  optionNameByImageIndex?: Map<number, string>;
  /** 서사 검증 활성화 — 생성 경로 전용. draft/render는 사용자 편집본이라 켜지 않는다. */
  narrative?: boolean;
  /**
   * progress_bar 수치 대조용 입력 원천.
   * 지정하면 displayValue의 숫자가 이 문자열에 등장하는 item만 남긴다.
   * undefined면 progress_bar를 건드리지 않는다 (빈 문자열과 구분된다).
   */
  provenanceSource?: string;
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
    // 실측 스펙 표. 열 수는 390px 가독성 한계라 렌더러가 5열로 자르지만,
    // 스키마에서 막지는 않는다 — 잘라 보여주는 편이 블록 통째로 사라지는 것보다 낫다.
    z.object({ type: z.literal('spec_table'), columns: z.array(z.string()), rows: z.array(z.array(z.string())), unit: z.string().optional(), note: z.string().optional() }),
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
  imageSlots: z.array(z.object({
    slotType: z.string(),
    promptHint: z.string().optional(),
    // compare_pair 전용 — 좌측(기존 방식)의 어질러진 씬. promptHint는 우측 배경을
    // 뜻하므로 두 힌트의 성격이 다르다. 다른 슬롯 타입에서는 쓰이지 않는다.
    beforeHint: z.string().optional(),
    imageRef: z.number().optional(),
  })).optional(),
  // 서사 비트. optional인 이유는 기존 draft 로드가 깨져서가 아니라(draft GET은 검증을
  // 거치지 않는다), draft 저장·render 경로의 warnings에 스키마 노이즈를 만들지
  // 않기 위해서다. 누락 검증은 narrative 플래그가 켜진 생성 경로에서만 한다.
  beat: z.enum(BEATS).optional(),
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

// ── stat_row 위생 ──
// 치수의 0(= 그 부위가 없음)과 옵션 개수는 임팩트 수치가 아니다.
// "설탕 0g"처럼 0 자체가 셀링포인트인 경우가 있어 0값 제거는 치수로 좁힌다.
// 0이 자랑거리인 패턴 — "두께 오차 0mm", "불량 0건"은 지우면 안 된다.
const ZERO_IS_VIRTUE = /(오차|편차|변형|수축|하자|불량|손상|위험|검출|이염)/;
// 실제 치수 단위 (완전일치)
const DIMENSION_UNITS = new Set(['cm', 'mm', '㎜', '㎝', 'm', '인치', 'inch']);
// 치수 명사가 label 끝에 올 때만 — "폭발"처럼 앞쪽 매칭을 피한다
const DIMENSION_LABEL_SUFFIX = /(길이|두께|높이|너비|폭|깊이|지름|둘레)$/;
// 개수 단위 (완전일치) — "개월"은 "개"와 다른 문자열이므로 자동으로 제외된다
const COUNT_UNITS = new Set(['단계', '종', '가지', '개', '컬러', '색상', '종류', '옵션', '세트']);
// unit이 비었을 때만 쓰는 좁은 label 구문
const COUNT_LABEL_PHRASE = /(사이즈\s*단계|컬러\s*수|색상\s*수|옵션\s*수|구성\s*수|종류\s*수)/;
// 개수형으로 볼 상한 — "누적 판매 12000개"는 실적 지표다
const MAX_COUNT_VALUE = 100;
const ABSENT_VALUES = new Set(['없음', '무', '-', '–', 'N/A', 'n/a']);

interface StatItem { label?: string; value?: string; unit?: string }

/** 임팩트 수치로 볼 수 없는 stat 항목인지 */
export function isNoiseStatItem(item: StatItem): boolean {
  const value = (item?.value ?? '').trim();
  const label = (item?.label ?? '').trim();
  const unit = (item?.unit ?? '').trim();

  if (value === '' || ABSENT_VALUES.has(value)) return true;

  const nums = value.match(/\d+(?:\.\d+)?/g);
  if (!nums) return false;
  const isZero = nums.every((n) => Number(n) === 0);

  // 값이 0 + 치수 → "소매 길이 0cm" (그 부위가 없다는 뜻).
  // 단 "두께 오차 0mm"처럼 0이 자랑인 표현은 남긴다.
  if (isZero) {
    if (ZERO_IS_VIRTUE.test(label)) return false;
    return DIMENSION_UNITS.has(unit) || DIMENSION_LABEL_SUFFIX.test(label);
  }

  // 개수형 판정. "4단계"처럼 값에 단위가 붙은 형태와 unit이 분리된 형태를 모두 본다.
  const m = value.match(/^(\d+)\s*(\S*)$/);
  if (!m) return false;
  const n = Number(m[1]);
  // 큰 수는 옵션 개수가 아니라 실적 지표다 — "누적 판매 12000개".
  if (!Number.isFinite(n) || n >= MAX_COUNT_VALUE) return false;

  const inlineUnit = m[2] ?? '';
  if (inlineUnit !== '') return COUNT_UNITS.has(inlineUnit);
  return COUNT_UNITS.has(unit) || COUNT_LABEL_PHRASE.test(label);
}

/**
 * blocks 배열의 stat_row 항목을 걸러낸다.
 * topLevel이면 2개 미만일 때 items를 비워 pruneBlocks가 제거하게 하고,
 * cols 안(topLevel=false)이면 pruneBlocks가 닿지 않으므로 블록을 직접 뺀다.
 */
function cleanStatBlocks(blocks: unknown[], topLevel: boolean): unknown[] {
  const out: unknown[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') { out.push(b); continue; }
    const block = { ...(b as Record<string, unknown>) };

    if (Array.isArray(block.cols)) {
      // stat_row를 빼서 빈 컬럼이 생기면 렌더러가 빈 flex 칸을 그린다 → 함께 제거한다.
      const cols = (block.cols as unknown[])
        .map((col) => (Array.isArray(col) ? cleanStatBlocks(col, false) : col))
        .filter((col) => !Array.isArray(col) || col.length > 0);
      if (cols.length === 0) continue; // 모든 컬럼이 비면 columns 블록 자체를 드롭
      block.cols = cols;
    }

    if (block.type === 'stat_row' && Array.isArray(block.items)) {
      const original = block.items as StatItem[];
      const kept = original.filter(
        (it) => it && typeof it === 'object' && !isNoiseStatItem(it)
      );
      // 위생의 목적은 잡음 제거지 구조 개편이 아니다 — 필터링이 실제로 일어난 경우에만
      // 2개 미만 규칙을 적용한다. 원래도 1개였던 stat_row는 그대로 둔다.
      if (kept.length < 2 && kept.length < original.length) {
        if (!topLevel) continue; // cols 안: 블록 자체 제거
        block.items = [];        // 최상위: pruneBlocks가 제거
      } else {
        block.items = kept;
      }
    }
    out.push(block);
  }
  return out;
}

/** 섹션의 stat_row를 위생 처리 */
function sanitizeStatRows(sec: unknown): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (!Array.isArray(s.blocks)) return s;
  s.blocks = cleanStatBlocks(s.blocks as unknown[], true);
  return s;
}

/**
 * option_grid 카드 수와 섹션 이미지 슬롯 수의 정합성을 본다.
 *
 * 렌더러는 슬롯 수와 카드 수가 정확히 같을 때만 카드에 이미지를 그린다
 * (isOptionGridCarrier). 그래서 어긋나면 이미지가 통째로 사라지고, 반대로
 * 맞아떨어지는데 대형 image 블록까지 있으면 같은 이미지가 두 번 보인다.
 * 둘 다 렌더는 깨지지 않고 sanitize가 흡수하므로 warning이다.
 */
function checkOptionGridImages(sec: unknown, base: string): Violation[] {
  const s = sec as { blocks?: unknown; imageSlots?: unknown };
  if (!Array.isArray(s.blocks)) return [];
  const grid = s.blocks.find(
    (b): b is { type: 'option_grid'; items: unknown[] } =>
      !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'option_grid'
      && Array.isArray((b as { items?: unknown }).items),
  );
  if (!grid) return [];

  const slotCount = Array.isArray(s.imageSlots) ? s.imageSlots.length : 0;
  if (slotCount === 0) return []; // 텍스트 전용 옵션 카드 — 정상

  if (slotCount !== grid.items.length) {
    return [{
      code: 'option_image', path: `${base}.imageSlots`,
      message: `option_grid 카드 ${grid.items.length}개와 이미지 슬롯 ${slotCount}개가 달라 카드 이미지를 표시하지 않습니다.`,
      severity: 'warning', autoFixable: true,
    }];
  }

  let hasImage = false;
  forEachBlock(sec, (block) => { if (block.type === 'image') hasImage = true; });
  if (hasImage) {
    return [{
      code: 'option_image', path: `${base}.blocks`,
      message: '카드가 이미지를 표시하는 option_grid 섹션에 대형 image 블록이 있어 이미지가 중복됩니다.',
      severity: 'warning', autoFixable: true,
    }];
  }
  return [];
}

/** 텍스트/항목이 비어 렌더링이 무의미한 블록인지 */
export function isEmptyBlock(block: Record<string, unknown>): boolean {
  const t = block.type;
  if ((t === 'heading' || t === 'subtext' || t === 'badge') &&
      (typeof block.text !== 'string' || block.text.trim() === '')) return true;
  const itemTypes = ['bullet_list', 'stat_row', 'icon_grid', 'option_grid', 'process_flow', 'progress_bar', 'timeline'];
  if (itemTypes.includes(t as string) && Array.isArray(block.items) && block.items.length === 0) return true;
  // spec_table은 items가 아니라 columns/rows를 쓴다. 머리행만 있고 데이터가 없으면
  // 빈 표 껍데기가 남으므로 rows 기준으로 판정한다.
  if (t === 'spec_table' && (!Array.isArray(block.rows) || block.rows.length === 0)) return true;
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
export function validateProLayout(sections: unknown, opts?: ProLayoutOpts): ValidationResult {
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

    // 시각 앵커 — D2는 프롬프트에만 있고 검사가 없어서, 헤드라인+문단+불릿뿐인
    // 섹션이 그대로 통과했다(실제 생성물에서 텍스트 벽이 이탈 지점 1번이었다).
    // autoFixable: repair가 기존 불릿을 icon_grid로 옮기는 식으로 고칠 수 있다.
    const secBlocks = (sec as { blocks?: unknown }).blocks;
    if (Array.isArray(secBlocks) && secBlocks.length > 0 && !hasVisualAnchor(secBlocks)) {
      violations.push({
        code: 'visual_anchor', path: `${base}.blocks`,
        message: '이미지·차트·stat·아이콘·표가 하나도 없는 텍스트 전용 섹션',
        // warning인 이유: error로 올리면 isClean이 깨져 repair 패스를 매번 부른다.
        // 실제 생성물에서 19섹션 중 2개가 이 상태였으니 3회 중 2회는 Claude를 한 번
        // 더 부르게 된다. 셀러에게 주는 해법("다시 생성")은 어느 쪽이든 같은데
        // 비용만 는다. 대신 friendlyViolationWarnings가 이 코드를 따로 실어 보낸다.
        severity: 'warning', autoFixable: true,
      });
    }

    // 헤드라인이 "두 가지만"이라 해놓고 항목이 4개인 경우. 숫자가 본문과 어긋나면
    // 그 자체로 신뢰가 깎인다.
    const headings = Array.isArray(secBlocks)
      ? (secBlocks as Array<Record<string, unknown>>).filter((b) => b?.type === 'heading')
      : [];
    for (const h of headings) {
      if (typeof h.text !== 'string') continue;
      const mm = countMismatch(h.text, secBlocks);
      if (mm) {
        violations.push({
          code: 'count_mismatch', path: `${base}.blocks`,
          message: `헤드라인은 ${mm.declared}가지인데 항목은 ${mm.actual}개: "${h.text}"`,
          severity: 'warning', autoFixable: true,
        });
      }
    }

    // option_grid ↔ 이미지 슬롯 정합성
    violations.push(...checkOptionGridImages(sec, base));
  });

  // ── 옵션 커버리지 (고유 옵션이 2개 이상일 때만) ──
  const nameByIdx = opts?.optionNameByImageIndex;
  if (nameByIdx && new Set(nameByIdx.values()).size >= 2) {
    const cov = collectOptionCoverage(sections as OptionSection[], nameByIdx);

    if (cov.compareSectionCount === 0) {
      violations.push({
        code: 'option_compare', path: 'sections',
        message: '옵션 비교 섹션이 없습니다. option_grid + 옵션 수만큼의 imageSlots를 가진 섹션이 1개 필요합니다.',
        severity: 'error', autoFixable: false,
      });
    } else if (cov.compareSectionCount > 1) {
      violations.push({
        code: 'option_compare', path: 'sections',
        message: `옵션 비교 섹션이 ${cov.compareSectionCount}개입니다 (1개여야 함).`,
        severity: 'warning', autoFixable: false,
      });
    }

    if (cov.unresolvedSlots > 0) {
      violations.push({
        code: 'option_coverage', path: 'sections',
        message: `비교 섹션 밖 이미지 슬롯 ${cov.unresolvedSlots}개에 imageRef가 없거나 옵션명 없는 이미지를 가리킵니다.`,
        severity: 'error', autoFixable: false,
      });
    }

    const entries = [...cov.counts.entries()];
    const zero = entries.filter(([, c]) => c === 0).map(([n]) => n);
    if (zero.length > 0) {
      violations.push({
        code: 'option_coverage', path: 'sections',
        message: `비교 섹션 밖에서 한 번도 등장하지 않은 옵션: ${zero.join(', ')}`,
        severity: 'error', autoFixable: false,
      });
    } else if (entries.length > 0) {
      const counts = entries.map(([, c]) => c);
      if (Math.max(...counts) - Math.min(...counts) > 1) {
        violations.push({
          code: 'option_coverage', path: 'sections',
          message: `옵션 편중: ${entries.map(([n, c]) => `${n} ${c}회`).join(', ')} (편차 1 이하여야 함)`,
          severity: 'error', autoFixable: false,
        });
      }
    }
  }

  // ── 서사 검증 (생성 경로 전용) ──
  // NarrativeIssue의 rule(8종 세부 코드)·labels(compare_claim 종류)는 여기서 버리고
  // Violation.code는 'narrative' 하나로 접는다 — 지금 유일한 소비자(repair 프롬프트)가
  // severity별로만 분기하기 때문이다. narrative.ts가 세운 계약("메시지를 정규식으로
  // 파싱해 분기하지 말라")과 겉보기엔 모순이지만 의도적이다: 규칙별 분기가
  // 필요해지면 Violation에 code를 세분화하거나 rule/labels를 얹은 필드를 추가하라
  // (Violation 타입에 필드를 미리 추가해두지 않기로 한 것도 이번 검토에서 정한
  // 결정이다). 정규식 파싱으로 우회하지 말 것.
  if (opts?.narrative) {
    for (const issue of checkNarrative(sections as NarrativeSection[])) {
      violations.push({
        code: 'narrative',
        path: issue.sectionIndex !== undefined ? `sections[${issue.sectionIndex}]` : 'sections',
        message: issue.message,
        severity: issue.severity,
        autoFixable: false,
      });
    }
  }

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
export function sanitizeProLayout(
  sections: unknown[],
  opts?: ProLayoutOpts,
): { sections: unknown[]; warnings: Violation[] } {
  if (!Array.isArray(sections)) return { sections: [], warnings: validateProLayout(sections, opts).violations };

  // 1) CJK·U+FFFD 삭제
  let cleaned = stripCjk(sections) as unknown[];
  // 2) stat_row 위생 (생성 경로 전용 — draft/render는 사용자 편집본이라 건드리지 않는다)
  if (opts?.statHygiene) cleaned = cleaned.map(sanitizeStatRows);
  // 2-b) progress_bar 수치 위생 — 입력 원천에 없는 수치를 제거한다.
  //      pruneBlocks(3단계)보다 앞에 와야 items가 빈 블록이 제거된다.
  if (opts?.provenanceSource !== undefined) {
    const src = opts.provenanceSource;
    cleaned = cleaned.map((sec) => sanitizeProgressBars(sec, src));
  }
  // 3) 빈/무효 블록 제거
  cleaned = cleaned.map(pruneBlocks);
  // 4) 연속 중복 섹션 제거
  cleaned = cleaned.filter((sec, i) => i === 0 || JSON.stringify(sec) !== JSON.stringify(cleaned[i - 1]));
  // 5) image 블록 ↔ imageSlots 정합성 (범위 클램프 + 부재 시 주입)
  cleaned = cleaned.map(normalizeSectionImages);

  const { violations } = validateProLayout(cleaned, opts);
  return { sections: cleaned, warnings: violations };
}
