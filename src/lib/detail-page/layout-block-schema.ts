// src/lib/detail-page/layout-block-schema.ts
// Zod 스키마 + 결정론적 정화 함수 — LayoutBlock union을 1:1 반영
import { z } from 'zod';
import type { LayoutBlock } from '@/types/detail-page';

/**
 * LayoutBlock Zod 스키마. `src/types/detail-page.ts`의 union과 1:1 대응.
 * items 배열은 비어 있으면 의미 없는 블록이므로 .min(1) 추가.
 * `columns.cols`는 재귀 참조이므로 z.lazy() 사용.
 */
export const LayoutBlockSchema: z.ZodType<LayoutBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    // ── 기본 텍스트/시각 ──
    z.object({
      type: z.literal('badge'),
      text: z.string(),
      color: z.enum(['primary', 'accent', 'neutral']).optional(),
    }),
    z.object({
      type: z.literal('heading'),
      text: z.string(),
      size: z.enum(['xl', 'lg', 'md']),
      bold: z.boolean().optional(),
      color: z.enum(['primary', 'text', 'accent']).optional(),
    }),
    z.object({
      type: z.literal('subtext'),
      text: z.string(),
      align: z.enum(['left', 'center']).optional(),
    }),
    z.object({
      type: z.literal('image'),
      attachedIndex: z.number().int().min(0),
      width: z.string().optional(),
      align: z.enum(['center', 'left', 'right']).optional(),
      rounded: z.boolean().optional(),
    }),
    // ── 데이터/리스트 ──
    z.object({
      type: z.literal('stat_row'),
      items: z.array(
        z.object({ label: z.string(), value: z.string(), unit: z.string().optional() }),
      ).min(1),
    }),
    z.object({
      type: z.literal('bullet_list'),
      items: z.array(z.string()).min(1),
      icon: z.enum(['dot', 'check', 'arrow']).optional(),
    }),
    // ── 레이아웃 ──
    z.object({
      type: z.literal('columns'),
      cols: z.array(z.array(LayoutBlockSchema)),
      gap: z.number().optional(),
    }),
    z.object({ type: z.literal('divider') }),
    z.object({ type: z.literal('spacer'), height: z.number() }),
    // ── Phase 1 신규 ──
    z.object({
      type: z.literal('progress_bar'),
      items: z.array(
        z.object({
          label: z.string(),
          value: z.number(),
          displayValue: z.string().optional(),
          highlight: z.boolean().optional(),
        }),
      ).min(1),
    }),
    z.object({
      type: z.literal('process_flow'),
      direction: z.enum(['horizontal', 'vertical']).optional(),
      items: z.array(
        z.object({
          label: z.string(),
          sublabel: z.string().optional(),
          highlight: z.boolean().optional(),
        }),
      ).min(1),
    }),
    z.object({
      type: z.literal('icon_grid'),
      cols: z.union([z.literal(2), z.literal(3)]).optional(),
      items: z.array(
        z.object({ icon: z.string(), title: z.string(), subtitle: z.string().optional() }),
      ).min(1),
    }),
    z.object({
      type: z.literal('option_grid'),
      cols: z.union([z.literal(2), z.literal(3)]).optional(),
      items: z.array(
        z.object({
          label: z.string(),
          sublabel: z.string().optional(),
          highlight: z.boolean().optional(),
        }),
      ).min(1),
    }),
    z.object({
      type: z.literal('layout_bar_chart'),
      title: z.string().optional(),
      unit: z.string().optional(),
      groups: z.array(z.string()),
      groupColors: z.array(z.string()),
      items: z.array(
        z.object({ label: z.string(), values: z.array(z.number()) }),
      ).min(1),
      showLegend: z.boolean().optional(),
    }),
    // ── Phase 2 (타입 정의만, 렌더러 미구현) ──
    z.object({
      type: z.literal('radar_chart'),
      axes: z.array(
        z.object({ label: z.string(), value: z.number(), max: z.number().optional() }),
      ).min(1),
      color: z.string().optional(),
    }),
    z.object({
      type: z.literal('timeline'),
      items: z.array(
        z.object({
          stage: z.string(),
          icon: z.string().optional(),
          value: z.string().optional(),
          highlight: z.boolean().optional(),
        }),
      ).min(1),
    }),
  ]) as unknown as z.ZodType<LayoutBlock>,
);

/** sanitizeProLayout 반환 타입 — blocks는 unknown[]로 인덱싱 가능 */
export interface SanitizedSection {
  blocks: unknown[];
  [key: string]: unknown;
}

/**
 * PRO 상세페이지 sections 배열에서 불량 LayoutBlock을 드롭하는 정화 함수.
 * - 배열이 아닌 입력 → 빈 배열 (throw 없음)
 * - 블록이 하나도 안 남은 섹션 → 섹션 자체를 제거
 * - 나머지 필드(imageSlots 등)는 스프레드로 그대로 보존
 */
export function sanitizeProLayout(sections: unknown[]): SanitizedSection[] {
  if (!Array.isArray(sections)) return [];

  const out: SanitizedSection[] = [];

  for (const raw of sections) {
    if (typeof raw !== 'object' || raw === null) continue;
    const section = raw as Record<string, unknown>;
    const rawBlocks = Array.isArray(section.blocks) ? section.blocks : [];
    const goodBlocks = rawBlocks.filter((b) => LayoutBlockSchema.safeParse(b).success);
    if (goodBlocks.length === 0) continue;
    out.push({ ...section, blocks: goodBlocks } as SanitizedSection);
  }

  return out;
}
