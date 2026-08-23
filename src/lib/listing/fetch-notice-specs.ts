/**
 * 채널에서 고시정보를 가져와 카피 입력(productSpecs)으로 바꾼다.
 *
 * 배선의 목적:
 *   상세페이지 카피가 사진과 상품명만 보고 작성되는 문제를 없앤다. 전성분·제조사·사용법은
 *   이미 채널에 정확한 값으로 있으므로, 상품번호만 주면 서버가 조회해 카피 입력에 실어준다.
 *   클라이언트는 채널 인증을 갖지 않으므로 이 조회는 서버에서 일어나야 한다.
 *
 * 실패해도 생성은 계속된다 — 고시정보는 카피를 **더 정확하게** 만드는 재료이지
 * 없으면 못 만드는 필수 입력이 아니다.
 */
import { getNaverCommerceClient } from './naver-commerce-client';
import { noticeToSpecs, extractNaverNoticeBody, type ProductSpec } from './notice-to-specs';

export interface NoticeSource {
  channel: 'naver';
  /** 네이버 원상품번호 (originProductNo) */
  productNo: number;
}

export interface FetchNoticeSpecsResult {
  specs: ProductSpec[];
  /** 조회 실패 사유. 생성은 계속하되 로그로 남긴다 */
  error?: string;
}

/**
 * 채널 고시정보를 productSpecs로 가져온다.
 * 조회에 실패해도 예외를 던지지 않고 빈 배열을 돌려준다.
 */
export async function fetchNoticeSpecs(source: NoticeSource): Promise<FetchNoticeSpecsResult> {
  try {
    if (source.channel !== 'naver') {
      return { specs: [], error: `지원하지 않는 채널: ${source.channel}` };
    }
    const client = getNaverCommerceClient();
    const detail = (await client.getProductDetail(source.productNo)) as
      | { originProduct?: { detailAttribute?: { productInfoProvidedNotice?: Record<string, unknown> } } }
      | undefined;

    const provided = detail?.originProduct?.detailAttribute?.productInfoProvidedNotice;
    const body = extractNaverNoticeBody(provided);
    if (!body) return { specs: [], error: '고시정보 없음' };

    return { specs: noticeToSpecs(body) };
  } catch (e) {
    return { specs: [], error: e instanceof Error ? e.message : '고시정보 조회 실패' };
  }
}

/**
 * 명시적으로 넘어온 스펙과 고시정보를 합친다.
 *
 * **사용자가 직접 넣은 값이 우선**이다. 같은 라벨이면 고시정보를 버린다 —
 * 판매자가 의도적으로 다르게 적은 것을 채널 값으로 덮으면 안 된다.
 */
export function mergeSpecs(explicit: ProductSpec[] | undefined, fromNotice: ProductSpec[]): ProductSpec[] {
  const base = explicit ?? [];
  const taken = new Set(base.map(s => s.label));
  return [...base, ...fromNotice.filter(s => !taken.has(s.label))];
}
