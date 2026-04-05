/**
 * 네이버 쇼핑 API 클라이언트
 * - 쇼핑 검색 (openapi.naver.com)
 * - 자동완성 제안 (ac.shopping.naver.com, 인증 불필요)
 * - DataLab 키워드 트렌드 (openapi.naver.com)
 */

import type { NaverShoppingItem } from '@/types/niche';

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const NAVER_API_BASE = 'https://openapi.naver.com/v1';
const NAVER_AC_BASE = 'https://ac.shopping.naver.com/ac';

/** API 호출 간 대기 시간 (ms) — Rate Limiting 방지 */
const API_DELAY = 150;

/** searchShopping display 기본값 / 최대값 */
const SEARCH_DISPLAY_DEFAULT = 100;
const SEARCH_DISPLAY_MAX = 100;

/** datalabKeywords 배치 크기 (API 제한) */
const DATALAB_BATCH_SIZE = 5;

// ─────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────
// DataLab 응답 타입 (내부용)
// ─────────────────────────────────────────────────────────────

interface DatalabPeriodData {
  period: string;
  ratio: number;
}

interface DatalabKeywordResult {
  title: string;
  keywords: string[];
  data: DatalabPeriodData[];
}

interface DatalabApiResponse {
  startDate: string;
  endDate: string;
  timeUnit: string;
  results: DatalabKeywordResult[];
}

// ─────────────────────────────────────────────────────────────
// 네이버 쇼핑 검색 API 원시 응답 타입 (내부용)
// ─────────────────────────────────────────────────────────────

interface NaverSearchApiResponse {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverShoppingItem[];
}

// ─────────────────────────────────────────────────────────────
// 자동완성 API 응답 타입 (내부용)
// 응답 형식: { query: [...], ac: [[["키워드", "0"], ...], ...] }
// ─────────────────────────────────────────────────────────────

interface NaverAcResponse {
  query?: string[];
  ac?: Array<Array<[string, string]>>;
}

// ─────────────────────────────────────────────────────────────
// 트렌드 계산 결과 타입 (공개)
// ─────────────────────────────────────────────────────────────

export interface KeywordTrendResult {
  avgRatio: number;
  trendPct: number;
  direction: 'rising' | 'falling' | 'stable';
}

// ─────────────────────────────────────────────────────────────
// NaverShoppingClient
// ─────────────────────────────────────────────────────────────

export class NaverShoppingClient {
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    this.clientId = process.env.NAVER_CLIENT_ID ?? '';
    this.clientSecret = process.env.NAVER_CLIENT_SECRET ?? '';

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        '[네이버 쇼핑] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.',
      );
    }
  }

  /** 네이버 OpenAPI 공통 인증 헤더 */
  private get authHeaders(): Record<string, string> {
    return {
      'X-Naver-Client-Id': this.clientId,
      'X-Naver-Client-Secret': this.clientSecret,
    };
  }

  // ───────────────────────────────────────────────
  // 1. 쇼핑 검색
  // ───────────────────────────────────────────────

  /**
   * 네이버 쇼핑 검색 API 호출
   * @param query    검색 키워드
   * @param display  반환 수 (기본 100, 최대 100)
   * @param sort     정렬 기준 (기본 "sim" — 정확도순)
   */
  async searchShopping(
    query: string,
    display: number = SEARCH_DISPLAY_DEFAULT,
    sort: string = 'sim',
  ): Promise<{ total: number; items: NaverShoppingItem[] }> {
    // display 범위 보정
    const safeDisplay = Math.min(Math.max(1, display), SEARCH_DISPLAY_MAX);

    const params = new URLSearchParams({
      query,
      display: String(safeDisplay),
      sort,
    });

    const url = `${NAVER_API_BASE}/search/shop.json?${params.toString()}`;

    const res = await fetch(url, {
      headers: this.authHeaders,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `[네이버 쇼핑] searchShopping 실패: ${res.status} ${res.statusText} — ${body}`,
      );
    }

    const data = (await res.json()) as NaverSearchApiResponse;

    return {
      total: data.total,
      items: data.items ?? [],
    };
  }

  // ───────────────────────────────────────────────
  // 2. 자동완성 제안
  // ───────────────────────────────────────────────

  /**
   * 네이버 쇼핑 자동완성 API 호출 (인증 불필요)
   * 오류 발생 시 빈 배열을 반환하여 상위 로직을 중단시키지 않음
   * @param query  검색어
   */
  async getSuggestions(query: string): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        frm: 'shopping',
        r_format: 'json',
        r_enc: 'UTF-8',
        r_unicode: '0',
        t_koreng: '1',
      });

      const url = `${NAVER_AC_BASE}?${params.toString()}`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) {
        return [];
      }

      const data = (await res.json()) as NaverAcResponse;

      // 응답 구조: { ac: [ [ ["키워드", "0"], ... ] ] }
      const suggestions: string[] = [];
      if (Array.isArray(data.ac)) {
        for (const group of data.ac) {
          if (Array.isArray(group)) {
            for (const pair of group) {
              if (Array.isArray(pair) && typeof pair[0] === 'string') {
                suggestions.push(pair[0]);
              }
            }
          }
        }
      }

      return suggestions;
    } catch {
      // 자동완성 실패는 치명적이지 않으므로 빈 배열 반환
      return [];
    }
  }

  // ───────────────────────────────────────────────
  // 3. DataLab 키워드 트렌드
  // ───────────────────────────────────────────────

  /**
   * 네이버 DataLab 쇼핑 카테고리 키워드 트렌드 조회
   * 5개씩 배치 처리 후 결과를 병합한다.
   *
   * 트렌드 계산 방식:
   *   - 최근 3주(last3w)와 이전 3주(prev3w)의 평균 ratio 비교
   *   - trendPct = ((last3w - prev3w) / prev3w) * 100
   *   - direction: +10% 이상 → rising, -10% 이하 → falling, 그 외 → stable
   *
   * @param category  DataLab 쇼핑 카테고리 코드
   * @param keywords  분석 대상 키워드 배열
   * @param days      조회 기간 (일, 기본 42 = 6주)
   */
  async datalabKeywords(
    category: string,
    keywords: string[],
    days: number = 42,
  ): Promise<Record<string, KeywordTrendResult>> {
    // 조회 기간 계산 (오늘 기준 days일 전 ~ 어제)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (days - 1));

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const startDateStr = fmt(startDate);
    const endDateStr = fmt(endDate);

    // 절반 기준 인덱스 (최근 3주 / 이전 3주 경계)
    // days 기간을 균등하게 절반으로 나눠 비교
    const halfDays = Math.floor(days / 2);

    const result: Record<string, KeywordTrendResult> = {};

    // 5개씩 배치 처리
    for (let i = 0; i < keywords.length; i += DATALAB_BATCH_SIZE) {
      const batch = keywords.slice(i, i + DATALAB_BATCH_SIZE);

      const keywordGroups = batch.map((kw) => ({
        groupName: kw,
        keywords: [kw],
      }));

      const body = {
        startDate: startDateStr,
        endDate: endDateStr,
        timeUnit: 'date',
        category,
        keyword: keywordGroups,
      };

      try {
        const res = await fetch(`${NAVER_API_BASE}/datalab/shopping/category/keywords`, {
          method: 'POST',
          headers: {
            ...this.authHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          throw new Error(
            `[네이버 DataLab] 배치 ${i / DATALAB_BATCH_SIZE + 1} 실패: ${res.status} — ${errBody}`,
          );
        }

        const data = (await res.json()) as DatalabApiResponse;

        for (const kwResult of data.results) {
          const keyword = kwResult.title;
          const ratios = kwResult.data.map((d) => d.ratio);

          if (ratios.length === 0) {
            result[keyword] = { avgRatio: 0, trendPct: 0, direction: 'stable' };
            continue;
          }

          // 전체 평균
          const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;

          // 최근 절반 vs 이전 절반 비교
          const midIndex = Math.floor(ratios.length * (halfDays / days));
          const prevSlice = ratios.slice(0, midIndex);
          const lastSlice = ratios.slice(midIndex);

          const prevAvg =
            prevSlice.length > 0
              ? prevSlice.reduce((sum, r) => sum + r, 0) / prevSlice.length
              : 0;
          const lastAvg =
            lastSlice.length > 0
              ? lastSlice.reduce((sum, r) => sum + r, 0) / lastSlice.length
              : 0;

          // prevAvg가 0이면 trendPct 산출 불가 → 0으로 처리
          const trendPct =
            prevAvg > 0 ? ((lastAvg - prevAvg) / prevAvg) * 100 : 0;

          const direction: KeywordTrendResult['direction'] =
            trendPct >= 10 ? 'rising' : trendPct <= -10 ? 'falling' : 'stable';

          result[keyword] = { avgRatio, trendPct, direction };
        }
      } catch (err) {
        // 배치 실패 시 해당 키워드들을 stable/0으로 채워 전체 흐름을 유지
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[네이버 DataLab] 배치 처리 오류 — ${message}`);
        for (const kw of batch) {
          result[kw] = { avgRatio: 0, trendPct: 0, direction: 'stable' };
        }
      }

      // 마지막 배치 이후에는 딜레이 불필요
      if (i + DATALAB_BATCH_SIZE < keywords.length) {
        await sleep(API_DELAY);
      }
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// 싱글톤 — 서버리스 cold start 시 새로 생성되므로 연결 상태 없이 안전
// ─────────────────────────────────────────────────────────────

let _client: NaverShoppingClient | null = null;

export function getNaverShoppingClient(): NaverShoppingClient {
  if (!_client) {
    _client = new NaverShoppingClient();
  }
  return _client;
}
