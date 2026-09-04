/**
 * 오스트레일리안 보태니컬 비누 4개입 — PRO 레이아웃을 앱 생성 엔진으로 뽑는다 (2026-09-05).
 *
 * 시나리오 v2(스펙 docs/superpowers/specs/2026-09-04-detail-page-polish-design.md):
 * 기프트 박스가 실제 배송 구성이므로 **선물이 1축**이고 밀봉·대용량이 그 근거다.
 *
 * 🔴 이 상품에 걸린 제약
 *   · 효능 주장 금지(습진·아토피·트러블 개선) — 화장품 표시광고 위반
 *   · 고트밀크 함량·"100% 천연" 금지 — 아마존에서 실제 허위광고 항의가 있었다
 *   · 향 과장 금지 — 최다 비판 리뷰가 "향 기대 불일치"다. "은은한 편"으로 솔직하게
 *   · "트리플 밀드" 금지 — 국내 표기에 없다
 *   · 소비기한·제조번호 금지 — 매입 로트마다 바뀐다
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CLAUDE_SYSTEM } from '@/app/api/ai/generate-pro-layout/system-prompt';
import { callClaudeVision, type ClaudeImage } from '@/lib/ai/claude-cli';
import { sanitizeProLayout, validateProLayout } from '@/lib/detail-page/layout-validator';
import { repairProLayout } from '@/lib/ai/repair-pro-layout';
import { riskyClaimWarnings } from '@/lib/detail-page/risky-claims';

const SRC = '/Volumes/Mac_SSD/Seller/보테니컬 비누';
const OUT = '/Volumes/Mac_SSD/Seller/26.09월/보태니컬 비누 리뉴얼';

/** 인덱스 = 프롬프트의 imageRef. 순서를 바꾸면 AI가 지정한 참조가 어긋난다. */
const FILES = [
  `${SRC}/thumb_v3/v3_A_square1500.jpg`, // 0 기프트 박스 정면(창으로 4종이 보임)
  `${SRC}/IMG_3619.JPG`,                 // 1 낱개 비닐 밀봉 4종
  `${SRC}/IMG_2912.JPG`,                 // 2 원박스 라벨(향 4종 성분·중량 표기)
];

/** [[상세페이지 카피 문체 규칙]] 12개 — 검수가 아니라 생성 프롬프트에 넣는다. */
const COPY_RULES = `
## 카피 문체 규칙 — 12개 전부 지키세요 (위반이 실제 반려 사유였습니다)
1. 소리 내 읽어 걸리면 다시 씁니다. 「몇을 고르면 되나」 ❌ → 「평소 쓰던 대로」
2. 부정문으로 시작하지 않습니다. 「A가 아닌 B」보다 「B」를 먼저 말합니다.
3. 뜻이 모호한 관용구를 제목에 쓰지 않습니다.
4. 직역투를 쓰지 않습니다. 「프린트가 자리합니다」 ❌ → 「들어가 있습니다」
5. 굳이 외래어를 쓰지 않습니다. 「레터링」 ❌ → 「글자」
6. 한 문장에 같은 단어를 두 번 넣지 않습니다.
7. 주어와 서술어를 맞춥니다.
8. 무엇이 그러한지 빠뜨리지 않습니다. 「두 겹이라 덜 드러남」 ❌ → 「두 겹이라 속이 덜 비침」
9. 개조식과 경어체를 섞지 않습니다.
10. 판매자 내부 사정을 본문에 쓰지 않습니다(재고·작업 경위·도구 사정).
11. 어려운 한자어·전문어를 쓰지 않습니다. 산패·혼탁·입자·특이체질 ❌ → 쉬운 말로.
12. 한국에서 그렇게 말하지 않는 표현을 쓰지 않습니다. 직역투가 아니어도 입에 안 붙으면 걸립니다.

## 구조 층위 AI 냄새 — 이것들이 있으면 "쇼핑몰"이 아니라 "AI가 쓴 문서"로 읽힙니다
1. 「첫 번째 고민, 두 번째 고민」식 넘버링 나열 금지. 고민은 장면으로, 장점은 소제목으로.
2. divider 블록 금지. 섹션 전환은 bgStyle 교대로 만드세요.
3. 의미 없는 아이콘 금지. icon_grid의 icon은 항목 뜻에 맞는 키만, 없으면 빈 문자열.
4. 항목마다 다른 것을 말하는데 시각 요소가 전부 같으면 기계 생성 티가 납니다.
`.trim();

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

const images: ClaudeImage[] = [];
for (const f of FILES) {
  const buf = await sharp(f).resize({ width: 900 }).jpeg({ quality: 82 }).toBuffer();
  images.push({ base64: buf.toString('base64'), mimeType: 'image/jpeg' });
}
console.log(`이미지 ${images.length}장 · ${(images.reduce((a, i) => a + i.base64.length, 0) / 1024 / 1024).toFixed(1)}MB`);

const productInfo = {
  name: '오스트레일리안 보태니컬 비누 4개입 선물세트',
  category: '화장품/미용 > 바디케어 > 비누',
  points: [
    '구성: 향 4종 각 1개 — 고트밀크 위드 소야빈 오일, 피치스 앤 크림, 릴리필리 위드 와틀씨드 익스트랙트, 허니 앤 밀크',
    '개당 200g (총 800g)',
    '창이 있는 흰색 기프트 박스 + 마끈 리본 + "Thank you" 태그 포장으로 배송',
    '각 비누는 낱개 비닐로 밀봉되어 있다',
    '원산지 호주, 제조사 네츄럴 리소시즈 오스트레일리아, 수입 코스트코 코리아',
    'SLS(소듐라우릴설페이트) 무첨가',
    '모든 피부 타입 사용 가능',
    '사용기한 제조일로부터 36개월',
    '사용법: 충분히 문질러 거품을 낸 후 원을 그리듯 마사지하여 물로 씻어낼 것',
    '비누 표면에 향 이름이 각인되어 있다',
    '식물성 오일 베이스, 시어버터 함유',
  ],
};

const userPrompt = [
  `Product: "${productInfo.name}"`,
  `Category: ${productInfo.category}`,
  `Key points:\n${productInfo.points.map((p) => `- ${p}`).join('\n')}`,
  ``,
  `실물 사진 3장이 인덱스 0..2로 제공됩니다.`,
  `0 = 기프트 박스 정면(흰 박스, 창으로 비누 4종이 보이고 마끈 리본과 Thank you 태그가 달려 있음)`,
  `1 = 낱개 비닐로 밀봉된 비누 4개(각인이 보임: HONEY & MILK, GOATS MILK, LILY PILLY, PEACHES & CREAM)`,
  `2 = 원박스 뒷면 라벨(향 4종의 성분·중량 표기)`,
  ``,
  `## 이 페이지의 서사 — 반드시 이 순서로`,
  `이 상품은 **답례품·집들이·감사 선물**로 파는 것이 1축입니다. 포장이 이미 완성돼 있다는 사실이 가장 큰 차별점입니다.`,
  `1. hook — 선물로 건네는 장면. 기프트 박스 실물(imageRef 0)을 크게. 헤드라인은 12자 내외로 강하게.`,
  `2. problem — 답례품 고르기의 고민: 부담스럽지 않으면서 성의 있어 보여야 하고, 받는 사람 취향을 모른다. 넘버링 나열 금지.`,
  `3. solution — 향 4종 구성 + 포장 완비. 고를 필요도, 따로 포장할 필요도 없다.`,
  `4. option — 향 4종을 option_grid로. 취향 문제의 답이 여기서 닫힙니다.`,
  `5. evidence — 개당 200g 대용량 · 호주산 · 시어버터 · SLS 무첨가를 icon_grid로.`,
  `6. compare — columns 2단: 한 봉지에 담긴 멀티팩(기존 방식) vs 낱개 밀봉 + 기프트 박스(우리). 포장 방식의 차이만 말하고 효과 비교는 하지 마세요.`,
  `7. usecase — **받은 뒤에도 오래 새것**: 하나 쓰는 동안 나머지 셋은 밀봉된 채라 향이 날아가지 않는다. 200g씩 4개면 몇 달을 쓴다. imageRef 1 사용.`,
  `   🔴 "4개를 하나씩 나눠 준다"고 쓰지 마세요 — 박스째 건네는 선물이라 앞뒤가 맞지 않습니다.`,
  `8. usecase — 거품과 사용감. 뽀득하게 씻기지만 당기지 않는다. 온 가족이 쓸 수 있다.`,
  `9. care — 오래 쓰는 법: 물이 고이지 않는 받침에 두기.`,
  `10. notice — 스펙 표(구성·중량·원산지·사용기한)와 사용 시 주의사항.`,
  ``,
  `## 이 상품에만 걸린 제약 — 반드시 지키세요`,
  `1. 효능·효과를 주장하지 마세요. 습진·아토피·트러블·피부 개선·보습 효과 입증 같은 표현은 화장품 표시광고 위반입니다. "순하다", "당기지 않는다"까지만 씁니다.`,
  `2. 고트밀크 등 성분 함량을 수치로 쓰지 마세요. "100% 천연"·"무해" 같은 표현도 금지입니다.`,
  `3. 향을 과장하지 마세요. 실제 사용자들이 "향이 은은한 편"이라고 말합니다. "진한 향", "온 집안에 퍼지는" 같은 표현은 반품 사유가 됩니다.`,
  `4. "트리플 밀드"를 쓰지 마세요 — 국내 표기에 없습니다.`,
  `5. 소비기한·제조번호처럼 매입 시점마다 바뀌는 값을 넣지 마세요.`,
  `6. 사진에 없는 것을 지어내지 마세요. 박스는 흰색이고 리본은 마끈이며 태그에는 "Thank you"가 손글씨로 적혀 있습니다.`,
  ``,
  `## 이미지 슬롯`,
  `실물 사진이 3장뿐이므로 부족한 자리는 slotType "flux_lifestyle"(연출 씬) 또는 "detail_closeup"(접사) 슬롯으로 만들고 promptHint를 쓰세요.`,
  `promptHint에는 [장면] + [앵글] + [거리] + [조명]을 반드시 넣으세요.`,
  `인물이 등장하는 씬은 손과 팔 위주로, 표정이 드러나지 않게 구성하세요.`,
  ``,
  `섹션 수: 10개.`,
  ``,
  COPY_RULES,
].join('\n');

console.log('Claude 비전 호출 중…');
const text = await callClaudeVision(CLAUDE_SYSTEM, userPrompt, images, 'opus', 16000);
console.log('응답 길이', text.length);

const jsonStr = extractJsonArray(text);
if (!jsonStr) { console.error('🔴 JSON 배열 없음:', text.slice(0, 400)); process.exit(1); }

const raw = JSON.parse(jsonStr) as unknown[];
console.log(`생성 섹션 ${raw.length}개`);

const layoutOpts = {
  statHygiene: true, narrative: true,
  provenanceSource: productInfo.points.join(' '),
  maxSections: 10,
};

let cleaned = sanitizeProLayout(raw, layoutOpts).sections;
let v = validateProLayout(cleaned, layoutOpts);
console.log(`1차 검증: isClean=${v.isClean} · 위반 ${v.violations.length}건`);
for (const x of v.violations) console.log(`  [${x.severity}] ${x.code} — ${x.message}`);

if (!v.isClean) {
  console.log('repair 실행…');
  const repaired = await repairProLayout(cleaned, v.violations, {
    name: productInfo.name, points: productInfo.points, category: productInfo.category,
  });
  cleaned = sanitizeProLayout(repaired, layoutOpts).sections;
  v = validateProLayout(cleaned, layoutOpts);
  console.log(`repair 후: isClean=${v.isClean} · 위반 ${v.violations.length}건`);
  for (const x of v.violations) console.log(`  [${x.severity}] ${x.code} — ${x.message}`);
}

const risky = riskyClaimWarnings(cleaned);
if (risky.length) { console.log('⚠️ 위험 표현 경고'); for (const r of risky) console.log('  ', r); }

// 개선 파이프라인 점검 — 구조 층위 AI 냄새가 실제로 사라졌는지 센다.
const json = JSON.stringify(cleaned);
const dividerCount = (json.match(/"type":"divider"/g) ?? []).length;
const iconKeys = [...json.matchAll(/"icon":"([^"]+)"/g)].map((m) => m[1]);
const bgStyles = (cleaned as Array<{ content?: { bgStyle?: string } }>).map((s) => s.content?.bgStyle ?? 'white');
console.log(`\n[개선 점검] divider ${dividerCount}개(목표 0) · 선형 아이콘 ${iconKeys.length}개 사용: ${iconKeys.join(', ') || '(없음)'}`);
console.log(`[개선 점검] bgStyle 리듬: ${bgStyles.join(' → ')}`);

writeFileSync(path.join(OUT, 'soap_layout.json'), JSON.stringify(cleaned, null, 2));
console.log('\n저장:', path.join(OUT, 'soap_layout.json'));
