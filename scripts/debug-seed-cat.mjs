/**
 * Option B (카테고리 한정 검색) 결과 추정
 *  방식: 네이버 쇼핑 검색 결과 상위 100개의 카테고리 분포를 측정해서
 *       "전체 total × (특정 카테고리 비율)" 로 카테고리-한정 경쟁수를 추정.
 */

const shopId = process.env.NAVER_CLIENT_ID;
const shopSecret = process.env.NAVER_CLIENT_SECRET;

const KEYWORDS = [
  // 검색량 3k~30k 통과한 16개 (이전 디버그 결과)
  { kw: '수납함',      vol: 9450 },
  { kw: '정리함',      vol: 5840 },
  { kw: '발매트',      vol: 23370 },
  { kw: '방향제',      vol: 19160 },
  { kw: '수납정리함',   vol: 15270 },
  { kw: '서랍정리함',   vol: 6240 },
  { kw: '서류정리함',   vol: 4990 },
  { kw: '욕실발매트',   vol: 14030 },
  { kw: '차량방향제',   vol: 25970 },
  { kw: '펜트리수납함', vol: 6650 },
  { kw: '석고방향제',   vol: 7180 },
  { kw: '규조토발매트', vol: 17450 },
  { kw: '현관발매트',   vol: 4300 },
  { kw: '실내방향제',   vol: 15230 },
  { kw: '주방발매트',   vol: 8830 },
  { kw: '옷정리함',    vol: 10320 },
];

async function shopSearch(q, display = 100) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(q)}&display=${display}`;
  const r = await fetch(url, {
    headers: { 'X-Naver-Client-Id': shopId, 'X-Naver-Client-Secret': shopSecret },
  });
  if (!r.ok) return null;
  return r.json();
}

const stripTags = s => (s || '').replace(/<[^>]+>/g, '');

async function main() {
  console.log('키워드'.padEnd(14) + '검색량'.padStart(7) + '전체경쟁수'.padStart(13)
    + '주카테고리'.padStart(20) + '비율'.padStart(7) + '추정카테경쟁'.padStart(13) + '  결과(<500)');
  console.log('─'.repeat(95));

  let pass500 = 0, pass2000 = 0, pass5000 = 0;

  for (const { kw, vol } of KEYWORDS) {
    const j = await shopSearch(kw, 100);
    if (!j) { console.log(`${kw} - API 실패`); continue; }
    const total = j.total;
    const items = j.items || [];

    // 카테고리1+2 조합으로 그룹핑
    const catCount = new Map();
    for (const it of items) {
      const cat = `${it.category1 || '?'} > ${it.category2 || '?'}`;
      catCount.set(cat, (catCount.get(cat) || 0) + 1);
    }
    // 가장 많은 카테고리
    let topCat = '?'; let topN = 0;
    for (const [c, n] of catCount) if (n > topN) { topCat = c; topN = n; }
    const ratio = items.length > 0 ? topN / items.length : 0;
    const estCatTotal = Math.round(total * ratio);
    const tag = estCatTotal < 500 ? '✅ 통과'
      : estCatTotal < 2000 ? '🟡 <2000'
      : estCatTotal < 5000 ? '🟠 <5000'
      : '❌ 너무 많음';
    if (estCatTotal < 500) pass500++;
    if (estCatTotal < 2000) pass2000++;
    if (estCatTotal < 5000) pass5000++;

    console.log(
      kw.padEnd(14)
      + String(vol).padStart(7)
      + String(total).padStart(13)
      + topCat.padStart(20).slice(0, 20)
      + (Math.round(ratio * 100) + '%').padStart(7)
      + String(estCatTotal).padStart(13)
      + `  ${tag}`
    );
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n─'.repeat(60));
  console.log(`<500 통과: ${pass500} / 16`);
  console.log(`<2000 통과: ${pass2000} / 16`);
  console.log(`<5000 통과: ${pass5000} / 16`);
}

main().catch(console.error);
