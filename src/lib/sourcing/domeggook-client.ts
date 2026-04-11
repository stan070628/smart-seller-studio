import {
  DOMEGGOOK_API_BASE_URL,
  DOMEGGOOK_API_KEY,
  PROXY_URL,
  PROXY_SECRET,
  API_CALL_DELAY_MS,
} from './constants';
import type {
  DomeggookListResponse,
  DomeggookListItem,
  DomeggookItemDetail,
  DomeggookItemViewResponse,
} from '@/types/sourcing';

// 지정된 ms 만큼 대기
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// PROXY_URL이 설정되어 있으면 Vercel Tokyo 프록시를 경유해 호출
async function domeggookFetch(url: string): Promise<Response> {
  if (PROXY_URL && PROXY_SECRET) {
    return fetch(PROXY_URL, {
      method: 'GET',
      headers: {
        'x-proxy-secret': PROXY_SECRET,
        'x-target-url': url,
      },
    });
  }
  return fetch(url);
}

// ────────────────────────────────────────────
// getItemList 호출 옵션
// ────────────────────────────────────────────
export interface GetItemListOptions {
  /** 검색 키워드 (기본: '생활용품') — kw, ca, id, ev, itemNo 중 1개 이상 필수 */
  keyword?: string;
  /** 카테고리 코드 — ca 파라미터 */
  category?: string;
  /** 페이지 번호 (기본: 1) */
  page?: number;
  /** 페이지당 수 (기본: 200, 최대: 200) */
  pageSize?: number;
  /** 정렬 기준 (기본: 'rd') */
  sort?: string;
}

// ────────────────────────────────────────────
// getItemViewBatch 반환 타입
// ────────────────────────────────────────────
export interface BatchResult {
  success: DomeggookItemDetail[];
  failed: { itemNo: number; error: string }[];
}

export class DomeggookClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = DOMEGGOOK_API_BASE_URL;
    this.apiKey = DOMEGGOOK_API_KEY;

    if (!this.apiKey) {
      throw new Error('[도매꾹] DOMEGGOOK_API_KEY 환경변수가 설정되지 않았습니다.');
    }
  }

  // ────────────────────────────────────────────
  // 상품 목록 조회 (mode=getItemList, ver=4.1)
  // v4.1부터 list[].qty.inventory 포함 → getItemView 없이 재고 파악 가능
  // ────────────────────────────────────────────
  async getItemList(options?: GetItemListOptions): Promise<DomeggookListResponse> {
    const params = new URLSearchParams({
      ver: '4.1',
      mode: 'getItemList',
      aid: this.apiKey,
      market: 'dome',   // 필수 파라미터
      om: 'json',
      sz: String(options?.pageSize ?? 200),
      pg: String(options?.page ?? 1),
      so: options?.sort ?? 'rd',
    });

    // 검색 조건 1개 이상 필수 — keyword 또는 category 중 하나를 반드시 포함
    if (options?.category) {
      params.set('ca', options.category);
    } else {
      // 카테고리 미지정 시 기본 키워드 사용
      params.set('kw', options?.keyword ?? '생활용품');
    }

    const url = `${this.baseUrl}?${params.toString()}`;
    const res = await domeggookFetch(url);

    if (!res.ok) {
      throw new Error(`[도매꾹] getItemList API 오류: ${res.status} ${res.statusText}`);
    }

    const raw = await res.json();

    // errors 객체 감지 (최상위 또는 domeggook 하위)
    const errors = raw.errors ?? raw.domeggook?.errors;
    if (errors) {
      throw new Error(`[도매꾹] getItemList 응답 오류: ${JSON.stringify(errors)}`);
    }

    // 실제 응답은 { domeggook: { header, list: { item: [...] } } } 구조
    const root = raw.domeggook ?? raw;
    const header = root.header;
    const listItems = Array.isArray(root.list?.item) ? root.list.item
      : root.list?.item ? [root.list.item]  // 단일 아이템일 때 배열로 래핑
      : Array.isArray(root.list) ? root.list
      : [];

    if (!header) {
      throw new Error(`[도매꾹] getItemList 응답 구조 이상 — header 누락`);
    }

    return { header, list: listItems } as DomeggookListResponse;
  }

  // ────────────────────────────────────────────
  // 상품 상세 조회 (mode=getItemView, ver=4.5)
  // getItemList의 qty.inventory만으로 부족할 때, 또는 price.dome/supply 필요 시 사용
  // v4.1부터 market 파라미터 불필요
  // ────────────────────────────────────────────
  async getItemView(itemNo: number): Promise<DomeggookItemDetail> {
    const params = new URLSearchParams({
      ver: '4.5',
      mode: 'getItemView',
      aid: this.apiKey,
      no: String(itemNo),
      om: 'json',
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    const res = await domeggookFetch(url);

    if (!res.ok) {
      throw new Error(`[도매꾹] 상품 ${itemNo} 상세 조회 실패: ${res.status} ${res.statusText}`);
    }

    const raw = await res.json();

    // 실제 응답: { domeggook: { basis, price, qty, seller, category, ... } }
    const errors = raw.errors ?? raw.domeggook?.errors;
    if (errors) {
      throw new Error(`[도매꾹] 상품 ${itemNo} 상세 응답 오류: ${JSON.stringify(errors)}`);
    }

    const root = raw.domeggook ?? raw;
    if (!root.basis) {
      throw new Error(`[도매꾹] 상품 ${itemNo} 응답에 basis 필드 없음`);
    }

    return root as DomeggookItemDetail;
  }

  // ────────────────────────────────────────────
  // 배치 상세 조회 — API_CALL_DELAY_MS 간격으로 순차 호출
  // getItemList의 qty.inventory로 충분하지 않을 때만 사용 권장
  // onProgress: 진행 콜백 (현재 인덱스, 전체 수)
  // ────────────────────────────────────────────
  async getItemViewBatch(
    itemNos: number[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<BatchResult> {
    const success: DomeggookItemDetail[] = [];
    const failed: { itemNo: number; error: string }[] = [];

    for (let i = 0; i < itemNos.length; i++) {
      try {
        const detail = await this.getItemView(itemNos[i]);
        success.push(detail);
      } catch (err) {
        failed.push({
          itemNo: itemNos[i],
          error: err instanceof Error ? err.message : String(err),
        });
      }

      onProgress?.(i + 1, itemNos.length);

      // 마지막 항목 이후에는 딜레이 불필요
      if (i < itemNos.length - 1) {
        await sleep(API_CALL_DELAY_MS);
      }
    }

    return { success, failed };
  }

  // ────────────────────────────────────────────
  // 전체 페이지 수집 — getItemList를 페이지 순회하여 모든 상품 반환
  // header.numberOfPages 기준으로 자동 페이지네이션
  // ────────────────────────────────────────────
  async getAllItems(options?: Omit<GetItemListOptions, 'page'>): Promise<DomeggookListItem[]> {
    const allItems: DomeggookListItem[] = [];

    const firstPage = await this.getItemList({ ...options, page: 1 });
    allItems.push(...firstPage.list);

    const totalPages = firstPage.header.numberOfPages;

    for (let page = 2; page <= totalPages; page++) {
      const pageData = await this.getItemList({ ...options, page });
      if (pageData.list.length === 0) break;
      allItems.push(...pageData.list);
    }

    return allItems;
  }
}

// ────────────────────────────────────────────
// 싱글톤 — 모듈 범위에서 인스턴스를 재사용
// 서버리스 cold start 시 새로 생성되므로 연결 상태 없이 안전
// ────────────────────────────────────────────
let _client: DomeggookClient | null = null;

export function getDomeggookClient(): DomeggookClient {
  if (!_client) {
    _client = new DomeggookClient();
  }
  return _client;
}
