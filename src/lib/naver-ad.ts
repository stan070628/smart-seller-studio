import crypto from 'crypto';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface KeywordStat {
  keyword: string;
  searchVolume: number | null;
  competitorCount: number | null;
}

interface NaverAdKeywordItem {
  relKeyword: string;
  monthlyPcQcCnt: number;
  monthlyMobileQcCnt: number;
}

// ─── HMAC-SHA256 서명 ────────────────────────────────────────────────────────

/**
 * 네이버 검색광고 API 요청에 필요한 HMAC-SHA256 서명을 생성한다.
 * 서명 메시지 형식: {timestamp}.{METHOD}.{path}
 */
export function buildSignature(
  timestamp: string,
  method: string,
  path: string,
  secretKey: string,
): string {
  const message = `${timestamp}.${method.toUpperCase()}.${path}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

// ─── 응답 파서 ───────────────────────────────────────────────────────────────

/**
 * 검색광고 API의 keywordList 응답에서 PC + 모바일 월 검색량을 합산하여 추출한다.
 * 잘못된 형식의 응답은 빈 배열로 안전하게 처리한다.
 */
export function parseKeywordStats(
  raw: unknown,
): { keyword: string; searchVolume: number }[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.keywordList)) return [];
  return (data.keywordList as NaverAdKeywordItem[])
    .filter(
      (k) =>
        typeof k?.relKeyword === 'string' &&
        typeof k?.monthlyPcQcCnt === 'number' &&
        typeof k?.monthlyMobileQcCnt === 'number',
    )
    .map((k) => ({
      keyword: k.relKeyword,
      searchVolume: k.monthlyPcQcCnt + k.monthlyMobileQcCnt,
    }));
}

// ─── 검색광고 API 호출 ───────────────────────────────────────────────────────

/**
 * 네이버 검색광고 API를 호출하여 키워드별 월 검색량(PC + 모바일)을 조회한다.
 * 환경변수(NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY, NAVER_AD_CUSTOMER_ID)가 없으면
 * 빈 Map을 반환하여 호출 측에서 null로 처리하도록 위임한다.
 */
export async function fetchSearchVolumes(
  keywords: string[],
): Promise<Map<string, number>> {
  const apiKey = process.env.NAVER_AD_API_KEY;
  const secretKey = process.env.NAVER_AD_SECRET_KEY;
  const customerId = process.env.NAVER_AD_CUSTOMER_ID;

  if (!apiKey || !secretKey || !customerId) {
    return new Map();
  }

  const timestamp = Date.now().toString();
  const path = '/keywordstool';
  const signature = buildSignature(timestamp, 'GET', path, secretKey);
  const query = keywords.map(encodeURIComponent).join(',');

  const res = await fetch(
    `https://api.searchad.naver.com${path}?hintKeywords=${query}&showDetail=1`,
    {
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': apiKey,
        'X-Customer': customerId,
        'X-Signature': signature,
      },
    },
  );

  if (!res.ok) return new Map();

  const json = await res.json();
  const stats = parseKeywordStats(json);
  return new Map(stats.map((s) => [s.keyword, s.searchVolume]));
}

// ─── 네이버 쇼핑 경쟁 상품수 조회 ───────────────────────────────────────────

/**
 * 네이버 쇼핑 검색 API를 호출하여 키워드별 경쟁 상품수를 조회한다.
 * 각 키워드를 병렬 요청하고, 실패한 키워드는 Map에서 제외하여 null로 처리한다.
 * 환경변수(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)가 없으면 빈 Map을 반환한다.
 */
export async function fetchCompetitorCounts(
  keywords: string[],
): Promise<Map<string, number>> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) return new Map();

  const results = await Promise.allSettled(
    keywords.map(async (kw) => {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(kw)}&display=1`,
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
        },
      );
      if (!res.ok) return [kw, null] as const;
      const json = await res.json();
      return [kw, typeof json.total === 'number' ? json.total : null] as const;
    }),
  );

  const map = new Map<string, number>();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value[1] !== null) {
      map.set(r.value[0], r.value[1]);
    }
  }
  return map;
}

// ─── 통합 조회 ───────────────────────────────────────────────────────────────

/**
 * 검색량과 경쟁 상품수를 병렬로 조회한 뒤 KeywordStat[] 형태로 합산하여 반환한다.
 * 어느 한쪽 API가 실패해도 나머지 데이터는 정상 반환하고, 실패한 항목은 null로 표시한다.
 */
export async function getKeywordStats(keywords: string[]): Promise<KeywordStat[]> {
  const [volumeMap, competitorMap] = await Promise.allSettled([
    fetchSearchVolumes(keywords),
    fetchCompetitorCounts(keywords),
  ]);

  const vMap = volumeMap.status === 'fulfilled' ? volumeMap.value : new Map<string, number>();
  const cMap = competitorMap.status === 'fulfilled' ? competitorMap.value : new Map<string, number>();

  return keywords.map((kw) => ({
    keyword: kw,
    searchVolume: vMap.get(kw) ?? null,
    competitorCount: cMap.get(kw) ?? null,
  }));
}

// ─── 씨드 기반 키워드 확장 ──────────────────────────────────────────────────

// Naver 검색광고 API /keywordstool의 hintKeywords 최대 허용 개수
const AD_BATCH_SIZE = 5;

/**
 * 씨드 키워드를 hintKeywords로 전달해 Naver 검색광고 API가 반환하는
 * 관련 키워드 전체(씨드 포함)를 검색량 + 경쟁상품수와 함께 반환한다.
 */
export async function expandKeywords(seeds: string[]): Promise<KeywordStat[]> {
  const apiKey = process.env.NAVER_AD_API_KEY;
  const secretKey = process.env.NAVER_AD_SECRET_KEY;
  const customerId = process.env.NAVER_AD_CUSTOMER_ID;

  if (!apiKey || !secretKey || !customerId) return [];

  // Naver AD API는 공백 포함 키워드를 거부(400)하므로 공백을 제거한다.
  const normalizedSeeds = seeds.map((s) => s.replace(/\s+/g, ''));

  const batches: string[][] = [];
  for (let i = 0; i < normalizedSeeds.length; i += AD_BATCH_SIZE) {
    batches.push(normalizedSeeds.slice(i, i + AD_BATCH_SIZE));
  }

  const adPath = '/keywordstool';
  const batchResults = await Promise.allSettled(
    batches.map(async (batch) => {
      const timestamp = Date.now().toString();
      const signature = buildSignature(timestamp, 'GET', adPath, secretKey);
      const query = batch.map(encodeURIComponent).join(',');
      const res = await fetch(
        `https://api.searchad.naver.com${adPath}?hintKeywords=${query}&showDetail=1`,
        {
          headers: {
            'X-Timestamp': timestamp,
            'X-API-KEY': apiKey,
            'X-Customer': customerId,
            'X-Signature': signature,
          },
        },
      );
      if (!res.ok) return [];
      return parseKeywordStats(await res.json());
    }),
  );

  const volumeMap = new Map<string, number>();
  for (const r of batchResults) {
    if (r.status === 'fulfilled') {
      for (const s of r.value) {
        if (!volumeMap.has(s.keyword)) {
          volumeMap.set(s.keyword, s.searchVolume);
        }
      }
    }
  }

  if (volumeMap.size === 0) return [];

  // Shopping API는 키워드당 1건 요청이므로 검색량 기준으로 상위 50개만 선별 후 호출한다.
  // 전체(최대 1200개) 병렬 요청은 Naver API rate limit으로 대부분 실패한다.
  const candidateKeywords = Array.from(volumeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([kw]) => kw);

  const competitorMap = await fetchCompetitorCounts(candidateKeywords).catch(
    () => new Map<string, number>(),
  );

  return candidateKeywords.map((kw) => ({
    keyword: kw,
    searchVolume: volumeMap.get(kw) ?? null,
    competitorCount: competitorMap.get(kw) ?? null,
  }));
}
