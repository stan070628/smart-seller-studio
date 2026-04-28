/**
 * Layer 3: KIPRIS 상표 조회
 *
 * 공공데이터포털 KIPRIS API 연동
 * 상품명 첫 단어 추출 → 등록상표 조회
 * RISK / CAUTION / SAFE 처리
 */

import type { LegalIssue } from './types';

// 운영: KIPRIS_TRADEMARK_API_KEY 우선 (kipris-client.ts 컨벤션과 일치)
// 로컬: KIPRIS_API_KEY fallback (기존 .env.local 호환)
const KIPRIS_API_KEY =
  process.env.KIPRIS_TRADEMARK_API_KEY ||
  process.env.KIPRIS_API_KEY ||
  '';
const KIPRIS_BASE_URL = 'http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch';

// 상표 조회 제외 단어 (일반 명사, 조사 등)
const SKIP_WORDS = new Set([
  // 일반적인 상품 형태
  '세트', '팩', '매', '개', '장', '박스', '묶음', '대용량', '미니', '소형', '대형',
  // 수식어
  '프리미엄', '고급', '특가', '할인', '신상', '추천', '인기', '베스트',
  // 재질/형태
  '스테인리스', '실리콘', '플라스틱', '원목', '천연', '유기농',
  // 짧은 단어
  'the', 'new', 'my', 'pro', 'max',
]);

/**
 * 상품명에서 상표 검색 대상 단어 추출
 * 첫 번째 의미 있는 단어(브랜드명 가능성)를 반환
 */
export function extractBrandCandidate(title: string): string | null {
  // 괄호, 특수문자 제거 후 단어 분리
  const cleaned = title
    .replace(/\[[^\]]*\]/g, '') // [태그] 제거
    .replace(/\([^)]*\)/g, '')  // (설명) 제거
    .replace(/[^\w가-힣\s]/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);

  for (const word of words) {
    if (SKIP_WORDS.has(word.toLowerCase())) continue;
    // 숫자로만 구성된 단어 스킵
    if (/^\d+$/.test(word)) continue;
    // 단위(ml, kg 등) 스킵
    if (/^\d+(?:ml|kg|g|cm|mm|L|개|매|장)$/i.test(word)) continue;
    return word;
  }

  return null;
}

interface KiprisResult {
  applicationNumber: string;
  registrationNumber?: string;
  title: string;
  applicationStatus: string;
}

/**
 * KIPRIS API로 상표 검색
 */
async function searchTrademark(keyword: string): Promise<KiprisResult[]> {
  if (!KIPRIS_API_KEY) return [];

  const params = new URLSearchParams({
    searchString: keyword,
    ServiceKey: KIPRIS_API_KEY,
    numOfRows: '5',
    pageNo: '1',
  });

  try {
    const res = await fetch(`${KIPRIS_BASE_URL}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];

    const text = await res.text();

    // XML 파싱 (간이)
    const items: KiprisResult[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(text)) !== null) {
      const block = match[1];
      const appNo = block.match(/<applicationNumber>([^<]*)<\/applicationNumber>/)?.[1] ?? '';
      const regNo = block.match(/<registrationNumber>([^<]*)<\/registrationNumber>/)?.[1];
      const title = block.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
      const status = block.match(/<applicationStatus>([^<]*)<\/applicationStatus>/)?.[1] ?? '';

      if (appNo) {
        items.push({
          applicationNumber: appNo,
          registrationNumber: regNo,
          title,
          applicationStatus: status,
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

/**
 * 상품명에서 브랜드 후보를 추출하고 KIPRIS 상표 조회
 */
export async function checkTrademark(title: string): Promise<LegalIssue | null> {
  const candidate = extractBrandCandidate(title);
  if (!candidate) return null;

  const results = await searchTrademark(candidate);
  if (results.length === 0) return null;

  // 등록 상표가 있으면 CAUTION (YELLOW)
  const registered = results.find(
    (r) => r.applicationStatus === '등록' || r.applicationStatus.includes('등록'),
  );

  if (registered) {
    return {
      layer: 'trademark',
      severity: 'YELLOW',
      code: 'TRADEMARK_CAUTION',
      message: `등록상표 발견: '${candidate}' (출원번호: ${registered.applicationNumber})`,
      detail: {
        word: candidate,
        applicationNumber: registered.applicationNumber,
        registrationNumber: registered.registrationNumber ?? null,
        trademarkTitle: registered.title,
      },
    };
  }

  // 출원 중인 상표 → 참고 수준
  const pending = results.find(
    (r) => r.applicationStatus === '출원' || r.applicationStatus.includes('심사'),
  );

  if (pending) {
    return {
      layer: 'trademark',
      severity: 'YELLOW',
      code: 'TRADEMARK_PENDING',
      message: `출원 중인 상표 발견: '${candidate}' (출원번호: ${pending.applicationNumber})`,
      detail: {
        word: candidate,
        applicationNumber: pending.applicationNumber,
        trademarkTitle: pending.title,
      },
    };
  }

  return null;
}
