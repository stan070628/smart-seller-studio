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
});

const CLAUDE_SYSTEM = `You are a Korean e-commerce product detail page designer.
Generate a complete page layout as a JSON array of sections for mobile (390px width).

Each section is a ClaudeLayoutContent object:
{
  "type": "claude_layout",
  "title": "section title",
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide",
  "imageSlots": [{"slotType": "flux_lifestyle"|"product_nukki"|"detail_closeup", "promptHint": "...", "imageRef": 0}]
}
slotType: flux_lifestyle=착용/사용 라이프스타일 씬(AI 생성), product_nukki=제품 단독컷, detail_closeup=제품의 물리적 디테일(지퍼·스트랩·원단·수납) 접사 컷.
imageRef = 이 슬롯에 쓸 제품 이미지의 인덱스(0부터). 제공된 이미지를 실제로 보고, 그 섹션 내용/색상에 가장 맞는 이미지를 지정하세요. 예: 히어로·소재 섹션이 베이지를 다루면 베이지 이미지 인덱스를, 로즈 카드는 로즈 이미지 인덱스를.

Available block types in blocks[]:
- badge: { type, text, color?: 'primary'|'accent'|'neutral' }
- heading: { type, text, size: 'xl'|'lg'|'md', bold?, color? }
- subtext: { type, text, align?: 'left'|'center' }
- image: { type, attachedIndex: 0..N } — attachedIndex는 "해당 섹션 imageSlots 내부의 0-기반 인덱스"이며 반드시 imageSlots.length 미만이어야 한다. imageSlots를 선언한 섹션은 blocks에 대응하는 image 블록을 반드시 하나 이상 포함하라.
- stat_row: { type, items: [{label, value, unit?}] }
- bullet_list: { type, items: string[], icon?: 'dot'|'check'|'arrow' }
- columns: { type, cols: LayoutBlock[][], gap? }
- divider: { type }
- spacer: { type, height: number }
- progress_bar: { type, items: [{label, value(0-100), displayValue?, highlight?}] }
- process_flow: { type, direction?: 'horizontal'|'vertical', items: [{label, sublabel?, highlight?}] } — TIME/ORDER 흐름 단계 전용. 화살표로 연결됨.
- icon_grid: { type, cols?: 2|3, items: [{icon, title, subtitle?}] }
- option_grid: { type, cols?: 2|3, items: [{label, sublabel?, highlight?}] } — 사이즈/색상/용량/구성 등 순서 없는 병렬 선택 옵션. 화살표 없음. 컬러/구성처럼 옵션마다 제품 이미지가 다른 경우: imageSlots를 옵션 개수만큼(items 수와 동일) 선언하면 각 카드 상단에 이미지가 순서대로 렌더된다. 이 경우 같은 섹션에 별도의 대형 image 블록을 두지 말 것(카드가 이미지를 표시하므로 중복된다). 사이즈처럼 이미지가 불필요한 옵션은 imageSlots 없이 텍스트 카드만 사용.
- layout_bar_chart: { type, title?, unit?, groups: string[], groupColors: string[], items: [{label, values: number[]}], showLegend? }

DESIGN RULES:
1. Use extracted chart data EXACTLY as provided — do not modify numbers
2. Use stat_row for large impact numbers
3. heading 'xl' for section headlines
4. imageSlots map to section images
5. For lifestyle images use slotType "flux_lifestyle" with descriptive promptHint in Korean
6. Generate 6-10 sections for a complete detail page
7. NEVER use Chinese characters (한자/漢字). Use Korean (한글) or English ONLY. This applies to ALL text: titles, labels, sublabels, stat values, promptHints, badge text, etc. Examples of FORBIDDEN characters: 適當 → write "적당", 溫度 → write "온도", 品質 → write "품질".
8. Design for 390px mobile width — avoid wide horizontal layouts or tables that overflow narrow screens. Use vertical or wrapped layouts.
9. process_flow는 시간/순서가 있는 단계에만 사용 (예: 봄→여름→가을, 세탁→건조→보관). 사이즈·색상·용량·구성처럼 순서가 없는 병렬 선택 옵션은 절대 process_flow로 만들지 말고 반드시 option_grid를 사용하세요. 사이즈 안내(S/M/L 등)는 항상 option_grid입니다.
10. icon_grid·timeline의 icon 필드는 반드시 빈 문자열("")로 두세요. 이모지(🌙🪶🎒 등)를 절대 넣지 마세요 — 렌더러가 번호 배지를 그립니다. 이모지는 저품질로 보입니다.
11. heading 'xl'은 12자 이내의 짧고 강한 헤드라인 전용입니다. 문장형(예: "일상부터 하이킹까지 올라운드")은 'lg'를 쓰세요.

COPYWRITING RULES (카피 품질 — CVR 직결):
C0. 제품 이미지가 제공되면 반드시 실물을 관찰해 실제 색상·소재감·형태·디테일(지퍼·스트랩·장식·마감)을 카피에 구체적으로 반영하세요. 이미지에 보이지 않는 특징을 지어내지 마세요.
C1. 다음 추상 클리셰를 금지: "~의 여유", "어디에나 잘 어울리는", "특별한 일상", "지금 만나보세요", "당신의 모든 순간". 이런 표현이 떠오르면 구체적 사실로 바꾸세요.
C2. 모든 subtext/sublabel은 [구체 사용 상황] + [제품 팩트(수치·소재)] + [사용자 이득] 구조로. 예: "어디에나 잘 어울리는 데일리 톤" → "청바지·슬랙스 어디에도 무난한 웜 베이지".
C3. 입력의 수치·소재(무게·용량·원단명 등)를 최소 3개 섹션의 카피에 녹이고, "스마트폰보다 가벼운"처럼 실감나는 비교 앵커를 1개 이상 쓰세요.
C4. stat_row에는 진짜 임팩트 수치만. "색상 2종" 같은 무의미한 값은 stat_row가 아니라 option_grid로 표현하세요.
C5. 물리적 디테일 섹션을 1~2개 반드시 포함: 이미지에서 실제로 보이는 특징(지퍼·스트랩·수납·원단 텍스처·마감)을 골라 detail_closeup 슬롯 + image 블록 + 한 줄 팩트 설명으로 구성. 이미지에 없는 디테일은 만들지 마세요.

CONSISTENCY & PACING:
D1. 색상 내러티브: 대표 색상 1개를 정해 히어로·소재·착용 섹션은 그 색상 이미지만 쓰고, 두 색이 함께 나오는 곳은 컬러 비교 option_grid 단 한 곳으로 제한하세요.
D2. 텍스트만 있는 섹션을 2개 연속 배치하지 마세요. 각 섹션은 이미지·차트·stat·아이콘 중 최소 1개의 시각 앵커를 포함해야 합니다.

Return ONLY valid JSON array — no explanation, no code fences:
[section1, section2, ...]`;

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

  const { productInfo, analyzedSections, productImageCount, productImages } = parsed.data;
  const images: ClaudeImage[] = productImages.length > 0
    ? productImages
    : [];
  const imageCount = images.length || productImageCount;

  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0
      ? `Key points:\n${productInfo.points.map(p => `- ${p}`).join('\n')}`
      : '',
    imageCount > 0
      ? `제품 이미지 ${imageCount}장이 인덱스 0..${imageCount - 1}로 제공됩니다. 실물을 보고 색상·소재·디테일을 파악해 카피에 반영하고, 각 imageSlot의 imageRef에 그 슬롯에 가장 알맞은 이미지 인덱스를 지정하세요.`
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

    // 결정론적 정화(CJK 제거 + 무효/빈 블록 prune + 중복 제거)
    let cleaned = sanitizeProLayout(sections).sections;
    // error-severity 위반이 남으면 Claude로 1-pass 수리 후 재정화 (조건부)
    const { violations, isClean } = validateProLayout(cleaned);
    if (!isClean) {
      console.warn('[generate-pro-layout] 위반 발견, repair 실행:', violations.length);
      const repaired = await repairProLayout(cleaned, violations, {
        name: productInfo.name,
        points: productInfo.points,
        category: productInfo.category,
      });
      cleaned = sanitizeProLayout(repaired).sections;
    }
    return NextResponse.json({ success: true, sections: cleaned });
  } catch (error) {
    console.error('[generate-pro-layout] 오류:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `레이아웃 생성 실패: ${msg}` },
      { status: 500 }
    );
  }
}
