/**
 * POST /api/ai/generate-pro-layout
 *
 * OCR 결과 + 상품 정보 → Claude Sonnet으로 전체 페이지 DSL 생성
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude, callClaudeVision, type ClaudeImage } from '@/lib/ai/claude-cli';
import { sanitizeProLayout, validateProLayout } from '@/lib/detail-page/layout-validator';
import { repairProLayout } from '@/lib/ai/repair-pro-layout';
import {
  uniqueOptionNames,
  isOptionMode,
  optionNameByImageIndex,
  type ProductOption,
} from '@/lib/detail-page/product-options';
import { CLAUDE_SYSTEM } from './system-prompt';

export const maxDuration = 180;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

const RequestSchema = z.object({
  productInfo: z.object({
    name: z.string().min(1).max(200),
    // 항목 길이·개수를 거부하지 않고 잘라내 400을 원천 차단(참고 데이터일 뿐).
    points: z
      .array(z.string().transform(s => s.slice(0, 200)))
      .default([])
      .transform(arr => arr.slice(0, 30)),
    category: z.string().max(100).default(''),
  }),
  analyzedSections: z
    .array(
      z.object({
        blockType: z.string(),
        rawText: z.string(),
        extractedData: z.unknown(),
        confidence: z.string(),
        needsReview: z.boolean(),
      })
    )
    .default([])
    // 참고 스크린샷 1장에 섹션이 여러 개다(analyze-detail-page가 섹션별 배열 반환).
    // 출력은 어차피 6~10섹션이라 입력은 참고 데이터일 뿐 → 초과분은 거부 대신 슬라이스.
    // (과거 .max(8)/.max(60)은 멀티섹션 OCR에서 400을 유발.)
    .transform(arr => arr.slice(0, 60)),
  productImageCount: z.number().min(0).max(4).default(0),
  // 제품 이미지(다운스케일 base64). Claude가 실물을 보고 색상·디테일·카피를 정하도록.
  productImages: z
    .array(z.object({ base64: z.string().min(1), mimeType: z.string() }))
    .max(4)
    .default([]),
  // 이미지에 붙은 옵션명. 이름이 붙은 이미지마다 한 항목(중복 허용).
  productOptions: z
    .array(z.object({
      name: z.string().min(1).max(40),
      imageIndex: z.number().int().min(0).max(3),
    }))
    .max(4)
    .default([]),
});

/**
 * sections 안 모든 progress_bar 블록의 items 개수 합계.
 * columns.cols 안에 중첩된 progress_bar도 세야 하므로 재귀한다.
 * sanitizeProLayout 전후로 이 값을 비교해 위생 삭제 개수를 사용자에게 알린다
 * (layout-validator.ts/progress-hygiene.ts는 삭제 개수를 반환하지 않으므로
 * route.ts에서 별도로 세는 것이 최소 변경이다).
 */
function countProgressBarItems(sections: unknown[]): number {
  let total = 0;
  const walkBlocks = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'progress_bar' && Array.isArray(block.items)) {
        total += block.items.length;
      }
      if (Array.isArray(block.cols)) {
        for (const col of block.cols) walkBlocks(col);
      }
    }
  };
  for (const sec of sections) {
    if (sec && typeof sec === 'object') {
      walkBlocks((sec as { blocks?: unknown }).blocks);
    }
  }
  return total;
}

/** 첫 번째 완전한 JSON 배열을 추출 (코드펜스 무관) */
function extractJsonArray(text: string): string | null {
  // 코드펜스 안에 있어도 첫 [ 부터 매칭하면 충분
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-pro-layout'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    const koMessage = path.includes('name')
      ? '상품명을 입력해주세요.'
      : `요청 형식이 올바르지 않습니다 (${path || 'unknown'}).`;
    return NextResponse.json(
      { success: false, error: koMessage, _debug: issue?.message },
      { status: 400 }
    );
  }

  const { productInfo, analyzedSections, productImageCount, productImages, productOptions } = parsed.data;
  const images: ClaudeImage[] = productImages.length > 0
    ? productImages
    : [];
  const imageCount = images.length || productImageCount;

  const options: ProductOption[] = productOptions;
  const optionMode = isOptionMode(options);
  const optionLines = optionMode
    ? options.map((o) => `이미지 ${o.imageIndex} = "${o.name}"`)
    : [];
  // provenance 원천: 사용자가 이 상품에 대해 입력한 값만 쓴다.
  // analyzedSections(레퍼런스 페이지 추출 데이터)를 넣으면 "이 상품의 근거"가 아닌
  // 숫자가 화이트리스트에 올라 판정이 느슨해진다 — 경쟁사 페이지의 수치가
  // 우리 상품의 지어낸 수치를 정당화하는 구조가 되므로 제외한다.
  // 대가: 원본 상세페이지에서 가져온 정당한 스펙도 제거된다. 미탐(지어낸 수치 통과)의
  // 법적 리스크가 오탐(정당한 수치 제거)의 손실보다 크다고 판단한 선택이다.
  const provenanceSource = productInfo.points.join(' ');

  // stat 위생·서사 검증은 생성 경로 전용 — draft/render는 사용자 편집본이라 켜지 않는다.
  const layoutOpts = optionMode
    ? {
        statHygiene: true,
        narrative: true,
        provenanceSource,
        optionNameByImageIndex: optionNameByImageIndex(options),
      }
    : { statHygiene: true, narrative: true, provenanceSource };

  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0
      ? `Key points:\n${productInfo.points.map(p => `- ${p}`).join('\n')}`
      : '',
    imageCount > 0
      ? `제품 이미지 ${imageCount}장이 인덱스 0..${imageCount - 1}로 제공됩니다. 실물을 보고 색상·소재·디테일을 파악해 카피에 반영하고, 각 imageSlot의 imageRef에 그 슬롯에 가장 알맞은 이미지 인덱스를 지정하세요.`
      : '',
    optionLines.length > 0
      ? `옵션(색상/모델): ${optionLines.join(', ')}\n` +
        `옵션 비교 섹션을 정확히 1개 만들고, 나머지 이미지 섹션에는 ${uniqueOptionNames(options).join('·')}를 고르게 배분하세요. 모든 imageSlot에 imageRef를 명시하세요.`
      : '',
    analyzedSections.length > 0
      ? `Extracted data from reference pages:\n${analyzedSections
          .map((s, i) => `Section ${i + 1} (${s.blockType}): ${JSON.stringify(s.extractedData)}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    // 제품 이미지가 있으면 Claude 비전으로(CLI 우선) — 실물 기반 색상·카피·디테일.
    const text = images.length > 0
      ? await callClaudeVision(CLAUDE_SYSTEM, userPrompt, images, 'opus', 16000)
      : await callClaude(CLAUDE_SYSTEM, userPrompt, 'opus', 16000);

    console.log('[generate-pro-layout] text 길이:', text.length, '앞100자:', JSON.stringify(text.slice(0, 100)));

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) {
      console.error('[generate-pro-layout] JSON 배열 없음. 앞500자:', JSON.stringify(text.slice(0, 500)));
      return NextResponse.json(
        { success: false, error: 'Claude 응답에서 JSON 배열을 찾을 수 없습니다.', _debug: text.slice(0, 300) },
        { status: 500 }
      );
    }

    let sections: unknown[];
    try {
      sections = JSON.parse(jsonStr) as unknown[];
    } catch (e) {
      console.error('[generate-pro-layout] JSON 파싱 실패. 추출된 문자열:', jsonStr.slice(0, 500));
      return NextResponse.json(
        { success: false, error: 'Claude 응답 JSON 파싱 실패' },
        { status: 500 }
      );
    }

    // 결정론적 정화(CJK 제거 + stat 위생 + 무효/빈 블록 prune + 중복 제거)
    // 주의: stat_row/progress_bar 위생 삭제는 그 자체로는 무음이다 — 블록이 통째로
    // 사라지면 재검증에 걸릴 위반 자체가 없어 repair 경로의 warnings에도 남지 않는다.
    // provenanceSource가 빈 문자열이면(points 미입력) 모든 progress_bar가 조용히
    // 증발한다. 그래서 sanitizeProLayout 전후로 progress_bar item 개수를 직접 세어
    // (layout-validator.ts/progress-hygiene.ts는 건드리지 않고) 줄어든 만큼을
    // hygieneWarnings로 남긴다.
    const beforeHygieneCount = countProgressBarItems(sections);
    let cleaned = sanitizeProLayout(sections, layoutOpts).sections;

    /** 최종 결과 기준 위생 삭제 개수를 사람이 읽을 경고로 변환한다 */
    const buildHygieneWarnings = (finalSections: unknown[]): string[] => {
      const afterCount = countProgressBarItems(finalSections);
      if (afterCount >= beforeHygieneCount) return [];
      const removed = beforeHygieneCount - afterCount;
      return [
        `근거 없는 수치 ${removed}개가 제거되었습니다. 상품 정보에 실측값을 입력하면 표시됩니다.`,
      ];
    };

    // error-severity 위반이 남으면 Claude로 1-pass 수리 후 재정화 (조건부)
    const { violations, isClean } = validateProLayout(cleaned, layoutOpts);
    if (!isClean) {
      console.warn('[generate-pro-layout] 위반 발견, repair 실행:', violations.length);
      const repaired = await repairProLayout(cleaned, violations, {
        name: productInfo.name,
        points: productInfo.points,
        category: productInfo.category,
        optionLines: optionLines.length > 0 ? optionLines : undefined,
      });
      cleaned = sanitizeProLayout(repaired, layoutOpts).sections;

      // 재정화 후에도 남으면 경고만 남기고 결과를 준다 — 루프를 만들지 않는다.
      // 옵션 편중은 페이지를 못 쓰게 만드는 결함이 아니라 품질 저하다.
      const after = validateProLayout(cleaned, layoutOpts);
      if (!after.isClean) {
        console.warn(
          '[generate-pro-layout] repair 후에도 위반 잔존:',
          after.violations.filter((v) => v.severity === 'error').map((v) => `${v.code}: ${v.message}`),
        );
      }
      // 잔존 error + 위생 삭제 경고를 함께 클라이언트에 전달해 결과 화면에서 알린다.
      const warnings = [
        ...buildHygieneWarnings(cleaned),
        ...after.violations
          .filter((v) => v.severity === 'error')
          .map((v) => `${v.code}: ${v.message}`),
      ];
      return NextResponse.json({
        success: true,
        sections: cleaned,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    // repair를 타지 않은 정상 경로도 위생 삭제만큼은 알려야 한다 — repair 여부와
    // 무관하게 일어나는 일이기 때문이다.
    const hygieneWarnings = buildHygieneWarnings(cleaned);
    return NextResponse.json({
      success: true,
      sections: cleaned,
      ...(hygieneWarnings.length > 0 ? { warnings: hygieneWarnings } : {}),
    });
  } catch (error) {
    console.error('[generate-pro-layout] 오류:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `레이아웃 생성 실패: ${msg}` },
      { status: 500 }
    );
  }
}
