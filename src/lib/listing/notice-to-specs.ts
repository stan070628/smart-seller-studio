/**
 * 고시정보 → 카피 생성 입력(productSpecs) 변환
 *
 * 왜 필요한가:
 *   상세페이지 카피가 **사진과 상품명만 보고** 작성되는 동안, 전성분·제조사·사용법은
 *   이미 채널 API의 고시정보(productInfoProvidedNotice)에 정확한 값으로 들어 있었다.
 *   그 결과 핸드워시에서는 전성분표에 없는 성분이 "주요 성분"으로 주장됐고,
 *   라비오라에서는 제조사 원문 사용법 대신 지어낸 문장이 들어갔다.
 *
 *   `buildDetailPageUserPrompt`의 `productSpecs`는 "[소스 URL 실측 스펙 — 이미지 분석보다
 *   절대 우선 적용]" 블록으로 주입되므로, 고시정보를 이 형태로 바꾸면
 *   **추론 대신 확정 사실이 카피의 근거**가 된다.
 *
 * 설계 원칙:
 *   - **읽은 값만 넘긴다.** 비어 있거나 의미 없는 값("0", "-", "상세페이지 참조")은 버린다.
 *   - **가공하지 않는다.** 사용법·주의사항은 원문 그대로 넘겨 카피가 요약하게 한다.
 *   - 채널마다 필드명이 다르므로(네이버 `cosmetic`/`wear`, 쿠팡 `notices`) 입력을 일반화한다.
 */

export interface ProductSpec {
  label: string;
  value: string;
}

/** 고시정보 본문 — 채널·유형별로 키가 다르므로 문자열 맵으로 받는다 */
export type NoticeBody = Record<string, unknown>;

/** 값이 정보로서 쓸모없는지 — 자리만 채운 값들을 걸러낸다 */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  // 고시정보에서 "없음"을 뜻하는 관용 표기
  return ['0', '-', '해당없음', '해당 없음', '상세페이지 참조', '상품 상세페이지 참조', '없음'].includes(s);
}

/**
 * 고시정보 키 → 카피에 쓸 라벨.
 * 여기 없는 키는 넘기지 않는다 — `returnCostReason` 같은 반품 정책 항목은
 * 카피 재료가 아니라 법정 고지이므로 상세 하단 고지 영역이 담당한다.
 */
const LABELS: Record<string, string> = {
  // 화장품(COSMETIC)
  capacity: '용량',
  specification: '제품 주요 사양',
  expirationDateText: '사용기한',
  usage: '사용법(제조사 표기)',
  manufacturer: '제조업자',
  producer: '제조국',
  distributor: '책임판매업자',
  mainIngredient: '주요 성분',
  certificationType: '인증·허가',
  caution: '사용 시 주의사항(원문)',
  // 의류(WEAR)
  material: '소재',
  color: '색상',
  size: '치수',
  packDateText: '제조연월',
  packDate: '제조연월',
  // 공통
  modelName: '모델명',
  itemName: '품명',
};

/** 라벨 순서 — 카피가 앞쪽을 더 중요하게 다룬다 */
const ORDER = [
  'itemName', 'modelName', 'capacity', 'specification', 'material', 'size', 'color',
  'mainIngredient', 'usage', 'expirationDateText', 'packDateText', 'packDate',
  'producer', 'manufacturer', 'distributor', 'certificationType', 'caution',
];

export interface NoticeToSpecsOptions {
  /** 주의사항 원문은 길어서 카피를 흐릴 수 있다. 기본은 제외 */
  includeCaution?: boolean;
  /** 주소가 붙은 값에서 상호만 남긴다 ("(주)비앤비코리아 | 인천…" → "(주)비앤비코리아") */
  stripAddress?: boolean;
}

/**
 * 고시정보를 `buildDetailPageUserPrompt`의 productSpecs 형태로 바꾼다.
 *
 * @example
 *   const specs = noticeToSpecs(op.detailAttribute.productInfoProvidedNotice.cosmetic);
 *   buildDetailPageUserPrompt(analysis, name, specs);
 */
export function noticeToSpecs(notice: NoticeBody | null | undefined, opts: NoticeToSpecsOptions = {}): ProductSpec[] {
  if (!notice) return [];
  const { includeCaution = false, stripAddress = true } = opts;

  const out: ProductSpec[] = [];
  for (const key of ORDER) {
    if (key === 'caution' && !includeCaution) continue;
    const label = LABELS[key];
    if (!label) continue;
    const raw = notice[key];
    if (isEmptyValue(raw)) continue;

    let value = String(raw).trim();
    if (stripAddress && (key === 'manufacturer' || key === 'distributor')) {
      value = value.split('|')[0].trim();
    }
    out.push({ label, value });
  }
  return out;
}

/**
 * 네이버 고시정보 객체에서 본문을 꺼낸다.
 * `{ productInfoProvidedNoticeType: 'COSMETIC', cosmetic: {...} }` 구조라
 * 유형 키를 제외한 나머지 하나가 본문이다.
 */
export function extractNaverNoticeBody(
  provided: Record<string, unknown> | null | undefined,
): NoticeBody | null {
  if (!provided) return null;
  const key = Object.keys(provided).find(k => k !== 'productInfoProvidedNoticeType');
  if (!key) return null;
  const body = provided[key];
  return body && typeof body === 'object' ? (body as NoticeBody) : null;
}

/**
 * 쿠팡 `notices` 배열을 본문 맵으로 바꾼다.
 * `[{ noticeCategoryName, noticeCategoryDetailName, content }]` 형태이며
 * 한글 항목명을 그대로 라벨로 쓴다.
 */
export function coupangNoticesToSpecs(
  notices: Array<{ noticeCategoryDetailName?: string; content?: string }> | null | undefined,
): ProductSpec[] {
  if (!notices?.length) return [];
  return notices
    .filter(n => n.noticeCategoryDetailName && !isEmptyValue(n.content))
    .map(n => ({ label: n.noticeCategoryDetailName!.trim(), value: String(n.content).trim() }));
}
