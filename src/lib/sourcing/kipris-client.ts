/**
 * KIPRIS (한국특허정보원) API 클라이언트
 * Base URL: http://kipo-api.kipi.or.kr/openapi/service
 *
 * 지원 API:
 *   - 상표 검색: trademarkInfoSearchService/getWordSearch
 *   - 특허 검색: patUtiModInfoSearchSevice/getWordSearch
 *   - 디자인 검색: designInfoSearchService/getWordSearch
 *
 * Rate Limit: 30tps (초당 30회)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 공개 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface KiprisSearchResult {
  totalCount: number;
  items: KiprisItem[];
}

export interface KiprisItem {
  applicationNumber: string;
  inventionTitle: string;
  applicantName: string;
  /** '등록', '공개', '거절', '소멸', '포기' 등 */
  registerStatus: string;
  applicationDate?: string;
  registerDate?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 상수
// ─────────────────────────────────────────────────────────────────────────────

const KIPRIS_BASE_URL = 'http://kipo-api.kipi.or.kr/openapi/service';

// 각 API 엔드포인트 경로
const ENDPOINT = {
  trademark: 'trademarkInfoSearchService/getWordSearch',
  patent: 'patUtiModInfoSearchSevice/getWordSearch',
  design: 'designInfoSearchService/getWordSearch',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// XML 파싱 유틸리티 (외부 라이브러리 없이 정규식 처리)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * XML 문자열에서 특정 태그 값을 추출
 * 단순 구조(<tag>value</tag>) 전용 — 중첩 무시
 */
function extractTagValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * XML 문자열에서 모든 <item> 블록을 배열로 추출
 */
function extractItems(xml: string): string[] {
  const regex = /<item>([\s\S]*?)<\/item>/g;
  const items: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

/**
 * KIPRIS XML 응답 파싱 → KiprisSearchResult
 *
 * 공통 응답 구조:
 * <response>
 *   <header>
 *     <resultCode>00</resultCode>
 *     <resultMsg>NORMAL SERVICE</resultMsg>
 *   </header>
 *   <body>
 *     <items>
 *       <item>...</item>
 *     </items>
 *   </body>
 *   <count>
 *     <totalCount>N</totalCount>
 *   </count>
 * </response>
 */
function parseKiprisXml(xml: string): KiprisSearchResult {
  // resultCode 검증 — '00'이 아니면 에러
  const resultCode = extractTagValue(xml, 'resultCode');
  if (resultCode && resultCode !== '00') {
    const resultMsg = extractTagValue(xml, 'resultMsg');
    throw new Error(`[KIPRIS] API 오류 (resultCode: ${resultCode}): ${resultMsg}`);
  }

  // totalCount 파싱
  const totalCountStr = extractTagValue(xml, 'totalCount');
  const totalCount = totalCountStr ? parseInt(totalCountStr, 10) : 0;

  // <item> 블록 추출 → 필드 파싱
  const rawItems = extractItems(xml);
  const items: KiprisItem[] = rawItems.map((block): KiprisItem => ({
    applicationNumber: extractTagValue(block, 'applicationNumber'),
    // 상표는 trademarkName, 특허/디자인은 inventionTitle 사용
    inventionTitle:
      extractTagValue(block, 'inventionTitle') ||
      extractTagValue(block, 'trademarkName') ||
      extractTagValue(block, 'titleName') ||
      '',
    applicantName: extractTagValue(block, 'applicantName'),
    registerStatus:
      extractTagValue(block, 'registerStatus') ||
      extractTagValue(block, 'applicationStatus') ||
      '',
    applicationDate: extractTagValue(block, 'applicationDate') || undefined,
    registerDate:
      extractTagValue(block, 'registrationDate') ||
      extractTagValue(block, 'registerDate') ||
      undefined,
  }));

  return { totalCount: isNaN(totalCount) ? 0 : totalCount, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// KIPRIS 클라이언트
// ─────────────────────────────────────────────────────────────────────────────

export class KiprisClient {
  private readonly trademarkKey: string;
  private readonly patentKey: string;
  private readonly designKey: string;

  constructor() {
    this.trademarkKey = process.env.KIPRIS_TRADEMARK_API_KEY ?? '';
    this.patentKey = process.env.KIPRIS_PATENT_API_KEY ?? '';
    this.designKey = process.env.KIPRIS_DESIGN_API_KEY ?? '';
  }

  /**
   * 공통 API 호출 메서드
   * ServiceKey는 URL 파라미터로 그대로 전달 (KIPRIS 인증 방식)
   */
  private async fetchKipris(
    endpoint: string,
    serviceKey: string,
    keyword: string,
  ): Promise<KiprisSearchResult> {
    if (!serviceKey) {
      throw new Error('[KIPRIS] API 키가 설정되지 않았습니다. 환경변수를 확인하세요.');
    }

    // keyword는 encodeURIComponent로 인코딩, ServiceKey는 그대로 전달 (이미 인코딩된 키)
    const url = `${KIPRIS_BASE_URL}/${endpoint}?word=${encodeURIComponent(keyword)}&ServiceKey=${serviceKey}`;

    const res = await fetch(url, {
      // KIPRIS API 타임아웃 (10초)
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/xml, text/xml, */*' },
    });

    if (!res.ok) {
      throw new Error(`[KIPRIS] HTTP 오류: ${res.status} ${res.statusText} (endpoint: ${endpoint})`);
    }

    const xml = await res.text();
    return parseKiprisXml(xml);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 공개 메서드
  // ─────────────────────────────────────────────────────────────────────────

  /** 상표 검색 */
  async searchTrademark(keyword: string): Promise<KiprisSearchResult> {
    return this.fetchKipris(ENDPOINT.trademark, this.trademarkKey, keyword);
  }

  /** 특허 검색 */
  async searchPatent(keyword: string): Promise<KiprisSearchResult> {
    return this.fetchKipris(ENDPOINT.patent, this.patentKey, keyword);
  }

  /** 디자인 검색 */
  async searchDesign(keyword: string): Promise<KiprisSearchResult> {
    return this.fetchKipris(ENDPOINT.design, this.designKey, keyword);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 싱글톤 — 서버리스 warm 인스턴스에서 재사용
// ─────────────────────────────────────────────────────────────────────────────
let _client: KiprisClient | null = null;

export function getKiprisClient(): KiprisClient {
  if (!_client) {
    _client = new KiprisClient();
  }
  return _client;
}
