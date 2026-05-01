import crypto from 'node:crypto';

const apiKey = process.env.NAVER_AD_API_KEY;
const secretKey = process.env.NAVER_AD_SECRET_KEY;
const customerId = process.env.NAVER_AD_CUSTOMER_ID;

if (!apiKey || !secretKey || !customerId) {
  console.error('NAVER_AD_* 환경변수 누락');
  process.exit(1);
}

const SEEDS = ['수납함', '정리함', '욕실용품', '방향제', '발매트', '소품정리함'];
const EXPANSIONS = {
  '수납함': ['수납함', '다이소 수납함', '옷 수납함', '펜트리 수납함', '정리수납함', '트롤리 수납함'],
  '정리함': ['수납정리함', '옷정리함', '정리함', '다이소 정리함', '서랍 정리함', '서류정리함'],
  '방향제': ['차량용 방향제', '실내방향제', '방향제', '딥디크 방향제', '석고방향제', '차량 방향제'],
  '발매트': ['욕실발매트', '발매트', '규조토 발매트', '주방발매트', '현관발매트', '발매트 세탁'],
};

function buildSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

async function call(hintKeywords) {
  const timestamp = Date.now().toString();
  const path = '/keywordstool';
  const signature = buildSignature(timestamp, 'GET', path, secretKey);
  const query = hintKeywords.map(encodeURIComponent).join(',');
  const url = `https://api.searchad.naver.com${path}?hintKeywords=${query}&showDetail=1`;
  const res = await fetch(url, {
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': apiKey,
      'X-Customer': customerId,
      'X-Signature': signature,
    },
  });
  if (!res.ok) {
    console.log(`  ❌ ${res.status}: ${await res.text()}`);
    return [];
  }
  const json = await res.json();
  return (json.keywordList || []).map((k) => ({
    keyword: k.relKeyword,
    pc: k.monthlyPcQcCnt,
    mobile: k.monthlyMobileQcCnt,
    total: (typeof k.monthlyPcQcCnt === 'number' ? k.monthlyPcQcCnt : 0) +
           (typeof k.monthlyMobileQcCnt === 'number' ? k.monthlyMobileQcCnt : 0),
  }));
}

const normalize = (s) => s.replace(/\s+/g, '').toLowerCase();

async function main() {
  // 자동완성 확장 + seeds 모두 정규화하여 화이트리스트
  const ourSet = new Set();
  for (const seed of SEEDS) ourSet.add(normalize(seed));
  for (const list of Object.values(EXPANSIONS)) {
    for (const k of list) ourSet.add(normalize(k));
  }

  // 5개씩 배치로 API 호출
  const allKws = [...new Set([...SEEDS, ...Object.values(EXPANSIONS).flat()])];
  console.log(`총 입력 키워드: ${allKws.length}개`);

  const volMap = new Map();
  for (let i = 0; i < allKws.length; i += 5) {
    const batch = allKws.slice(i, i + 5);
    console.log(`\n--- batch [${i / 5 + 1}]: ${batch.join(', ')} ---`);
    const stats = await call(batch);
    console.log(`  API 응답: ${stats.length}개`);
    let hit = 0;
    for (const s of stats) {
      const n = normalize(s.keyword);
      if (ourSet.has(n) && !volMap.has(n)) {
        volMap.set(n, { keyword: s.keyword, total: s.total });
        hit++;
      }
    }
    console.log(`  화이트리스트 매칭: ${hit}개`);
  }

  console.log('\n=== 우리 키워드 검색량 매칭 결과 ===');
  for (const [, v] of volMap) {
    const inRange = v.total >= 3000 && v.total <= 30000 ? '✅ 통과' : (v.total > 30000 ? '⬆️ 초과' : '⬇️ 미달');
    console.log(`${v.keyword.padEnd(20)} ${String(v.total).padStart(7)}  ${inRange}`);
  }

  const passing = [...volMap.values()].filter(v => v.total >= 3000 && v.total <= 30000);
  console.log(`\n3k-30k 통과: ${passing.length}개 / ${volMap.size}개`);
}

main().catch(console.error);
