import crypto from 'node:crypto';

const adKey = process.env.NAVER_AD_API_KEY;
const adSecret = process.env.NAVER_AD_SECRET_KEY;
const adCustomer = process.env.NAVER_AD_CUSTOMER_ID;
const shopId = process.env.NAVER_CLIENT_ID;
const shopSecret = process.env.NAVER_CLIENT_SECRET;

const SEEDS = ['수납함', '정리함', '욕실용품', '방향제', '발매트', '소품정리함'];
const SUGGESTIONS = {
  '수납함': ['수납함','다이소 수납함','옷 수납함','펜트리 수납함','정리수납함','트롤리 수납함'],
  '정리함': ['수납정리함','옷정리함','정리함','다이소 정리함','서랍 정리함','서류정리함'],
  '욕실용품': ['욕실용품','욕실용품정리','호텔욕실용품','일본욕실용품','욕실용품도매','욕실용품세트'],
  '방향제': ['차량용 방향제','실내방향제','방향제','딥디크 방향제','석고방향제','차량 방향제'],
  '발매트': ['욕실발매트','발매트','규조토 발매트','주방발매트','현관발매트','발매트 세탁'],
  '소품정리함': ['소품정리함','다이소 소품정리함','소품 정리함 투명','소품정리함 2단','소품 정리함 원목','소품정리함 패브릭'],
};

const sig = (ts, m, p, s) => crypto.createHmac('sha256', s).update(`${ts}.${m}.${p}`).digest('base64');

async function adCall(hints) {
  const ts = Date.now().toString();
  const path = '/keywordstool';
  const url = `https://api.searchad.naver.com${path}?hintKeywords=${hints.map(encodeURIComponent).join(',')}&showDetail=1`;
  const r = await fetch(url, {
    headers: { 'X-Timestamp': ts, 'X-API-KEY': adKey, 'X-Customer': adCustomer, 'X-Signature': sig(ts, 'GET', path, adSecret) },
  });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.keywordList || []).map(k => ({ keyword: k.relKeyword, total: (k.monthlyPcQcCnt|0) + (k.monthlyMobileQcCnt|0) }));
}

async function shopCall(q) {
  const r = await fetch(`https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(q)}&display=1`, {
    headers: { 'X-Naver-Client-Id': shopId, 'X-Naver-Client-Secret': shopSecret },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.total;
}

const norm = s => s.replace(/\s+/g,'').toLowerCase();

async function main() {
  // 자동완성 합집합
  const ourSet = new Set();
  for (const list of Object.values(SUGGESTIONS)) for (const k of list) ourSet.add(norm(k));
  for (const s of SEEDS) ourSet.add(norm(s));

  const volMap = new Map();
  const hintSeeds = SEEDS.map(s => s.replace(/\s+/g,''));
  for (let i = 0; i < hintSeeds.length; i += 5) {
    const stats = await adCall(hintSeeds.slice(i, i+5));
    for (const s of stats) {
      const n = norm(s.keyword);
      if (ourSet.has(n) && !volMap.has(n)) volMap.set(n, { keyword: s.keyword, vol: s.total });
    }
    if (i + 5 < hintSeeds.length) await new Promise(r => setTimeout(r, 400));
  }

  const passVolume = [...volMap.values()].filter(v => v.vol >= 3000 && v.vol <= 30000);
  console.log(`\n=== Step 1: 검색량 필터 ===`);
  console.log(`매칭된 키워드: ${volMap.size}개 / 그중 3k~30k 통과: ${passVolume.length}개\n`);

  console.log(`=== Step 2: 네이버 쇼핑 경쟁상품수 (<500 필터) ===`);
  console.log('키워드'.padEnd(20) + '검색량'.padStart(8) + '경쟁상품수'.padStart(12) + '  결과');
  console.log('─'.repeat(60));

  let pass = 0;
  for (const v of passVolume) {
    const cnt = await shopCall(v.keyword);
    const passed = cnt !== null && cnt < 500;
    if (passed) pass++;
    const tag = cnt === null ? '❌ API 실패'
      : cnt < 500 ? '✅ 통과'
      : cnt < 2000 ? '⚠️ <2000 (느슨하게 하면 통과)'
      : '❌ 경쟁 너무 많음';
    console.log(v.keyword.padEnd(20) + String(v.vol).padStart(8) + String(cnt ?? 'N/A').padStart(12) + `  ${tag}`);
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`\n최종 통과: ${pass}개 / ${passVolume.length}개`);
}

main().catch(console.error);
