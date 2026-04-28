/**
 * sourcing-links.ts
 * 키워드 기반 소싱 플랫폼 검색 URL 생성 유틸리티
 *
 * 순수 함수 — 외부 의존성 zero, 네트워크 호출 zero
 */

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

export type SourcingPlatform =
  | '1688'
  | 'taobao'
  | 'aliexpress'
  | 'coupang';

export interface SourcingLink {
  platform: SourcingPlatform;
  label: string;
  url: string;
  color: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 플랫폼별 URL 빌더 (상수 분리 — URL 패턴 변경 시 한 곳만 수정)
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<
  SourcingPlatform,
  {
    label: string;
    color: string;
    description: string;
    buildUrl: (query: string) => string;
  }
> = {
  '1688': {
    label: '1688',
    color: '#FF6A00',
    description: '중국 최대 도매 플랫폼',
    buildUrl: (q) =>
      `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(q)}`,
  },
  taobao: {
    label: '타오바오',
    color: '#FF5000',
    description: '중국 최대 소매 플랫폼',
    buildUrl: (q) =>
      `https://s.taobao.com/search?q=${encodeURIComponent(q)}`,
  },
  aliexpress: {
    label: '알리익스프레스',
    color: '#E43225',
    description: '글로벌 직구 플랫폼',
    buildUrl: (q) =>
      `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`,
  },
  coupang: {
    label: '쿠팡',
    color: '#BE0014',
    description: '로켓배송 여부 직접 확인',
    buildUrl: (q) =>
      `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(q)}`,
  },
};

// 플랫폼 표시 순서 (소싱 워크플로우 기준)
const PLATFORM_ORDER: SourcingPlatform[] = [
  '1688',
  'taobao',
  'aliexpress',
  'coupang',
];

// ─────────────────────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 주어진 검색어로 각 플랫폼의 검색 URL을 생성한다.
 *
 * - 중국 플랫폼(1688, 타오바오): chineseQuery가 있으면 사용, 없으면 koreanQuery
 * - 알리익스프레스: 항상 koreanQuery (영문/한글 검색 지원)
 * - 쿠팡: 항상 koreanQuery (경쟁 확인용)
 *
 * @param koreanQuery   한국어 원문 키워드
 * @param chineseQuery  (선택) 중국어 변환 검색어
 */
export function generateSourcingLinks(
  koreanQuery: string,
  chineseQuery?: string,
): SourcingLink[] {
  return PLATFORM_ORDER.map((platform) => {
    const config = PLATFORM_CONFIG[platform];

    // 중국 플랫폼은 중국어 검색어 우선, 없으면 한국어
    const useChineseQuery = (platform === '1688' || platform === 'taobao') && chineseQuery;
    const query = useChineseQuery ? chineseQuery : koreanQuery;

    return {
      platform,
      label: config.label,
      url: config.buildUrl(query),
      color: config.color,
      description: config.description,
    };
  });
}

/**
 * 단일 플랫폼의 검색 URL을 생성한다.
 *
 * 상표 사전체크 결과 카드처럼 특정 플랫폼만 필요할 때 사용.
 */
export function buildSourcingUrl(
  platform: SourcingPlatform,
  query: string,
): string {
  return PLATFORM_CONFIG[platform].buildUrl(query);
}
