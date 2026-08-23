/**
 * 로켓그로스 상품의 이미지·상세를 API로 교체한다.
 *
 * 로켓그로스 상품은 마켓플레이스 상품과 수정 경로가 다르다. 조회 응답을 그대로
 * 되돌리면 반드시 400이 나고, `approvals`로는 승인 복귀도 되지 않는다.
 * 위키 [[쿠팡 상품 등록 API 규격]] 「로켓그로스 동시 운영 상품은 수정 경로가 다르다」
 * (2026-08-18 / 08-19 실측)를 그대로 구현한 것이다.
 *
 *   ① `legalAgreement: "AGREE"`가 없으면
 *      `로켓그로스 입고 불가 조건을 확인하시고 동의해주세요`로 거부된다.
 *      결정적인 자리는 조회 응답과 같은 이름인 `rocketGrowthAdditionalInformation`이며,
 *      나머지 세 자리가 불필요한지는 미확정이라 네 곳 모두 넣는다.
 *   ② `PUT .../approvals`는 로켓상품에 차단된다
 *      (`현재 Open API에서는 로켓상품 관련 기능을 제공하지 않습니다`).
 *      `requested: true`를 얹어 PUT하면 수정과 승인이 한 번에 처리된다.
 *      빠뜨리면 상태가 `승인완료` → `임시저장`으로 내려앉아 교체본이 노출되지 않는다.
 *   ③ 로켓그로스 필드는 신청하지 않아도 승인 후 쿠팡이 붙인다.
 *      「이 상품은 로켓그로스가 아니다」라는 판단은 승인 시점에 뒤집히므로
 *      이 스크립트는 필드 유무와 무관하게 항상 동의 값을 넣는다.
 *
 * 실패한 PUT은 상품을 바꾸지 않는다. 그래도 `--apply` 없이 한 번 돌려
 * 무엇이 바뀌는지 보고 나서 반영하는 것을 기본으로 한다.
 *
 * 사용법:
 *   node --experimental-strip-types --env-file=.env.local \
 *     --import ./scripts/_ao_register.mjs scripts/coupang-rg-update.ts \
 *     --id 16239466971 \
 *     --images "https://…/a.jpg,https://…/b.jpg" \
 *     --detail /path/to/snippet.html \
 *     [--apply]
 *
 *   --id      필수. sellerProductId
 *   --images  선택. 쉼표 구분 URL. 첫 번째가 REPRESENTATION, 나머지가 DETAIL.
 *             쿠팡 제한으로 URL은 200자 이내여야 한다.
 *   --detail  선택. 상세 HTML 파일 경로(body 조각).
 *   --apply   없으면 점검만 하고 PUT하지 않는다.
 *
 * 주의: 쿠팡 PUT은 `<style>` 블록과 `data-*` 속성을 걷어낸다. 배색·여백은
 *       인라인 style 속성으로 넣어야 살아남는다 → [[채널별 상세 HTML 주입]]
 */
import { readFileSync } from 'node:fs';
import { getCoupangClient } from '@/lib/listing/coupang-client';

const AGREE = 'AGREE';
const MAX_IMAGE_URL = 200;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const idRaw = arg('id');
if (!idRaw) {
  console.error('--id <sellerProductId>는 필수입니다.');
  process.exit(1);
}
const ID = Number(idRaw);
const APPLY = process.argv.includes('--apply');
const imageUrls = (arg('images') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const detailPath = arg('detail');

const c = getCoupangClient();
const fetched = (await c.getProductDetail(ID)) as any;
const payload = structuredClone(fetched?.data ?? fetched);
const it = payload.items?.[0];
if (!it) {
  console.error('items[0]을 찾지 못했습니다. 상품 ID를 확인하세요.');
  process.exit(1);
}

console.log('■ 현재 상태');
console.log('  상품명    :', payload.sellerProductName);
console.log('  상태      :', payload.statusName);
console.log('  옵션 수   :', payload.items.length);
console.log('  이미지    :', it.images?.length ?? 0, '장');
console.log('  상세 길이 :', String(it.contents?.[0]?.contentDetails?.[0]?.content ?? '').length, '자');
console.log('  로켓그로스:', payload.rocketGrowthAdditionalInformation ? '필드 있음' : '필드 없음 (승인 후 붙을 수 있음)');

// ── 이미지 교체 ────────────────────────────────────────────────
if (imageUrls.length) {
  const tooLong = imageUrls.filter((u) => u.length > MAX_IMAGE_URL);
  if (tooLong.length) {
    console.error(`\n🔴 이미지 URL이 ${MAX_IMAGE_URL}자를 넘습니다 (${tooLong.length}건). 경로를 줄이세요.`);
    for (const u of tooLong) console.error(`   ${u.length}자 ${u}`);
    process.exit(1);
  }
  it.images = imageUrls.map((url, i) => ({
    imageOrder: i,
    imageType: i === 0 ? 'REPRESENTATION' : 'DETAIL',
    vendorPath: url,
  }));
  console.log(`\n  → 이미지 ${imageUrls.length}장으로 교체 (대표 1 + 추가 ${imageUrls.length - 1})`);
}

// ── 상세 교체 ──────────────────────────────────────────────────
if (detailPath) {
  const html = readFileSync(detailPath, 'utf8');
  it.contents = [{
    contentsType: it.contents?.[0]?.contentsType ?? 'HTML',
    contentDetails: [{ content: html, detailType: 'TEXT' }],
  }];
  console.log(`  → 상세 ${html.length}자로 교체 (${detailPath})`);
}

if (!imageUrls.length && !detailPath) {
  console.log('\n바꿀 것이 없습니다. --images 또는 --detail을 주세요.');
  process.exit(0);
}

// ── 로켓그로스 필수 처리 ───────────────────────────────────────
payload.rocketGrowthAdditionalInformation = {
  ...(payload.rocketGrowthAdditionalInformation ?? {}),
  legalAgreement: AGREE,
};
payload.additionalInformationForRocketGrowth = {
  ...(payload.additionalInformationForRocketGrowth ?? payload.rocketGrowthAdditionalInformation),
  legalAgreement: AGREE,
};
payload.legalAgreement = AGREE;
for (const item of payload.items) item.legalAgreement = AGREE;
payload.requested = true; // 수정과 승인을 한 번에 — approvals는 로켓상품에서 400이다

console.log('\n■ 로켓그로스 처리');
console.log('  legalAgreement : 최상위 · item · rocketGrowthAdditionalInformation · additionalInformationForRocketGrowth');
console.log('  requested      : true (승인 강등 방지)');

if (!APPLY) {
  console.log('\n[점검만] --apply를 붙이면 PUT합니다.');
  process.exit(0);
}

try {
  await c.updateProduct(ID, payload);
  console.log('\n✅ PUT 성공');
} catch (e) {
  console.log('\n🔴 PUT 실패:', (e as Error).message);
}

// 성공 응답만 믿지 않는다 — 반드시 재조회로 확인한다
await new Promise((r) => setTimeout(r, 6000));
const after = (await c.getProductDetail(ID)) as any;
const ap = after?.data ?? after;
const cur = ap.items[0];
console.log('\n■ 재조회 검증');
console.log('  상태      :', ap.statusName, ap.statusName === '승인완료' ? '✅' : '🔴 임시저장이면 requested 처리를 확인하세요');
console.log('  이미지    :', cur.images.length, '장 —', cur.images.map((i: any) => i.imageType).join(', '));
console.log('  상세 길이 :', String(cur.contents?.[0]?.contentDetails?.[0]?.content ?? '').length, '자');
console.log('  searchTags:', cur.searchTags?.length, '개 | 고시정보:', cur.notices?.length, '건');
