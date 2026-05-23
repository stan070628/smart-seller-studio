# AI 편집 텍스트·표 파이프라인 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AiEditModal의 "텍스트·표" 버튼 3개를 OCR 추출 → 새 클린 이미지 생성 방식으로 교체해 깨지는 이미지 편집 문제를 해결한다.

**Architecture:** Claude Vision이 이미지에서 표/텍스트 구조를 JSON으로 추출하고, Claude Haiku가 사용자 지시를 적용한 뒤, SVG를 resvg-js로 PNG 렌더링해 미니멀 클린 스타일 이미지를 생성한다. 기존 bbox 마스킹 방식은 완전히 제거된다.

**Tech Stack:** Claude Sonnet (Vision OCR), Claude Haiku (지시 적용), Sharp, @resvg/resvg-js, Pretendard 폰트, Vitest

---

## 파일 맵

| 파일 | 변경 종류 | 역할 |
|------|----------|------|
| `src/lib/ai/image-text-edit.ts` | 수정 | 기존 3개 함수 교체, 새 타입/함수 정의 |
| `src/app/api/ai/edit-image-text/route.ts` | 수정 | 새 파이프라인 함수 호출로 교체 |
| `src/components/listing/AiEditModal.tsx` | 수정 | 버튼 기본 프롬프트 문자열 수정 |
| `src/__tests__/lib/ai/image-text-edit.test.ts` | 신규 | 새 함수 단위 테스트 |
| `src/__tests__/components/ai-edit-modal-text-group.test.tsx` | 수정 | 프롬프트 변경에 따른 테스트 기댓값 수정 |

---

## Task 1: 새 타입 정의 + extractStructuredContent 구현

**Files:**
- Modify: `src/lib/ai/image-text-edit.ts`
- Create: `src/__tests__/lib/ai/image-text-edit.test.ts`

- [ ] **Step 1: 테스트 파일 생성 (실패 테스트 먼저)**

`src/__tests__/lib/ai/image-text-edit.test.ts` 를 새로 만든다:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn(),
}));
vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: vi.fn(),
}));
vi.mock('@/lib/ai/resilience', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock('@resvg/resvg-js', () => ({
  Resvg: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockReturnValue({
      asPng: vi.fn().mockReturnValue(Buffer.from('fake-png')),
    }),
  })),
}));
vi.mock('sharp', () => {
  const mockSharp = vi.fn().mockReturnValue({
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg')),
  });
  return { default: mockSharp };
});
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

import { getAnthropicClient } from '@/lib/ai/claude';
import { callClaude } from '@/lib/ai/claude-cli';
import {
  extractStructuredContent,
  applyUserInstruction,
  renderAsImage,
} from '@/lib/ai/image-text-edit';

describe('extractStructuredContent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('표 구조를 올바르게 파싱한다', async () => {
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              type: 'table',
              title: 'SIZE CHART',
              table: {
                headers: ['SIZE', '가슴둘레'],
                rows: [['85', '87.5–92.5cm'], ['90', '92.5–97.5cm']],
              },
            }),
          }],
        }),
      },
    } as any);

    const result = await extractStructuredContent('base64data', 'image/jpeg');

    expect(result.type).toBe('table');
    expect(result.title).toBe('SIZE CHART');
    expect(result.table?.headers).toEqual(['SIZE', '가슴둘레']);
    expect(result.table?.rows).toHaveLength(2);
  });

  it('텍스트 구조를 올바르게 파싱한다', async () => {
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              type: 'text',
              title: '제품 특징',
              textBlocks: [{ text: '고품질 소재', bold: true }],
            }),
          }],
        }),
      },
    } as any);

    const result = await extractStructuredContent('base64data', 'image/png');

    expect(result.type).toBe('text');
    expect(result.textBlocks).toHaveLength(1);
    expect(result.textBlocks![0].bold).toBe(true);
  });

  it('table 타입인데 table 필드 없으면 text로 폴백한다', async () => {
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify({ type: 'table', title: 'TEST' }) }],
        }),
      },
    } as any);

    const result = await extractStructuredContent('base64data', 'image/jpeg');

    expect(result.type).toBe('text');
  });

  it('JSON을 찾을 수 없으면 에러를 던진다', async () => {
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '죄송합니다, 인식이 어렵습니다.' }],
        }),
      },
    } as any);

    await expect(extractStructuredContent('base64data', 'image/jpeg'))
      .rejects.toThrow('OCR 응답에서 JSON을 찾을 수 없습니다.');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run src/__tests__/lib/ai/image-text-edit.test.ts 2>&1 | tail -20
```

예상 출력: `FAIL` (모듈을 아직 찾을 수 없음)

- [ ] **Step 3: image-text-edit.ts 기존 내용 전체 교체**

`src/lib/ai/image-text-edit.ts` 전체를 아래로 교체한다 (기존 TextRegion, EditOperation, extractTextRegions, parseEditIntent, composeTextOnImage 모두 제거):

```typescript
/**
 * 이미지 텍스트 합성 파이프라인 (v2)
 *
 * OCR로 구조화된 표/텍스트 데이터를 추출하고,
 * 사용자 지시를 적용한 뒤, SVG + resvg-js로 클린 이미지를 생성한다.
 * 기존 bbox 마스킹 방식 완전 제거.
 */

import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { callClaude } from '@/lib/ai/claude-cli';
import { withRetry } from '@/lib/ai/resilience';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

export interface StructuredContent {
  type: 'table' | 'text';
  title?: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  textBlocks?: Array<{
    text: string;
    bold: boolean;
  }>;
}

// ─────────────────────────────────────────
// OCR — extractStructuredContent
// ─────────────────────────────────────────

const StructuredContentSchema = z.object({
  type: z.enum(['table', 'text']),
  title: z.string().optional(),
  table: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }).optional(),
  textBlocks: z.array(z.object({
    text: z.string(),
    bold: z.boolean(),
  })).optional(),
});

const EXTRACT_SYSTEM_PROMPT = `당신은 이미지의 텍스트 구조를 정확히 추출하는 OCR 분석가입니다.

규칙:
- type: 격자선/행열 구조가 명확하면 "table", 그 외 "text"
- title: 이미지 최상단 제목 텍스트 (없으면 생략)
- table.headers: 표 헤더 행의 각 셀 텍스트 배열
- table.rows: 데이터 행들 (헤더 제외), 각 행은 셀 텍스트 배열
- textBlocks: 텍스트 타입일 때 각 줄/단락, bold 여부 포함
- 응답은 JSON만. 코드블록·설명 텍스트 금지.

출력 스키마 (표):
{"type":"table","title":"SIZE CHART","table":{"headers":["SIZE","가슴둘레"],"rows":[["85","87.5-92.5cm"]]}}

출력 스키마 (텍스트):
{"type":"text","title":"제품 특징","textBlocks":[{"text":"고품질 소재 사용","bold":true}]}`;

export async function extractStructuredContent(
  imageBase64: string,
  mimeType: AllowedMimeType,
): Promise<StructuredContent> {
  const client = getAnthropicClient();
  const response = await withRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
              { type: 'text', text: '이 이미지의 텍스트 구조를 JSON으로 추출하세요.' },
            ],
          },
        ],
      }),
    { label: 'Claude extractStructuredContent' },
  );

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OCR 응답에서 JSON을 찾을 수 없습니다.');

  const parsed = StructuredContentSchema.parse(JSON.parse(match[0]));

  if (parsed.type === 'table' && !parsed.table) {
    return { type: 'text', title: parsed.title, textBlocks: [] };
  }

  return parsed;
}

// ─────────────────────────────────────────
// 지시 적용 — applyUserInstruction
// ─────────────────────────────────────────

const APPLY_SYSTEM_PROMPT = `당신은 한국 이커머스 상세페이지 텍스트 편집 어시스턴트입니다.
구조화된 텍스트 데이터와 사용자 지시를 받아 수정된 데이터를 반환하세요.

규칙:
- 사용자가 명시적으로 지시한 내용만 수정하세요.
- "자연스러운 한국어로 교정" 지시 → 어색한 표현만 수정, 데이터 구조 유지
- "명확하게 정리" 지시 → 데이터 그대로 반환 (렌더링이 숫자 자동 강조)
- 응답은 JSON만. 코드블록·설명 금지.
- 입력과 동일한 JSON 스키마로 반환.`;

export async function applyUserInstruction(
  content: StructuredContent,
  instruction: string,
): Promise<StructuredContent> {
  const userPrompt = [
    '[현재 데이터]',
    JSON.stringify(content, null, 2),
    '',
    '[사용자 지시]',
    instruction,
    '',
    '지시에 따라 수정된 데이터를 JSON으로 반환하세요.',
  ].join('\n');

  const raw = await withRetry(
    () => callClaude(APPLY_SYSTEM_PROMPT, userPrompt, 'haiku', 1024),
    { label: 'Claude applyUserInstruction' },
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('지시 적용 응답에서 JSON을 찾을 수 없습니다.');

  return StructuredContentSchema.parse(JSON.parse(match[0]));
}

// ─────────────────────────────────────────
// 렌더링 — renderAsImage
// ─────────────────────────────────────────

const FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'PretendardVariable.ttf');

const OUTER_PADDING = 24;
const TITLE_HEIGHT = 48;
const HEADER_ROW_HEIGHT = 36;
const ROW_HEIGHT = 36;
const TEXT_LINE_HEIGHT = 28;
const CELL_PADDING_H = 12;
const FONT_SIZE = 13;

const C = {
  TITLE_BG: '#111827',
  TITLE_TEXT: '#ffffff',
  HEADER_BG: '#f9fafb',
  HEADER_TEXT: '#374151',
  ROW_ODD: '#ffffff',
  ROW_EVEN: '#f9fafb',
  CELL: '#1f2937',
  CELL_NUM: '#111827',
  BORDER: '#e5e7eb',
  PAGE_BG: '#ffffff',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isNumeric(text: string): boolean {
  return /^[\d\s\-–.×,~/]+[a-zA-Z%]*$/.test(text.trim());
}

function calcColWidths(headers: string[], rows: string[][], totalW: number): number[] {
  const charPx = 8;
  const maxes = headers.map((h, i) => {
    const hw = h.length * charPx + CELL_PADDING_H * 2;
    const cw = Math.max(...rows.map((r) => (r[i]?.length ?? 0) * charPx + CELL_PADDING_H * 2));
    return Math.max(hw, cw, 60);
  });
  const sum = maxes.reduce((a, b) => a + b, 0);
  if (sum <= totalW) {
    const extra = totalW - maxes.slice(0, -1).reduce((a, b) => a + b, 0);
    return [...maxes.slice(0, -1), Math.max(extra, maxes[maxes.length - 1])];
  }
  return maxes.map((w) => Math.round((w * totalW) / sum));
}

function buildSvg(content: StructuredContent, width: number): string {
  const contentW = width - OUTER_PADDING * 2;

  if (content.type === 'table' && content.table) {
    const { headers, rows } = content.table;
    const colWidths = calcColWidths(headers, rows, contentW);
    const tableW = colWidths.reduce((a, b) => a + b, 0);
    const titleH = content.title ? TITLE_HEIGHT : 0;
    const totalH = OUTER_PADDING + titleH + HEADER_ROW_HEIGHT + rows.length * ROW_HEIGHT + OUTER_PADDING;

    let y = OUTER_PADDING;
    let inner = `<rect width="${width}" height="${totalH}" fill="${C.PAGE_BG}"/>`;

    if (content.title) {
      inner += `<rect x="${OUTER_PADDING}" y="${y}" width="${tableW}" height="${TITLE_HEIGHT}" fill="${C.TITLE_BG}"/>`;
      inner += `<text x="${OUTER_PADDING + tableW / 2}" y="${y + TITLE_HEIGHT / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Pretendard" font-size="14" font-weight="700" fill="${C.TITLE_TEXT}" letter-spacing="2">${escapeXml(content.title)}</text>`;
      y += TITLE_HEIGHT;
    }

    inner += `<rect x="${OUTER_PADDING}" y="${y}" width="${tableW}" height="${HEADER_ROW_HEIGHT}" fill="${C.HEADER_BG}"/>`;
    let x = OUTER_PADDING;
    for (const [i, h] of headers.entries()) {
      inner += `<text x="${x + CELL_PADDING_H}" y="${y + HEADER_ROW_HEIGHT / 2}" dominant-baseline="middle" font-family="Pretendard" font-size="${FONT_SIZE}" font-weight="700" fill="${C.HEADER_TEXT}">${escapeXml(h)}</text>`;
      x += colWidths[i];
    }
    inner += `<line x1="${OUTER_PADDING}" y1="${y + HEADER_ROW_HEIGHT}" x2="${OUTER_PADDING + tableW}" y2="${y + HEADER_ROW_HEIGHT}" stroke="${C.BORDER}" stroke-width="1"/>`;
    y += HEADER_ROW_HEIGHT;

    for (const [ri, row] of rows.entries()) {
      const bg = ri % 2 === 0 ? C.ROW_ODD : C.ROW_EVEN;
      inner += `<rect x="${OUTER_PADDING}" y="${y}" width="${tableW}" height="${ROW_HEIGHT}" fill="${bg}"/>`;
      let rx = OUTER_PADDING;
      for (const [ci, cell] of row.entries()) {
        const num = isNumeric(cell);
        inner += `<text x="${rx + CELL_PADDING_H}" y="${y + ROW_HEIGHT / 2}" dominant-baseline="middle" font-family="Pretendard" font-size="${FONT_SIZE}" font-weight="${num ? '700' : '400'}" fill="${num ? C.CELL_NUM : C.CELL}">${escapeXml(cell)}</text>`;
        rx += colWidths[ci];
      }
      inner += `<line x1="${OUTER_PADDING}" y1="${y + ROW_HEIGHT}" x2="${OUTER_PADDING + tableW}" y2="${y + ROW_HEIGHT}" stroke="${C.BORDER}" stroke-width="0.5"/>`;
      y += ROW_HEIGHT;
    }

    inner += `<rect x="${OUTER_PADDING}" y="${OUTER_PADDING}" width="${tableW}" height="${totalH - OUTER_PADDING * 2}" fill="none" stroke="${C.BORDER}" stroke-width="1"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}">${inner}</svg>`;
  }

  // text type
  const blocks = content.textBlocks ?? [];
  const titleH = content.title ? TITLE_HEIGHT : 0;
  const totalH = OUTER_PADDING + titleH + blocks.length * TEXT_LINE_HEIGHT + OUTER_PADDING;

  let y = OUTER_PADDING;
  let inner = `<rect width="${width}" height="${totalH}" fill="${C.PAGE_BG}"/>`;

  if (content.title) {
    inner += `<rect x="${OUTER_PADDING}" y="${y}" width="${contentW}" height="${TITLE_HEIGHT}" fill="${C.TITLE_BG}"/>`;
    inner += `<text x="${OUTER_PADDING + contentW / 2}" y="${y + TITLE_HEIGHT / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Pretendard" font-size="14" font-weight="700" fill="${C.TITLE_TEXT}" letter-spacing="2">${escapeXml(content.title)}</text>`;
    y += TITLE_HEIGHT;
  }

  for (const block of blocks) {
    inner += `<text x="${OUTER_PADDING}" y="${y + TEXT_LINE_HEIGHT / 2}" dominant-baseline="middle" font-family="Pretendard" font-size="${FONT_SIZE}" font-weight="${block.bold ? '700' : '400'}" fill="${C.CELL}">${escapeXml(block.text)}</text>`;
    y += TEXT_LINE_HEIGHT;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}">${inner}</svg>`;
}

export async function renderAsImage(
  content: StructuredContent,
  imageWidth: number,
): Promise<Buffer> {
  const w = Math.min(Math.max(imageWidth, 400), 1200);
  const svg = buildSvg(content, w);

  const resvg = new Resvg(svg, {
    font: { fontFiles: [FONT_PATH], loadSystemFonts: false, defaultFontFamily: 'Pretendard' },
  });
  const pngData = resvg.render().asPng();
  return sharp(Buffer.from(pngData)).jpeg({ quality: 92 }).toBuffer();
}

export async function ensureFontAvailable(): Promise<void> {
  await fs.access(FONT_PATH);
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run src/__tests__/lib/ai/image-text-edit.test.ts 2>&1 | tail -20
```

예상 출력: `PASS` (4개 테스트 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/image-text-edit.ts src/__tests__/lib/ai/image-text-edit.test.ts
git commit -m "feat(ai-edit): OCR → 구조화 JSON + SVG 렌더링 파이프라인으로 교체"
```

---

## Task 2: applyUserInstruction 테스트 추가 (동일 파일 계속)

**Files:**
- Modify: `src/__tests__/lib/ai/image-text-edit.test.ts`

- [ ] **Step 1: applyUserInstruction 테스트 블록 추가**

`src/__tests__/lib/ai/image-text-edit.test.ts` 파일 마지막에 아래 블록을 추가한다:

```typescript
describe('applyUserInstruction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('행 삭제 지시를 올바르게 처리한다', async () => {
    const modified = {
      type: 'table',
      title: 'SIZE CHART',
      table: {
        headers: ['SIZE', '가슴둘레'],
        rows: [['90', '92.5–97.5cm']],
      },
    };
    vi.mocked(callClaude).mockResolvedValue(JSON.stringify(modified));

    const input: StructuredContent = {
      type: 'table',
      title: 'SIZE CHART',
      table: {
        headers: ['SIZE', '가슴둘레'],
        rows: [['85', '87.5–92.5cm'], ['90', '92.5–97.5cm']],
      },
    };

    const result = await applyUserInstruction(input, '85 사이즈 삭제');

    expect(result.table?.rows).toHaveLength(1);
    expect(result.table?.rows[0][0]).toBe('90');
  });

  it('JSON을 찾을 수 없으면 에러를 던진다', async () => {
    vi.mocked(callClaude).mockResolvedValue('이해하지 못했습니다.');

    await expect(
      applyUserInstruction({ type: 'text', textBlocks: [] }, '다듬기'),
    ).rejects.toThrow('지시 적용 응답에서 JSON을 찾을 수 없습니다.');
  });
});

describe('renderAsImage', () => {
  it('표 콘텐츠로 Buffer를 반환한다', async () => {
    const result = await renderAsImage(
      {
        type: 'table',
        title: 'SIZE CHART',
        table: { headers: ['SIZE', '가슴'], rows: [['85', '87cm']] },
      },
      600,
    );
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('텍스트 콘텐츠로 Buffer를 반환한다', async () => {
    const result = await renderAsImage(
      { type: 'text', title: '특징', textBlocks: [{ text: '고품질', bold: true }] },
      600,
    );
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('너비를 400–1200px 범위로 클램프한다', async () => {
    // 너무 좁은 너비도 에러 없이 처리
    await expect(renderAsImage({ type: 'text', textBlocks: [] }, 100)).resolves.toBeDefined();
    // 너무 넓은 너비도 에러 없이 처리
    await expect(renderAsImage({ type: 'text', textBlocks: [] }, 2000)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: import에 StructuredContent 추가**

동일 파일 import 라인을 아래로 수정한다:

```typescript
import {
  extractStructuredContent,
  applyUserInstruction,
  renderAsImage,
  type StructuredContent,
} from '@/lib/ai/image-text-edit';
```

- [ ] **Step 3: 테스트 실행 → 통과 확인**

```bash
npx vitest run src/__tests__/lib/ai/image-text-edit.test.ts 2>&1 | tail -20
```

예상 출력: `PASS` (9개 테스트 통과)

- [ ] **Step 4: 커밋**

```bash
git add src/__tests__/lib/ai/image-text-edit.test.ts
git commit -m "test(ai-edit): applyUserInstruction, renderAsImage 단위 테스트 추가"
```

---

## Task 3: route.ts 파이프라인 교체

**Files:**
- Modify: `src/app/api/ai/edit-image-text/route.ts`

- [ ] **Step 1: import 교체**

`route.ts` 상단의 import 블록에서 기존 함수들을 새 함수들로 교체한다.

기존:
```typescript
import {
  extractTextRegions,
  parseEditIntent,
  composeTextOnImage,
  ensureFontAvailable,
} from '@/lib/ai/image-text-edit';
```

새로운:
```typescript
import sharp from 'sharp';
import {
  extractStructuredContent,
  applyUserInstruction,
  renderAsImage,
  ensureFontAvailable,
  type StructuredContent,
} from '@/lib/ai/image-text-edit';
```

- [ ] **Step 2: RequestSchema에서 productName 제거**

기존:
```typescript
export const RequestSchema = z.object({
  imageUrl: z.string().min(1, 'imageUrl은 비어있을 수 없습니다.'),
  instruction: z
    .string()
    .min(1, 'instruction은 비어있을 수 없습니다.')
    .max(500, 'instruction은 500자 이내여야 합니다.'),
  productName: z.string().max(200).optional(),
});
```

새로운 (productName 제거):
```typescript
export const RequestSchema = z.object({
  imageUrl: z.string().min(1, 'imageUrl은 비어있을 수 없습니다.'),
  instruction: z
    .string()
    .min(1, 'instruction은 비어있을 수 없습니다.')
    .max(500, 'instruction은 500자 이내여야 합니다.'),
});
```

- [ ] **Step 3: POST 핸들러 파이프라인 교체**

`const { imageUrl, instruction, productName } = parsed.data;` 줄부터 `// 5) Supabase Storage 업로드` 바로 전 `let composed: Buffer;` 를 포함한 구간 전체를 아래로 교체한다.

기존 구간:
```typescript
  const { imageUrl, instruction, productName } = parsed.data;

  // 폰트 자산 검증
  try {
    await ensureFontAvailable();
  } catch {
    ...
  }

  // 1) 이미지 다운로드 + 리사이즈
  let imageBuffer: Buffer;
  let mimeType;
  try { ... } catch { ... }

  // 2) OCR
  let regions;
  try {
    regions = await extractTextRegions(...);
  } catch { ... }

  if (regions.length === 0) { ... }

  // 3) 의도 파싱
  let operations;
  try {
    operations = await parseEditIntent(regions, instruction, productName);
  } catch { ... }

  if (operations.length === 0) { ... }

  // 4) 합성
  let composed: Buffer;
  try {
    composed = await composeTextOnImage(imageBuffer, operations);
  } catch { ... }
```

새로운 구간:
```typescript
  const { imageUrl, instruction } = parsed.data;

  // 폰트 자산 검증
  try {
    await ensureFontAvailable();
  } catch {
    return Response.json(
      {
        success: false,
        error: '서버 설정 오류: Pretendard 폰트 자산을 찾을 수 없습니다.',
      } satisfies ApiError,
      { status: 503 },
    );
  }

  // 1) 이미지 다운로드 + 리사이즈
  let imageBuffer: Buffer;
  let mimeType;
  try {
    const downloaded = await fetchImagesFromUrls([imageUrl]);
    const safe = await resizeForClaude(downloaded[0].imageBase64, downloaded[0].mimeType);
    imageBuffer = Buffer.from(safe.imageBase64, 'base64');
    mimeType = safe.mimeType;
  } catch (err) {
    console.error('[edit-image-text] 이미지 처리 실패:', err);
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? `이미지 처리 실패: ${err.message}` : '이미지 처리 오류',
      } satisfies ApiError,
      { status: 400 },
    );
  }

  // 원본 이미지 너비 추출
  let imageWidth = 800;
  try {
    const meta = await sharp(imageBuffer).metadata();
    imageWidth = meta.width ?? 800;
  } catch {
    // 메타데이터 실패 시 기본값 사용
  }

  // 2) OCR — 구조화된 콘텐츠 추출
  let content: StructuredContent;
  try {
    content = await extractStructuredContent(imageBuffer.toString('base64'), mimeType);
  } catch (err) {
    console.error('[edit-image-text] OCR 실패:', err);
    return Response.json(
      {
        success: false,
        error: '이미지에서 텍스트를 인식하지 못했습니다. 다시 시도해주세요.',
      } satisfies ApiError,
      { status: 502 },
    );
  }

  // 3) 사용자 지시 적용
  let modified: StructuredContent;
  try {
    modified = await applyUserInstruction(content, instruction);
  } catch (err) {
    console.error('[edit-image-text] 지시 적용 실패:', err);
    return Response.json(
      {
        success: false,
        error: 'AI가 편집 지시를 해석하지 못했습니다. 더 구체적으로 지시해주세요.',
      } satisfies ApiError,
      { status: 502 },
    );
  }

  // 4) 이미지 렌더링
  let composed: Buffer;
  try {
    composed = await renderAsImage(modified, imageWidth);
  } catch (err) {
    console.error('[edit-image-text] 렌더링 실패:', err);
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? `이미지 생성 실패: ${err.message}` : '이미지 생성 중 오류가 발생했습니다.',
      } satisfies ApiError,
      { status: 500 },
    );
  }
```

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "edit-image-text"
```

예상 출력: 아무것도 출력되지 않음 (에러 없음)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/edit-image-text/route.ts
git commit -m "feat(api): edit-image-text 라우트를 새 파이프라인으로 교체"
```

---

## Task 4: AiEditModal 버튼 프롬프트 + 테스트 수정

**Files:**
- Modify: `src/components/listing/AiEditModal.tsx`
- Modify: `src/__tests__/components/ai-edit-modal-text-group.test.tsx`

- [ ] **Step 1: DETAIL_QUICK_PROMPTS_TEXT 프롬프트 문자열 수정**

`src/components/listing/AiEditModal.tsx` 에서 `DETAIL_QUICK_PROMPTS_TEXT` 배열을 아래로 교체한다.

기존:
```typescript
const DETAIL_QUICK_PROMPTS_TEXT = [
  {
    label: '강조/가독성',
    prompt:
      '텍스트 가독성을 높여주세요. 핵심 키워드와 숫자를 굵게/대비를 강하게 다듬고, 글자 크기·자간을 정돈해주세요.',
  },
  {
    label: '자동 다듬기',
    prompt:
      '이미지의 한국어 텍스트를 자연스럽게 다듬어주세요. 오타와 어색한 표현을 자연스러운 한국어로 교정. 의미·위치는 그대로 유지.',
  },
  {
    label: '표 데이터 수정',
    prompt:
      "표의 OOO 셀을 'XXX'로 바꿔주세요. ← 원하는 셀과 새 값을 자유롭게 적어주세요. (예: 표의 '가격' 셀을 '29,900원'으로)",
  },
];
```

새로운:
```typescript
const DETAIL_QUICK_PROMPTS_TEXT = [
  {
    label: '강조/가독성',
    prompt: '핵심 숫자와 키워드를 명확하게 정리해주세요.',
  },
  {
    label: '자동 다듬기',
    prompt: '텍스트를 자연스러운 한국어로 교정해주세요.',
  },
  {
    label: '표 데이터 수정',
    prompt: "표의 [셀명]을 [새값]으로 바꿔주세요. ← 원하는 셀과 새 값을 자유롭게 적어주세요.",
  },
];
```

- [ ] **Step 2: 기존 테스트 실행 → 실패 확인**

```bash
npx vitest run src/__tests__/components/ai-edit-modal-text-group.test.tsx 2>&1 | tail -20
```

예상 출력: `FAIL` — `expect(body.instruction).toContain('자연스럽게 다듬')` 이 실패

- [ ] **Step 3: 테스트 기댓값 수정**

`src/__tests__/components/ai-edit-modal-text-group.test.tsx` 에서 아래 줄을 수정한다.

기존:
```typescript
    expect(body.instruction).toContain('자연스럽게 다듬');
```

새로운:
```typescript
    expect(body.instruction).toContain('자연스러운 한국어');
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run src/__tests__/components/ai-edit-modal-text-group.test.tsx 2>&1 | tail -20
```

예상 출력: `PASS` (5개 테스트 모두 통과)

- [ ] **Step 5: 전체 테스트 스위트 실행**

```bash
npx vitest run 2>&1 | tail -30
```

예상 출력: 전체 PASS (새로 추가된 9개 포함)

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/AiEditModal.tsx src/__tests__/components/ai-edit-modal-text-group.test.tsx
git commit -m "feat(ui): 텍스트·표 버튼 프롬프트를 새 파이프라인 기준으로 업데이트"
```

---

## 검증 체크리스트

구현 완료 후 로컬에서 직접 확인:

- [ ] 개발 서버 실행: `npm run dev`
- [ ] 상세페이지 편집 화면 열기 → "텍스트·표" 섹션 버튼 3개 보임
- [ ] SIZE CHART 이미지로 "강조/가독성" 버튼 클릭 → AI 편집 실행 → 깔끔한 표 이미지 반환 확인
- [ ] "자동 다듬기" 버튼으로 텍스트 이미지 편집 → 텍스트 블록 렌더링 확인
- [ ] "표 데이터 수정" 버튼 → 프롬프트에 수정 지시 입력 → 수정된 표 이미지 확인
- [ ] TypeScript 빌드: `npx tsc --noEmit` → 에러 없음
