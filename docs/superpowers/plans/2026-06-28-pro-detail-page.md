# PRO 상세페이지 자동 생성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참고 상세페이지 스크린샷 → Gemini OCR + Claude DSL + Replicate FLUX → SVG 차트 포함 전문 상세페이지 자동 생성

**Architecture:** (1) `LayoutBlock` 유니온에 4가지 차트 블록 추가, (2) `section-renderer.ts`에서 SVG-as-base64-img로 동기 렌더링, (3) 3개 신규 API 라우트(OCR 분석/DSL 생성/FLUX 이미지), (4) PRO 모드 페이지(4단계 UI). 기존 위저드는 전혀 수정하지 않음.

**Tech Stack:** Claude Sonnet 4.6, Gemini 2.5 Flash (`getGeminiGenAI()`), Replicate FLUX Kontext Pro, Sharp, Next.js App Router, Zod, Vitest

---

## 파일 구조

| 경로 | 역할 | 변경 |
|------|------|------|
| `src/types/detail-page.ts` | LayoutBlock 유니온에 6개 블록 타입 추가 | 수정 |
| `src/lib/detail-page/section-renderer.ts` | renderLayoutBlock에 4개 case 추가 | 수정 |
| `src/app/api/ai/analyze-detail-page/route.ts` | Gemini OCR — 스크린샷→구조화 데이터 | 신규 |
| `src/app/api/ai/generate-pro-layout/route.ts` | Claude DSL 전체 페이지 생성 + SSE | 신규 |
| `src/app/api/image/flux-lifestyle/route.ts` | FLUX Kontext Pro — 누끼→라이프스타일 | 신규 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` | PRO 모드 4단계 UI | 신규 |
| `src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts` | 렌더러 4개 블록 테스트 | 신규 |

---

## Task 1: LayoutBlock 타입 확장

**Files:**
- Modify: `src/types/detail-page.ts:162-171` (LayoutBlock union)

- [ ] **Step 1: 테스트 먼저 작성**

`src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts` 파일 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme, ClaudeLayoutContent } from '@/types/detail-page';

const THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#e07b54',
  accentColor: '#c45e3a',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
};

function makeSection(blocks: ClaudeLayoutContent['blocks']): DetailSection {
  return {
    id: 'test',
    type: 'claude_layout',
    content: { type: 'claude_layout', title: '테스트', blocks },
    attachedImages: [],
  };
}

describe('renderLayoutBlock — 신규 4개 블록', () => {
  it('progress_bar — 두 항목 렌더링, 퍼센트 너비 반영', () => {
    const html = renderSection(makeSection([{
      type: 'progress_bar',
      items: [
        { label: '나이아신', value: 100, displayValue: '100%', highlight: true },
        { label: '기준치', value: 80 },
      ],
    }]), THEME);
    expect(html).toContain('나이아신');
    expect(html).toContain('width:100%');
    expect(html).toContain('기준치');
    expect(html).toContain('width:80%');
  });

  it('process_flow — 화살표와 함께 항목 렌더링', () => {
    const html = renderSection(makeSection([{
      type: 'process_flow',
      items: [
        { label: '원재료' },
        { label: '발효', highlight: true },
        { label: '농축' },
      ],
    }]), THEME);
    expect(html).toContain('원재료');
    expect(html).toContain('발효');
    expect(html).toContain('농축');
    expect(html).toContain('→');
  });

  it('icon_grid — 3열 기본값, 아이콘과 제목 렌더링', () => {
    const html = renderSection(makeSection([{
      type: 'icon_grid',
      items: [
        { icon: '🧬', title: 'NMN 함유' },
        { icon: '✅', title: 'HACCP 인증' },
        { icon: '🔬', title: '핵심 포뮬러' },
      ],
    }]), THEME);
    expect(html).toContain('🧬');
    expect(html).toContain('NMN 함유');
    expect(html).toContain('HACCP 인증');
  });

  it('layout_bar_chart — SVG img 태그 + 데이터 포함', () => {
    const html = renderSection(makeSection([{
      type: 'layout_bar_chart',
      title: 'NAD+ 수치 변화',
      groups: ['Placebo', 'NMN'],
      groupColors: ['#d1d5db', '#c45e3a'],
      items: [
        { label: '4주', values: [5, 15] },
        { label: '8주', values: [6, 40] },
      ],
      unit: 'nmol/L',
    }]), THEME);
    // SVG가 base64 img로 embed돼야 함
    expect(html).toContain('<img');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('NAD+ 수치 변화');
  });

  it('XSS 방어 — process_flow 레이블 escape', () => {
    const html = renderSection(makeSection([{
      type: 'process_flow',
      items: [{ label: '<script>alert(1)</script>' }],
    }]), THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts
```

Expected: 모든 테스트 FAIL ("Type 'progress_bar' is not assignable…" 또는 switch default hit)

- [ ] **Step 3: `types/detail-page.ts`의 LayoutBlock union 확장**

`src/types/detail-page.ts` line 162 이후의 `LayoutBlock` 타입을 다음으로 교체:

```typescript
export type LayoutBlock =
  | { type: 'badge'; text: string; color?: 'primary' | 'accent' | 'neutral' }
  | { type: 'heading'; text: string; size: 'xl' | 'lg' | 'md'; bold?: boolean; color?: 'primary' | 'text' | 'accent' }
  | { type: 'subtext'; text: string; align?: 'left' | 'center' }
  | { type: 'image'; attachedIndex: number; width?: string; align?: 'center' | 'left' | 'right'; rounded?: boolean }
  | { type: 'stat_row'; items: Array<{ label: string; value: string; unit?: string }> }
  | { type: 'bullet_list'; items: string[]; icon?: 'dot' | 'check' | 'arrow' }
  | { type: 'columns'; cols: LayoutBlock[][]; gap?: number }
  | { type: 'divider' }
  | { type: 'spacer'; height: number }
  // Phase 1 신규
  | { type: 'progress_bar'; items: Array<{ label: string; value: number; displayValue?: string; highlight?: boolean }> }
  | { type: 'process_flow'; direction?: 'horizontal' | 'vertical'; items: Array<{ label: string; sublabel?: string; highlight?: boolean }> }
  | { type: 'icon_grid'; cols?: 2 | 3; items: Array<{ icon: string; title: string; subtitle?: string }> }
  | { type: 'layout_bar_chart'; title?: string; unit?: string; groups: string[]; groupColors: string[]; items: Array<{ label: string; values: number[] }>; showLegend?: boolean }
  // Phase 2 — 타입 정의만, 렌더러 미구현
  | { type: 'radar_chart'; axes: Array<{ label: string; value: number; max?: number }>; color?: string }
  | { type: 'timeline'; items: Array<{ stage: string; icon?: string; value?: string; highlight?: boolean }> }
```

> `layout_bar_chart`로 명명한 이유: `SectionType`에 이미 `bar_chart`가 존재하고 (`BarChartContent`), 혼동 방지를 위해 DSL 내부 블록은 `layout_bar_chart`로 구분.

- [ ] **Step 4: 타입 체크 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep "detail-page.ts" | head -10
```

Expected: 오류 없음

---

## Task 2: 렌더러 확장 — progress_bar + process_flow + icon_grid (CSS 기반)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts:554-636` (renderLayoutBlock switch)

- [ ] **Step 1: renderLayoutBlock switch의 `default:` case 바로 위에 3개 case 추가**

`src/lib/detail-page/section-renderer.ts`에서 `case 'spacer':` 블록 다음, `default:` 바로 위에 삽입:

```typescript
    case 'progress_bar': {
      const items = block.items.map(item => {
        const pct = Math.min(100, Math.max(0, item.value));
        const barColor = item.highlight ? colors.accent : '#9ca3af';
        const trackColor = item.highlight ? `${colors.accent}22` : '#e5e7eb';
        return `<div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:${colors.text};margin-bottom:4px;">
            <span>${escapeHtml(item.label)}</span>
            <span style="font-weight:700;color:${barColor};">${escapeHtml(item.displayValue ?? `${pct}%`)}</span>
          </div>
          <div style="background:${trackColor};border-radius:8px;height:12px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${pct}%;border-radius:8px;transition:width 0.3s;"></div>
          </div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:16px;">${items}</div>`;
    }
    case 'process_flow': {
      const isVertical = block.direction === 'vertical';
      const items = block.items.map((item, i) => {
        const isLast = i === block.items.length - 1;
        const boxBg = item.highlight ? `${colors.accent}15` : '#f9fafb';
        const boxBorder = item.highlight ? colors.accent : '#e5e7eb';
        const textColor = item.highlight ? colors.accent : colors.text;
        const arrow = isLast ? '' : (isVertical
          ? `<div style="text-align:center;color:${colors.accent};font-size:14px;line-height:1;padding:2px 0;">↓</div>`
          : `<div style="color:${colors.accent};font-size:16px;flex-shrink:0;align-self:center;">→</div>`);
        const box = `<div style="background:${boxBg};border:1.5px solid ${boxBorder};border-radius:8px;padding:8px 12px;text-align:center;">
          <div style="font-size:12px;font-weight:700;color:${textColor};">${escapeHtml(item.label)}</div>
          ${item.sublabel ? `<div style="font-size:10px;color:${colors.textSub};margin-top:2px;">${escapeHtml(item.sublabel)}</div>` : ''}
        </div>`;
        return box + (isLast ? '' : arrow);
      });
      const flexDir = isVertical ? 'column' : 'row';
      return `<div style="display:flex;flex-direction:${flexDir};gap:6px;align-items:${isVertical ? 'stretch' : 'center'};flex-wrap:wrap;margin-bottom:16px;">${items.join('')}</div>`;
    }
    case 'icon_grid': {
      const cols = block.cols ?? 3;
      const items = block.items.map(item =>
        `<div style="text-align:center;padding:10px 6px;background:#f9fafb;border-radius:10px;">
          <div style="font-size:24px;margin-bottom:6px;">${escapeHtml(item.icon)}</div>
          <div style="font-size:11px;font-weight:700;color:${colors.text};line-height:1.3;">${escapeHtml(item.title)}</div>
          ${item.subtitle ? `<div style="font-size:10px;color:${colors.textSub};margin-top:2px;">${escapeHtml(item.subtitle)}</div>` : ''}
        </div>`
      ).join('');
      return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;margin-bottom:16px;">${items}</div>`;
    }
```

- [ ] **Step 2: `radar_chart`와 `timeline` case도 추가 (Phase 2 — 빈 렌더링)**

`icon_grid` case 바로 다음에:

```typescript
    case 'radar_chart':
    case 'timeline':
      // Phase 2에서 구현 예정
      return '';
```

- [ ] **Step 3: 테스트 실행 — progress_bar/process_flow/icon_grid 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts
```

Expected: `progress_bar`, `process_flow`, `icon_grid` 3개 PASS. `layout_bar_chart` 아직 FAIL.

---

## Task 3: 렌더러 확장 — layout_bar_chart (SVG → base64 img)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts` (renderLayoutBlock switch, `layout_bar_chart` case 추가)

- [ ] **Step 1: buildBarChartSvg 헬퍼 함수를 renderLayoutBlock 위에 추가**

파일 상단의 `function renderLayoutBlock(` 바로 위에 삽입:

```typescript
function buildBarChartSvg(block: Extract<LayoutBlock, { type: 'layout_bar_chart' }>): string {
  const W = 700, LEGEND_H = block.showLegend !== false ? 28 : 0;
  const PAD = { top: 24, right: 20, bottom: 44, left: 52 };
  const chartH = 220;
  const H = chartH + PAD.top + PAD.bottom + LEGEND_H;
  const innerW = W - PAD.left - PAD.right;
  const innerH = chartH;

  const allValues = block.items.flatMap(i => i.values);
  const maxVal = Math.max(...allValues, 1);
  const groups = block.groups;
  const colors = block.groupColors;
  const groupCount = groups.length;
  const itemCount = block.items.length;
  const groupW = innerW / itemCount;
  const barW = Math.min(24, (groupW - 8) / groupCount);

  // Y 축 눈금 (5개)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const yVal = Math.round(maxVal * t);
    const y = PAD.top + innerH - innerH * t;
    return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + innerW}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
      <text x="${PAD.left - 6}" y="${y + 4}" font-size="10" fill="#9ca3af" text-anchor="end">${yVal}</text>`;
  });

  // 막대 + x 레이블
  const bars = block.items.map((item, i) => {
    const centerX = PAD.left + i * groupW + groupW / 2;
    const groupBars = groups.map((_, gi) => {
      const val = item.values[gi] ?? 0;
      const barH = Math.max(2, (val / maxVal) * innerH);
      const x = centerX - (groupCount * barW) / 2 + gi * barW;
      const y = PAD.top + innerH - barH;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW - 2}" height="${barH.toFixed(1)}" fill="${escapeHtml(colors[gi] ?? '#6b7280')}" rx="2"/>`;
    });
    const labelY = PAD.top + innerH + 14;
    return [...groupBars, `<text x="${centerX}" y="${labelY}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeHtml(item.label)}</text>`].join('');
  });

  // Y축 단위
  const unitLabel = block.unit ? `<text x="${PAD.left - 36}" y="${PAD.top - 8}" font-size="10" fill="#9ca3af">${escapeHtml(block.unit)}</text>` : '';

  // 범례
  const legend = block.showLegend !== false ? groups.map((g, gi) => {
    const lx = PAD.left + gi * 90;
    return `<rect x="${lx}" y="${H - LEGEND_H + 6}" width="10" height="10" fill="${escapeHtml(colors[gi] ?? '#6b7280')}" rx="2"/>
      <text x="${lx + 14}" y="${H - LEGEND_H + 15}" font-size="11" fill="#6b7280">${escapeHtml(g)}</text>`;
  }).join('') : '';

  // 제목
  const title = block.title ? `<text x="${W / 2}" y="16" font-size="13" font-weight="700" fill="#1f2937" text-anchor="middle">${escapeHtml(block.title)}</text>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${title}
    ${ticks.join('')}
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + innerH}" stroke="#d1d5db" stroke-width="1.5"/>
    ${bars.join('')}
    ${unitLabel}
    ${legend}
  </svg>`;
}
```

- [ ] **Step 2: `layout_bar_chart` case를 `process_flow` case 다음에 추가**

```typescript
    case 'layout_bar_chart': {
      const svg = buildBarChartSvg(block);
      const b64 = Buffer.from(svg).toString('base64');
      const titleHtml = block.title
        ? `<div style="font-size:13px;font-weight:700;color:${colors.text};margin-bottom:10px;text-align:center;">${escapeHtml(block.title)}</div>`
        : '';
      return `<div style="margin-bottom:16px;">${titleHtml}<img src="data:image/svg+xml;base64,${b64}" alt="${escapeHtml(block.title ?? '차트')}" style="width:100%;max-width:100%;display:block;" /></div>`;
    }
```

- [ ] **Step 3: 전체 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts
```

Expected: 5개 모두 PASS

- [ ] **Step 4: 기존 렌더러 테스트 회귀 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts
```

Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/types/detail-page.ts src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/section-renderer-pro-blocks.test.ts
git commit -m "feat(renderer): LayoutBlock에 progress_bar/process_flow/icon_grid/layout_bar_chart 블록 추가"
```

---

## Task 4: `/api/ai/analyze-detail-page` — Gemini OCR 분석

**Files:**
- Create: `src/app/api/ai/analyze-detail-page/route.ts`

- [ ] **Step 1: 라우트 파일 생성**

```typescript
/**
 * POST /api/ai/analyze-detail-page
 *
 * 참고 상세페이지 스크린샷을 Gemini Vision으로 분석해서
 * 섹션 타입과 차트 데이터를 구조화된 JSON으로 추출합니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 3 };

// ─── Zod 스키마 ───────────────────────────────────────────────────────────────

const ImageInputSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});

const RequestSchema = z.object({
  images: z.array(ImageInputSchema).min(1).max(8),
  productName: z.string().max(100).default(''),
});

// Gemini가 반환하는 섹션 분석 결과
const AnalyzedSectionSchema = z.object({
  blockType: z.enum(['layout_bar_chart', 'progress_bar', 'process_flow', 'icon_grid', 'stat_row', 'text', 'unknown']),
  rawText: z.string(),
  extractedData: z.union([
    z.object({
      type: z.literal('layout_bar_chart'),
      title: z.string(),
      groups: z.array(z.string()),
      items: z.array(z.object({ label: z.string(), values: z.array(z.number()) })),
      unit: z.string().optional(),
    }),
    z.object({
      type: z.literal('progress_bar'),
      items: z.array(z.object({ label: z.string(), value: z.number(), displayValue: z.string().optional() })),
    }),
    z.object({
      type: z.literal('process_flow'),
      items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })),
    }),
    z.object({
      type: z.literal('icon_grid'),
      items: z.array(z.object({ icon: z.string(), title: z.string(), subtitle: z.string().optional() })),
    }),
    z.object({
      type: z.literal('stat_row'),
      items: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string().optional() })),
    }),
    z.object({ type: z.literal('text'), heading: z.string().optional(), body: z.string().optional() }),
    z.object({ type: z.literal('unknown'), description: z.string() }),
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  needsReview: z.boolean(),
});

export type AnalyzedSection = z.infer<typeof AnalyzedSectionSchema>;

// ─── Gemini 프롬프트 ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Korean e-commerce detail page analyzer. Analyze the provided screenshot and extract structured data.

Identify the section type:
- layout_bar_chart: vertical grouped bar chart with numeric data
- progress_bar: horizontal progress bars showing percentages or comparisons
- process_flow: sequential steps connected with arrows (공정 흐름도)
- icon_grid: grid of icons with titles (아이콘 그리드)
- stat_row: large numeric statistics with labels
- text: heading/body text sections
- unknown: cannot determine

For charts, extract ALL visible numbers and labels accurately.
Confidence: high = all data clearly readable, medium = some ambiguity, low = data unreliable.
needsReview: true if confidence is medium or low.

Return ONLY valid JSON matching this schema — no explanation:
{
  "blockType": "...",
  "rawText": "all text visible in image",
  "extractedData": { "type": "same as blockType", ... },
  "confidence": "high|medium|low",
  "needsReview": true|false
}`;

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'analyze-detail-page'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' }, { status: 400 });
  }

  const { images, productName } = parsed.data;

  try {
    const ai = getGeminiGenAI();

    // 이미지별 순차 처리 (Gemini rate limit 대응)
    const results: AnalyzedSection[] = [];
    for (const img of images) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT + (productName ? `\nProduct: ${productName}` : '') },
              { inlineData: { mimeType: img.mimeType, data: img.base64 } },
            ],
          }],
        });

        const text = response.candidates?.[0]?.content?.parts
          ?.filter((p: { text?: string }) => p.text)
          ?.map((p: { text?: string }) => p.text)
          ?.join('') ?? '';

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          results.push({ blockType: 'unknown', rawText: text, extractedData: { type: 'unknown', description: 'JSON 파싱 실패' }, confidence: 'low', needsReview: true });
          continue;
        }

        const raw = JSON.parse(jsonMatch[0]) as unknown;
        const validated = AnalyzedSectionSchema.safeParse(raw);
        if (validated.success) {
          results.push(validated.data);
        } else {
          results.push({ blockType: 'unknown', rawText: text, extractedData: { type: 'unknown', description: 'schema 불일치' }, confidence: 'low', needsReview: true });
        }
      } catch {
        results.push({ blockType: 'unknown', rawText: '', extractedData: { type: 'unknown', description: '분석 오류' }, confidence: 'low', needsReview: true });
      }
    }

    const reviewRequired = results.some(r => r.needsReview);
    return NextResponse.json({ success: true, sections: results, reviewRequired });
  } catch (error) {
    console.error('[analyze-detail-page] 오류:', error);
    return NextResponse.json({ success: false, error: '분석 실패' }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "analyze-detail-page" | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/ai/analyze-detail-page/route.ts
git commit -m "feat(api): analyze-detail-page — Gemini OCR 스크린샷 분석 엔드포인트"
```

---

## Task 5: `/api/image/flux-lifestyle` — FLUX Kontext Pro

**Files:**
- Create: `src/app/api/image/flux-lifestyle/route.ts`

> Replicate 폴링 패턴은 기존 `src/lib/ai/remove-background.ts`와 동일하게 구현.

- [ ] **Step 1: 라우트 파일 생성**

```typescript
/**
 * POST /api/image/flux-lifestyle
 *
 * 제품 누끼 이미지 + 씬 힌트 → FLUX Kontext Pro → 라이프스타일 씬 이미지
 * 실패 시 원본 이미지 URL을 fallback으로 반환합니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export const maxDuration = 120;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 2 };
const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const FLUX_KONTEXT_MODEL = 'black-forest-labs/flux-kontext-pro';
const POLLING_INTERVAL_MS = 2000;
const POLLING_TIMEOUT_MS = 90_000;
// SSRF 방어: Supabase Storage URL만 허용
const SUPABASE_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;
const BUCKET = 'product-images';

const RequestSchema = z.object({
  productImageUrl: z.string().url(),
  promptHint: z.string().max(300),
  sectionContext: z.string().max(100).optional(),
});

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed';
  output?: string | string[];
  error?: string;
};

async function pollPrediction(id: string, token: string): Promise<string | null> {
  const deadline = Date.now() + POLLING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, POLLING_INTERVAL_MS));
    const res = await fetch(`${REPLICATE_API_BASE}/predictions/${id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) return null;
    const pred = await res.json() as ReplicatePrediction;
    if (pred.status === 'succeeded') {
      const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return output ?? null;
    }
    if (pred.status === 'failed') return null;
  }
  return null;
}

async function uploadToSupabase(imageUrl: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const path = `ai-detail/${Date.now()}-flux-lifestyle.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'flux-lifestyle'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' }, { status: 400 });
  }

  const { productImageUrl, promptHint, sectionContext } = parsed.data;

  // SSRF 방어
  if (!SUPABASE_PATTERN.test(productImageUrl)) {
    return NextResponse.json({ success: false, error: '허용되지 않는 이미지 URL' }, { status: 400 });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    // Replicate 미설정 시 원본 fallback
    return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
  }

  const prompt = [
    `Product photography: ${promptHint}`,
    sectionContext ? `Context: ${sectionContext}` : '',
    'Clean background, no people, no text overlay, premium studio lighting, Korean e-commerce style',
  ].filter(Boolean).join('. ');

  try {
    const startRes = await fetch(`${REPLICATE_API_BASE}/models/${FLUX_KONTEXT_MODEL}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input: { prompt, input_image: productImageUrl, output_format: 'jpg', output_quality: 90 } }),
    });

    if (!startRes.ok) {
      return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
    }

    const pred = await startRes.json() as ReplicatePrediction;
    let outputUrl: string | null = null;

    if (pred.status === 'succeeded') {
      outputUrl = Array.isArray(pred.output) ? (pred.output[0] ?? null) : (pred.output ?? null);
    } else if (pred.status !== 'failed') {
      outputUrl = await pollPrediction(pred.id, token);
    }

    if (!outputUrl) {
      return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
    }

    // Supabase Storage에 저장
    const savedUrl = await uploadToSupabase(outputUrl);
    return NextResponse.json({ success: true, url: savedUrl ?? outputUrl, fallback: false });
  } catch {
    return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
  }
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "flux-lifestyle" | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/image/flux-lifestyle/route.ts
git commit -m "feat(api): flux-lifestyle — FLUX Kontext Pro 라이프스타일 이미지 생성 엔드포인트"
```

---

## Task 6: `/api/ai/generate-pro-layout` — Claude 전체 페이지 DSL + SSE

**Files:**
- Create: `src/app/api/ai/generate-pro-layout/route.ts`

- [ ] **Step 1: 라우트 파일 생성**

```typescript
/**
 * POST /api/ai/generate-pro-layout
 *
 * Gemini OCR로 추출한 데이터 + 상품 정보를 Claude에게 전달해
 * 전체 페이지 DSL을 생성합니다. SSE로 진행률을 스트리밍합니다.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export const maxDuration = 180;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 2 };

const RequestSchema = z.object({
  productInfo: z.object({
    name: z.string().min(1).max(200),
    points: z.array(z.string().max(200)).max(10).default([]),
    category: z.string().max(100).default(''),
  }),
  analyzedSections: z.array(z.object({
    blockType: z.string(),
    rawText: z.string(),
    extractedData: z.unknown(),
    confidence: z.string(),
    needsReview: z.boolean(),
  })).max(8).default([]),
  productImageCount: z.number().min(0).max(4).default(0),
});

// Claude 시스템 프롬프트
const CLAUDE_SYSTEM = `You are a Korean e-commerce product detail page designer.
Generate a complete page layout as a JSON array of sections for mobile (390px width).

Each section is a ClaudeLayoutContent object:
{
  "type": "claude_layout",
  "title": "section title",
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide",
  "imageSlots": [{"slotType": "flux_lifestyle"|"product_nukki", "promptHint": "..."}]
}

Available block types in blocks[]:
- badge: { type, text, color?: 'primary'|'accent'|'neutral' }
- heading: { type, text, size: 'xl'|'lg'|'md', bold?, color? }
- subtext: { type, text, align?: 'left'|'center' }
- image: { type, attachedIndex: 0..N }
- stat_row: { type, items: [{label, value, unit?}] }
- bullet_list: { type, items: string[], icon?: 'dot'|'check'|'arrow' }
- columns: { type, cols: LayoutBlock[][], gap? }
- divider: { type }
- spacer: { type, height: number }
- progress_bar: { type, items: [{label, value(0-100), displayValue?, highlight?}] }
- process_flow: { type, direction?: 'horizontal'|'vertical', items: [{label, sublabel?, highlight?}] }
- icon_grid: { type, cols?: 2|3, items: [{icon, title, subtitle?}] }
- layout_bar_chart: { type, title?, unit?, groups: string[], groupColors: string[], items: [{label, values: number[]}], showLegend? }

DESIGN RULES:
1. Use extracted chart data EXACTLY as provided — do not modify numbers
2. dark/primary bgStyle → heading color should be 'text' (auto-inverts to white)
3. stat_row renders at 44px bold — use for big impact numbers
4. heading 'xl' = 38px — always for section headline
5. imageSlots[0] attachedIndex maps to that section's image
6. For lifestyle images use slotType "flux_lifestyle" with descriptive promptHint

Return ONLY valid JSON array — no explanation, no code fences:
[section1, section2, ...]`;

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-pro-layout'), RATE_LIMIT);
  if (!rl.allowed) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseEvent('error', { message: '요청이 너무 많습니다.' })));
        controller.close();
      },
    });
    return new Response(stream, { status: 429, headers: { 'Content-Type': 'text/event-stream' } });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseEvent('error', { message: parsed.error.issues[0]?.message ?? '잘못된 요청' })));
        controller.close();
      },
    });
    return new Response(stream, { status: 400, headers: { 'Content-Type': 'text/event-stream' } });
  }

  const { productInfo, analyzedSections, productImageCount } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(type, data)));
      };

      try {
        send('progress', { step: 'generating', message: 'Claude가 레이아웃을 설계하는 중...' });

        const userPrompt = [
          `Product: "${productInfo.name}"`,
          productInfo.category ? `Category: ${productInfo.category}` : '',
          productInfo.points.length > 0 ? `Key points: ${productInfo.points.map(p => `"${p}"`).join(', ')}` : '',
          productImageCount > 0 ? `Product images available: ${productImageCount}` : '',
          analyzedSections.length > 0
            ? `Extracted data from reference pages:\n${analyzedSections.map((s, i) => `Section ${i + 1} (${s.blockType}): ${JSON.stringify(s.extractedData)}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n');

        const { getAnthropicClient } = await import('@/lib/ai/claude');
        const client = getAnthropicClient();
        const res = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: CLAUDE_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });

        const text = res.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('');

        send('progress', { step: 'rendering', message: '레이아웃을 렌더링하는 중...' });

        // JSON 배열 추출
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
          send('error', { message: 'Claude 응답 파싱 실패' });
          controller.close();
          return;
        }

        const sections = JSON.parse(match[0]) as unknown[];
        send('complete', { sections });
      } catch (error) {
        console.error('[generate-pro-layout] 오류:', error);
        send('error', { message: '레이아웃 생성 실패' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "generate-pro-layout" | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/ai/generate-pro-layout/route.ts
git commit -m "feat(api): generate-pro-layout — Claude 전체 페이지 DSL 생성 SSE 엔드포인트"
```

---

## Task 7: PRO 모드 페이지 — 4단계 UI

**Files:**
- Create: `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: 페이지 파일 생성**

```tsx
'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AnalyzedSection } from '@/app/api/ai/analyze-detail-page/route';

type ScreenState = 'upload' | 'review' | 'generating' | 'result';

interface ProgressEvent {
  step: string;
  message: string;
  current?: number;
  total?: number;
}

const BRAND_PURPLE = '#6366f1';

export default function DetailMakerProPage() {
  const params = useParams();
  const router = useRouter();
  const listingId = params.id as string;

  const [screen, setScreen] = useState<ScreenState>('upload');
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [productImages, setProductImages] = useState<File[]>([]);
  const [analyzedSections, setAnalyzedSections] = useState<AnalyzedSection[]>([]);
  const [editedSections, setEditedSections] = useState<AnalyzedSection[]>([]);
  const [productName, setProductName] = useState('');
  const [productPoints, setProductPoints] = useState('');
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [generatedSections, setGeneratedSections] = useState<unknown[]>([]);
  const [fluxResults, setFluxResults] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState<number | null>(null);

  const refFileRef = useRef<HTMLInputElement>(null);
  const prodFileRef = useRef<HTMLInputElement>(null);

  // Step 1 → Step 1.5: OCR 분석
  const handleAnalyze = useCallback(async () => {
    if (referenceImages.length === 0) { setError('참고 이미지를 1장 이상 업로드해주세요.'); return; }
    setError(null);
    setScreen('review');

    const imageData = await Promise.all(referenceImages.map(async file => {
      const base64 = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve((e.target?.result as string).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      return { base64, mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' };
    }));

    try {
      const res = await fetch('/api/ai/analyze-detail-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: imageData, productName }),
      });
      const data = await res.json() as { success: boolean; sections?: AnalyzedSection[]; error?: string };
      if (!data.success || !data.sections) { setError(data.error ?? '분석 실패'); return; }
      setAnalyzedSections(data.sections);
      setEditedSections(data.sections);
    } catch {
      setError('분석 중 오류가 발생했습니다.');
    }
  }, [referenceImages, productName]);

  // Step 1.5 → Step 2: DSL 생성 (SSE)
  const handleGenerate = useCallback(async () => {
    setScreen('generating');
    setError(null);
    setProgress({ step: 'start', message: '시작 중...' });

    try {
      const res = await fetch('/api/ai/generate-pro-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productInfo: {
            name: productName,
            points: productPoints.split('\n').map(p => p.trim()).filter(Boolean),
            category: '',
          },
          analyzedSections: editedSections,
          productImageCount: productImages.length,
        }),
      });

      if (!res.body) { setError('스트리밍 응답 없음'); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const chunk of lines) {
          const eventMatch = chunk.match(/^event: (\w+)/m);
          const dataMatch = chunk.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;
          const eventType = eventMatch[1];
          const eventData = JSON.parse(dataMatch[1]) as Record<string, unknown>;
          if (eventType === 'progress') {
            setProgress(eventData as ProgressEvent);
          } else if (eventType === 'complete') {
            setGeneratedSections(eventData.sections as unknown[]);
            setScreen('result');
          } else if (eventType === 'error') {
            setError((eventData.message as string) ?? '오류 발생');
            setScreen('review');
          }
        }
      }
    } catch {
      setError('생성 중 오류가 발생했습니다.');
      setScreen('review');
    }
  }, [productName, productPoints, editedSections, productImages.length]);

  // FLUX 재생성
  const handleFluxRegenerate = useCallback(async (sectionIndex: number, productImageUrl: string, promptHint: string) => {
    setIsRegenerating(sectionIndex);
    try {
      const res = await fetch('/api/image/flux-lifestyle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productImageUrl, promptHint }),
      });
      const data = await res.json() as { success: boolean; url?: string };
      if (data.success && data.url) {
        setFluxResults(prev => ({ ...prev, [sectionIndex]: data.url! }));
      }
    } catch {
      setError('이미지 재생성 실패');
    } finally {
      setIsRegenerating(null);
    }
  }, []);

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0f0f17',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '24px 20px',
    maxWidth: '600px',
    margin: '0 auto',
  };

  // ── Upload Screen ────────────────────────────────────────
  if (screen === 'upload') return (
    <div style={containerStyle}>
      <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', marginBottom: '20px', fontSize: '14px' }}>← 돌아가기</button>
      <h1 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '6px' }}>PRO 상세페이지 만들기</h1>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '24px' }}>참고 상세페이지 스크린샷을 올리면 AI가 분석해서 전문 페이지를 자동 생성합니다.</p>

      {error && <div style={{ background: '#2a1515', border: '1px solid #ef4444', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '13px', color: '#fca5a5' }}>{error}</div>}

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#a0a0b0', display: 'block', marginBottom: '8px' }}>상품명</label>
        <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="예: 덴프스 엔엠엔 NMN 250" style={{ width: '100%', padding: '10px 12px', background: '#1e1e2e', border: '1px solid #374151', borderRadius: '8px', color: '#e2e8f0', fontSize: '14px', boxSizing: 'border-box' }} />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#a0a0b0', display: 'block', marginBottom: '8px' }}>핵심 판매 포인트 (줄 구분)</label>
        <textarea value={productPoints} onChange={e => setProductPoints(e.target.value)} rows={4} placeholder={'국내 최대 NMN 250mg 함유\n건조효모 유래 NMN\nHACCP 인증'} style={{ width: '100%', padding: '10px 12px', background: '#1e1e2e', border: '1px solid #374151', borderRadius: '8px', color: '#e2e8f0', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }} />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#a0a0b0', display: 'block', marginBottom: '8px' }}>참고 상세페이지 스크린샷 (최대 8장)</label>
        <input ref={refFileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => setReferenceImages(Array.from(e.target.files ?? []).slice(0, 8))} />
        <button onClick={() => refFileRef.current?.click()} style={{ width: '100%', padding: '12px', background: '#1e1e2e', border: '2px dashed #374151', borderRadius: '8px', color: '#6b7280', cursor: 'pointer', fontSize: '13px' }}>
          {referenceImages.length > 0 ? `${referenceImages.length}장 선택됨` : '클릭해서 이미지 선택'}
        </button>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#a0a0b0', display: 'block', marginBottom: '8px' }}>제품 이미지 (누끼 — FLUX 생성용, 선택)</label>
        <input ref={prodFileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => setProductImages(Array.from(e.target.files ?? []).slice(0, 4))} />
        <button onClick={() => prodFileRef.current?.click()} style={{ width: '100%', padding: '12px', background: '#1e1e2e', border: '2px dashed #374151', borderRadius: '8px', color: '#6b7280', cursor: 'pointer', fontSize: '13px' }}>
          {productImages.length > 0 ? `${productImages.length}장 선택됨` : '클릭해서 제품 이미지 선택 (선택사항)'}
        </button>
      </div>

      <button onClick={handleAnalyze} disabled={!productName || referenceImages.length === 0} style={{ width: '100%', padding: '14px', background: BRAND_PURPLE, border: 'none', borderRadius: '10px', color: '#fff', fontSize: '15px', fontWeight: 700, cursor: 'pointer', opacity: (!productName || referenceImages.length === 0) ? 0.5 : 1 }}>
        분석 시작 →
      </button>
    </div>
  );

  // ── Review Screen ────────────────────────────────────────
  if (screen === 'review') return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '4px' }}>OCR 결과 확인</h1>
      <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '20px' }}>추출된 데이터를 확인하고 수정 후 생성하세요. 임상 수치는 반드시 검토해주세요.</p>

      {error && <div style={{ background: '#2a1515', border: '1px solid #ef4444', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '13px', color: '#fca5a5' }}>{error}</div>}

      {analyzedSections.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>분석 중...</div>
      )}

      {editedSections.map((section, i) => (
        <div key={i} style={{ background: '#1e1e2e', borderRadius: '8px', padding: '12px', marginBottom: '12px', border: section.needsReview ? '1px solid #f59e0b' : '1px solid #374151' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: BRAND_PURPLE }}>{section.blockType}</span>
            {section.needsReview && <span style={{ fontSize: '10px', background: '#f59e0b22', color: '#f59e0b', padding: '2px 6px', borderRadius: '4px' }}>검토 필요</span>}
          </div>
          <textarea
            value={JSON.stringify(section.extractedData, null, 2)}
            onChange={e => {
              try {
                const parsed = JSON.parse(e.target.value) as unknown;
                setEditedSections(prev => prev.map((s, j) => j === i ? { ...s, extractedData: parsed } : s));
              } catch { /* invalid JSON */ }
            }}
            rows={6}
            style={{ width: '100%', background: '#0f0f17', border: '1px solid #374151', borderRadius: '6px', color: '#a0a0b0', fontSize: '11px', fontFamily: 'monospace', padding: '8px', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button onClick={() => setScreen('upload')} style={{ flex: 1, padding: '12px', background: '#1e1e2e', border: '1px solid #374151', borderRadius: '8px', color: '#e2e8f0', cursor: 'pointer', fontSize: '14px' }}>← 다시 업로드</button>
        <button onClick={handleGenerate} style={{ flex: 2, padding: '12px', background: BRAND_PURPLE, border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>생성 시작 →</button>
      </div>
    </div>
  );

  // ── Generating Screen ────────────────────────────────────
  if (screen === 'generating') return (
    <div style={{ ...containerStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ fontSize: '32px', marginBottom: '20px', animation: 'spin 2s linear infinite' }}>⚡</div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>생성 중...</h2>
      {progress && <p style={{ fontSize: '13px', color: '#6b7280', textAlign: 'center' }}>{progress.message}</p>}
      {progress?.current && progress?.total && (
        <div style={{ width: '200px', background: '#1e1e2e', borderRadius: '8px', height: '6px', marginTop: '12px', overflow: 'hidden' }}>
          <div style={{ background: BRAND_PURPLE, height: '100%', width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.3s' }} />
        </div>
      )}
    </div>
  );

  // ── Result Screen ────────────────────────────────────────
  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '4px' }}>생성 완료</h1>
      <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '20px' }}>{generatedSections.length}개 섹션이 생성됐습니다.</p>

      {generatedSections.map((section, i) => {
        const s = section as { title?: string; imageSlots?: Array<{ slotType: string; promptHint?: string }> };
        return (
          <div key={i} style={{ background: '#1e1e2e', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '6px' }}>{s.title ?? `섹션 ${i + 1}`}</div>
            {fluxResults[i] && <img src={fluxResults[i]} alt="" style={{ width: '100%', borderRadius: '6px', marginBottom: '8px' }} />}
            {s.imageSlots?.some(slot => slot.slotType === 'flux_lifestyle') && (
              <button
                onClick={() => handleFluxRegenerate(i, productImages[0] ? URL.createObjectURL(productImages[0]) : '', s.imageSlots?.[0]?.promptHint ?? '')}
                disabled={isRegenerating === i}
                style={{ padding: '6px 12px', background: '#2d2d3f', border: '1px solid #374151', borderRadius: '6px', color: '#a0a0b0', cursor: 'pointer', fontSize: '12px' }}
              >
                {isRegenerating === i ? '재생성 중...' : '🔄 FLUX 이미지 재생성'}
              </button>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button onClick={() => { setScreen('upload'); setGeneratedSections([]); setFluxResults({}); }} style={{ flex: 1, padding: '12px', background: '#1e1e2e', border: '1px solid #374151', borderRadius: '8px', color: '#e2e8f0', cursor: 'pointer', fontSize: '14px' }}>처음부터</button>
        <button onClick={() => router.push(`/listing/${listingId}/detail-maker`)} style={{ flex: 2, padding: '12px', background: BRAND_PURPLE, border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>에디터에서 편집 →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "detail-maker-pro" | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 기존 detail-maker 페이지에 PRO 모드 진입 버튼 확인**

```bash
grep -rn "PRO\|detail-maker-pro" /Users/seungminlee/Desktop/projects/smart_seller_studio/src/app/listing/ | head -5
```

PRO 버튼이 없으면 기존 detail-maker 진입 페이지 상단에 추가. 파일 경로를 먼저 확인:

```bash
find /Users/seungminlee/Desktop/projects/smart_seller_studio/src/app/listing -name "page.tsx" | head -10
```

- [ ] **Step 4: 커밋**

```bash
git add src/app/listing/\[id\]/detail-maker-pro/page.tsx
git commit -m "feat(ui): detail-maker-pro 페이지 — 4단계 PRO 상세페이지 생성 UI"
```

---

## Task 8: PRO 모드 진입 버튼 추가

**Files:**
- Modify: 기존 detail-maker 진입 페이지 (Task 7 Step 3에서 확인된 경로)

- [ ] **Step 1: detail-maker 진입점 파일 확인**

```bash
find /Users/seungminlee/Desktop/projects/smart_seller_studio/src -name "*.tsx" | xargs grep -l "detail-maker" | grep -v "node_modules" | grep -v ".test." | head -10
```

- [ ] **Step 2: 해당 파일에서 적절한 위치에 PRO 버튼 추가**

기존 "상세페이지 만들기" 버튼 근처에 PRO 버튼 추가. 예시 (실제 파일 구조에 맞게 조정):

```tsx
import Link from 'next/link';

// 기존 버튼 옆이나 아래에 추가:
<Link
  href={`/listing/${listingId}/detail-maker-pro`}
  style={{
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '8px 14px', background: '#6366f1', borderRadius: '8px',
    color: '#fff', fontSize: '13px', fontWeight: 700, textDecoration: 'none',
  }}
>
  ⚡ PRO 모드
</Link>
```

- [ ] **Step 3: 전체 TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: 오류 없음

- [ ] **Step 4: 전체 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/
```

Expected: 전부 PASS

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "feat: PRO 상세페이지 파이프라인 Phase 1 완성

- LayoutBlock: progress_bar/process_flow/icon_grid/layout_bar_chart 블록 추가
- section-renderer: 4개 블록 SVG+CSS 렌더링 (base64 img embed)
- API: analyze-detail-page (Gemini OCR), generate-pro-layout (Claude+SSE), flux-lifestyle (FLUX Kontext)
- UI: detail-maker-pro 4단계 페이지 (upload→review→generating→result)"
```
