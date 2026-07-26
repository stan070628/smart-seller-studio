/**
 * POST /api/ai/generate-pro-layout
 *
 * OCR 결과 + 상품 정보 → Claude Sonnet으로 전체 페이지 DSL 생성
 *
 * 응답: { success, sections, warnings? }. warnings는 위생 삭제·잔존 위반이
 * 있을 때만 존재하는 사용자용 한국어 문구 배열이다(빈 배열이면 키 자체를 생략).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude, callClaudeVision, type ClaudeImage } from '@/lib/ai/claude-cli';
import { sanitizeProLayout, validateProLayout, stripCjk } from '@/lib/detail-page/layout-validator';
import { isGroundedProgressItem, type ProgressItem } from '@/lib/detail-page/progress-hygiene';
import { requiredSpecWarnings } from '@/lib/detail-page/required-specs';
import { sectionCap } from '@/lib/detail-page/image-hygiene';
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
 * sections의 progress_bar 블록(columns.cols 재귀 포함)마다 items 배열로 콜백을 호출한다.
 * countUngroundedProgressItems가 이 워커를 재사용한다.
 */
function forEachProgressBarItems(sections: unknown[], cb: (items: unknown[]) => void): void {
  if (!Array.isArray(sections)) return; // sanitizeProLayout의 방어와 대칭 — 도달 불가하지만 비배열 입력에 안전
  const walkBlocks = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'progress_bar' && Array.isArray(block.items)) cb(block.items);
      if (Array.isArray(block.cols)) {
        for (const col of block.cols) walkBlocks(col);
      }
    }
  };
  for (const sec of sections) {
    if (sec && typeof sec === 'object') walkBlocks((sec as { blocks?: unknown }).blocks);
  }
}

/**
 * sections 안 progress_bar item 중 provenance 대조(isGroundedProgressItem)에
 * 실패하는(=근거 없는) 개수. sanitize 전/후 개수 diff가 아니라 원인을 직접 세는
 * 이유: diff는 연속 중복 섹션 제거·스키마 무효 블록 제거처럼 provenance와 무관한
 * 이유로 progress_bar가 사라지는 경우까지 "위생 삭제"로 오분류하고, kept<2일 때
 * 근거 있는 항목까지 함께 비워지는 것도 구분 못 한다. 또 repair 경로에서는
 * beforeCount(원본)와 afterCount(repair가 다시 쓴 결과)의 기준 자체가 달라져
 * repair가 새로 추가한 progress_bar가 diff를 상쇄해 실제 삭제를 놓칠 수 있다.
 * 원인 기준으로 세면 이 세 문제를 모두 피하고, repair 이전 원본 한 번만 계산해
 * 양쪽 반환 경로에서 같은 값을 쓸 수 있다.
 *
 * sanitizeProLayout은 stripCjk → provenance 순으로 대조하므로, 완전히 같은 텍스트
 * 기준으로 세려면 stripCjk를 거친 sections를 넘겨야 한다(호출부에서 처리).
 * isGroundedProgressItem/layout-validator.ts는 이 함수가 import만 하고 수정하지
 * 않는다.
 *
 * 알려진 미탐 한계: 원본 1회만 계산하므로, repair가 나중에 근거 없는 progress_bar를
 * 새로 추가하면 이 카운트엔 반영되지 않아 그 삭제분은 보고되지 않는다. 미탐(경고를
 * 덜 내는) 방향이라 사용자에게 거짓 안심을 주지는 않지만, 완전하지 않다는 점은
 * 명시해둔다.
 */
function countUngroundedProgressItems(sections: unknown[], sourceText: string): number {
  let total = 0;
  forEachProgressBarItems(sections, (items) => {
    total += (items as ProgressItem[]).filter(
      (it) => it && typeof it === 'object' && !isGroundedProgressItem(it, sourceText),
    ).length;
  });
  return total;
}

/**
 * 잔존 error-severity 위반을 사용자 문구로 변환한다. Violation.code(예: 'narrative',
 * 'option_coverage')와 message는 개발자 진단용(예: "sections[1]에 beat 필드가
 * 없습니다")이라 그대로 화면에 노출하면 셀러에게 버그처럼 보인다. code 단위로
 * 사람이 읽을 문구에 매핑하고, 같은 문구가 여러 섹션에서 반복돼도 중복 제거한다
 * (beat_missing이 9개 섹션에서 나면 narrative code가 9번 쌓이는 식이라 그대로
 * 두면 배너에 9줄이 뜬다).
 */
const VIOLATION_CODE_MESSAGES: Record<string, string> = {
  narrative: '페이지 구성이 권장 흐름(도입-근거-비교-안심)에 못 미칩니다. 다시 생성하면 개선될 수 있습니다.',
  option_compare: '옵션 비교 섹션 구성에 문제가 있습니다. 다시 생성하면 개선될 수 있습니다.',
  option_coverage: '옵션별 이미지 배분이 고르지 않습니다. 다시 생성하면 개선될 수 있습니다.',
  // 쿠팡 광고 정책 위반 표현 — autoFixable:false라 재생성해도 같은 표현이 또 나올 수
  // 있다. "다시 생성"이 아니라 "에디터에서 직접 수정"을 안내해야 한다.
  prohibited: '광고 정책상 사용할 수 없는 표현이 남아 있습니다. 에디터에서 해당 문구를 직접 수정해주세요.',
  // prohibited와 달리 재생성으로 해결될 수 있다 — repair가 슬롯을 추가하거나,
  // 다음 생성에서 Claude가 2개를 만든다.
  wearing_coverage: '인물 착용컷이 1개뿐입니다. 다시 생성하면 얼굴 컷과 크롭 컷이 각각 만들어질 수 있습니다.',
};
const GENERIC_VIOLATION_MESSAGE = '일부 구성이 자동 검증 기준에 못 미칩니다. 다시 생성하면 개선될 수 있습니다.';

function friendlyViolationWarnings(violations: Array<{ code: string; severity: string }>): string[] {
  const messages = new Set<string>();
  for (const v of violations) {
    if (v.severity !== 'error') continue;
    messages.add(VIOLATION_CODE_MESSAGES[v.code] ?? GENERIC_VIOLATION_MESSAGE);
  }
  return [...messages];
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
        wearing: true,
        provenanceSource,
        optionNameByImageIndex: optionNameByImageIndex(options),
      }
    : { statHygiene: true, narrative: true, wearing: true, provenanceSource };

  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0
      ? `Key points:\n${productInfo.points.map(p => `- ${p}`).join('\n')}`
      : '',
    imageCount > 0
      ? `제품 이미지 ${imageCount}장이 인덱스 0..${imageCount - 1}로 제공됩니다. 실물을 보고 색상·소재·디테일을 파악해 카피에 반영하고, 각 imageSlot의 imageRef에 그 슬롯에 가장 알맞은 이미지 인덱스를 지정하세요.`
      : '',
    imageCount > 0 ? `섹션 수: 최대 ${sectionCap(imageCount)}개.` : '',
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

    // 위생 삭제 개수는 repair 이전 원본 기준으로 한 번만 센다(원인 기준 카운트라
    // repair가 이후에 뭘 하든 이 값은 바뀌지 않는다 — countUngroundedProgressItems
    // 주석 참고). sanitizeProLayout과 동일하게 stripCjk를 먼저 거친 텍스트로 대조한다.
    const ungroundedCount = countUngroundedProgressItems(
      stripCjk(sections) as unknown[],
      layoutOpts.provenanceSource,
    );
    const hygieneWarnings: string[] = ungroundedCount > 0
      ? [
          `근거 없는 수치 ${ungroundedCount}개가 발견되어 해당 항목이 제거되었습니다. ` +
          `상품 정보에 "통기성 92%"처럼 형식까지 동일하게 수치를 입력하면 표시됩니다.`,
        ]
      : [];

    // 결정론적 정화(CJK 제거 + stat 위생 + 무효/빈 블록 prune + 중복 제거)
    let cleaned = sanitizeProLayout(sections, layoutOpts).sections;

    // 필수 스펙 커버리지. 입력(productInfo)만 보므로 생성 결과와 무관하게 값이 같다 —
    // repair 경로·정상 경로 어디서 호출해도 동일하다. Violation으로 만들지 않는 이유는
    // required-specs.ts 상단 주석 참고: error로 올리면 repair가 없는 수치를 지어내도록
    // 압박하고, warning으로 올리면 friendlyViolationWarnings가 걸러 셀러에게 안 닿는다.
    const specWarnings = requiredSpecWarnings(
      productInfo.category,
      productInfo.name,
      productInfo.points,
    );

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
      // 진단용 code:message가 아니라 friendlyViolationWarnings가 만든 사용자 문구를 싣는다.
      const warnings = [
        ...hygieneWarnings,
        ...specWarnings,
        ...friendlyViolationWarnings(after.violations),
      ];
      return NextResponse.json({
        success: true,
        sections: cleaned,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    // repair를 타지 않은 정상 경로도 위생 삭제·필수 스펙 누락은 알려야 한다 — repair
    // 여부와 무관하게 일어나는 일이기 때문이다. (isClean이므로
    // friendlyViolationWarnings는 항상 빈 배열이라 여기선 호출하지 않는다.)
    const cleanWarnings = [...hygieneWarnings, ...specWarnings];
    return NextResponse.json({
      success: true,
      sections: cleaned,
      ...(cleanWarnings.length > 0 ? { warnings: cleanWarnings } : {}),
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
