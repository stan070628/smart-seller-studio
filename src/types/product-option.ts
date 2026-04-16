/**
 * 도매꾹 옵션 → 정규화 통합 옵션 타입
 *
 * 도매꾹 selectOpt JSON을 파싱한 뒤 내부적으로 사용하는 통합 형식.
 * 쿠팡/네이버 payload 매핑은 이 타입만 참조한다.
 */

// ─────────────────────────────────────────────────────────────
// 도매꾹 selectOpt raw 타입 (API 응답 그대로)
// ─────────────────────────────────────────────────────────────

/** selectOpt.set[] 항목 */
export interface DgRawOptionSet {
  name: string;            // 옵션 그룹명 ("색상", "사이즈")
  opts: string[];          // 옵션값 목록 ["블랙", "화이트"]
  domPrice: string[];      // 추가금액 문자열 ["0", "1500"]
  changeKey?: string[];    // 내부 키
}

/** selectOpt.data[key] 항목 */
export interface DgRawOptionData {
  name: string;            // 조합명 ("블랙/XL")
  dom: string;             // "1"=판매중
  domPrice: string;        // 추가금액 문자열 ("0", "1500")
  sup: string;             // "1"=공급가 있음
  supPrice: string;        // 공급가 추가금액
  qty: string;             // 재고
  hid: string;             // "0"=정상, "1"=숨김, "2"=품절
  hash: string;            // 주문용 해시
  sam?: string;            // 샘플 가능 여부
  samPrice?: string;       // 샘플 추가금액
}

/** selectOpt 전체 구조 */
export interface DgSelectOpt {
  type: string;            // "combination"
  optSort?: string;        // "DA" 등
  set: DgRawOptionSet[];
  orgSet?: DgRawOptionSet[];
  data: Record<string, DgRawOptionData>;
}

// ─────────────────────────────────────────────────────────────
// 정규화 통합 옵션 타입
// ─────────────────────────────────────────────────────────────

/** 옵션 그룹 (축: 색상, 사이즈 등) */
export interface NormalizedOptionGroup {
  order: number;           // 0-based
  groupName: string;       // "색상", "사이즈"
  values: string[];        // ["블랙", "화이트", "네이비"]
}

/** 옵션 조합 (SKU 단위) */
export interface NormalizedOptionVariant {
  variantId: string;             // 클라이언트 식별용 ("v_0_1")
  optionValues: string[];        // ["블랙", "XL"] — group order 순
  sourceHash: string | null;     // 도매꾹 주문용 해시
  costPrice: number;             // 도매가 + 추가금액 (원)
  salePrices: {
    coupang: number;
    naver: number;
  };
  stock: number;                 // 재고
  soldOut: boolean;              // hid === "2"
  hidden: boolean;               // hid === "1"
  enabled: boolean;              // 등록에 포함할지 (UI에서 토글)
}

/** API/Store에서 사용하는 옵션 전체 묶음 */
export interface ProductOptions {
  hasOptions: boolean;
  groups: NormalizedOptionGroup[];
  variants: NormalizedOptionVariant[];
}
