/**
 * 쿠팡 광고관리 표 붙여넣기 파서
 *
 * 쿠팡 광고 화면(모든 캠페인 > 광고)의 표에는 날짜 열이 없고, 상품명 셀 안에
 * 썸네일·상품명·"ID: 95xxxxxxxxx"가 줄바꿈으로 함께 들어온다. 그래서 행을
 * 개행으로 자르면 상품 하나가 두 줄로 쪼개진다.
 *
 * 파서는 대신 "ID: <숫자>" 를 행 앵커로 삼는다. 앵커 하나가 상품 한 행이고,
 * 앵커 사이 구간이 그 행의 나머지 열이다. 이러면 셀 안 줄바꿈이 몇 개든 상관없다.
 *
 * 금액 열은 두 개(광고 전환 매출, 집행 광고비)라 순서를 정해야 한다. 헤더가
 * 함께 복사됐으면 헤더에 적힌 순서를 따르고, 없으면 쿠팡 기본 순서(전환 매출
 * 다음 집행 광고비)를 가정한다. 지표 설정으로 열을 바꾼 사용자는 헤더까지
 * 함께 드래그하면 그대로 맞는다.
 */

export interface ParsedAdRow {
  /** 쿠팡 광고 화면의 상품 ID. product_cost_channels.external_id 와 같은 값이다 */
  externalId: string;
  /** 붙여넣은 텍스트에서 뽑은 상품명. 매칭이 안 된 행을 사람이 알아보라고 쓴다 */
  productName: string;
  /** 집행 광고비(원) */
  adSpend: number;
  /**
   * 광고 전환 매출(원). 미리보기에 광고비와 나란히 띄우면 열을 잘못 집었을 때
   * 사람이 저장 전에 알아챈다.
   */
  adRevenue: number | null;
  /** 노출수 */
  impressions: number | null;
  /** 클릭수 */
  clicks: number | null;
  /** 광고 전환 판매수 */
  adOrders: number | null;
  /**
   * 표의 "판매 방식" 열에서 읽은 채널. 미매칭 상품을 그 자리에서 연결할 때
   * 채널 종류를 사람에게 다시 묻지 않으려고 쓴다.
   */
  channelType: 'coupang_rg' | 'coupang_wing' | null;
}

export interface ParseResult {
  rows: ParsedAdRow[];
  /** 헤더 줄이 함께 복사됐는지. false면 기본 열 순서를 가정했다는 뜻이다 */
  headerDetected: boolean;
  warnings: string[];
}

/** "ID: 95604134107" — 쿠팡 상품 ID는 9자리 이상이다 */
const ID_ANCHOR = /ID:\s*(\d{8,})/g;

/** "5,016원" · "0원" */
const MONEY = /([\d,]+)\s*원/g;

/** "4,673 회" · "1.01 %" · "5,016원" — 값과 단위를 한 토큰으로 읽는다 */
const VALUE_WITH_UNIT = /([\d,.]+)\s*(원|%|회)/g;

/** 마지막 수단: 쿠팡 기본 열 순서에서 집행 광고비는 두 번째 금액이다 */
const DEFAULT_SPEND_INDEX = 1;

/** 둘 다 null이면 null을 지킨다 — "미수집"과 "0"을 뭉개지 않는다 */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/** 공백·전각공백을 지워 헤더 이름을 비교한다 ("집행 광고비" → "집행광고비") */
function squash(s: string): string {
  return s.replace(/[\s ]/g, '');
}

/**
 * 헤더에서 집행 광고비가 몇 번째 금액 열인지 찾는다.
 *
 * **이 판정은 마지막 수단이다.** 쿠팡 헤더는 2단이라(「중요 결과」 아래 「광고
 * 전환 매출」, 「광고비 효율성」 아래 「광고수익률」) 복사하면 아랫줄이 통째로
 * 뒤로 밀린다. 그러면 텍스트상 「집행 광고비」가 「광고 전환 매출」보다 앞에
 * 오게 되어 열 순서를 거꾸로 읽는다. 2026-08-09에 이 방식으로 전환 매출을
 * 광고비로 저장한 사고가 두 번 났다.
 *
 * 두 이름이 모두 보일 때만 답을 낸다 — 하나만 보이면 나머지 금액 열이 없는
 * 건지, 헤더 셀이 잘려 들어온 건지 구별할 수 없다.
 */
function findSpendMoneyIndex(header: string): number | null {
  const h = squash(header);
  const spendAt = h.indexOf('집행광고비');
  const salesAt = h.indexOf('광고전환매출');
  if (spendAt < 0 || salesAt < 0) return null;
  return salesAt < spendAt ? 1 : 0;
}

/**
 * 값의 단위 순서로 집행 광고비를 찾는다 — 헤더에 기대지 않는 판정이다.
 *
 * 쿠팡 광고 표의 열 순서는 … 광고 전환 판매수(회) · 광고 전환 매출(원) ·
 * 전환율(%) · 집행 광고비(원) · 광고수익률(%) 이다. 두 금액 중 **바로 앞이
 * 퍼센트인 쪽**이 집행 광고비이고, 매출은 앞이 판매수(회)라 섞이지 않는다.
 *
 * 못 찾으면 null.
 */
function findSpendByUnitOrder(block: string): number | null {
  const tokens = Array.from(block.matchAll(VALUE_WITH_UNIT));
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i][2] === '원' && tokens[i - 1][2] === '%') {
      return Number(tokens[i][1].replace(/,/g, ''));
    }
  }
  return null;
}

interface AdMetrics {
  impressions: number | null;
  clicks: number | null;
  adOrders: number | null;
  adRevenue: number | null;
}

const EMPTY_METRICS: AdMetrics = { impressions: null, clicks: null, adOrders: null, adRevenue: null };

/**
 * 노출·클릭·전환 지표를 한 번에 뽑는다.
 *
 * 쿠팡 표의 지표 구간은 단위가 이 순서로 고정돼 있다:
 *   노출수(회) · 클릭수(회) · 클릭률(%) · 전환 판매수(회) · 전환 매출(원)
 * 전환 매출은 "앞이 회인 금액"이라 한 번에 짚을 수 있고, 나머지는 거기서
 * 거꾸로 세면 나온다. 단위가 어긋나면 지표 구성이 바뀐 것이므로 NULL을 돌려
 * 잘못된 숫자를 저장하느니 미수집으로 남긴다.
 *
 * 광고비는 여기서 다루지 않는다 — findSpendByUnitOrder 와 헤더 판정이 맡는다.
 */
function extractMetrics(block: string): AdMetrics {
  const tokens = Array.from(block.matchAll(VALUE_WITH_UNIT));
  const num = (i: number) => Number(tokens[i][1].replace(/,/g, ''));

  for (let r = 1; r < tokens.length; r++) {
    if (tokens[r][2] !== '원' || tokens[r - 1][2] !== '회') continue;

    const adRevenue = num(r);
    const adOrders = num(r - 1);
    // 그 앞이 클릭률(%) · 클릭수(회) · 노출수(회) 순인지 확인한다
    const shaped =
      r >= 4 && tokens[r - 2][2] === '%' && tokens[r - 3][2] === '회' && tokens[r - 4][2] === '회';

    return shaped
      ? { impressions: num(r - 4), clicks: num(r - 3), adOrders, adRevenue }
      : { ...EMPTY_METRICS, adOrders, adRevenue };
  }
  return EMPTY_METRICS;
}

/**
 * ID 앵커 앞 구간에서 상품명을 뽑는다.
 * 앞 구간은 대개 "ON\t상품명\n" 꼴이라, 뒤에서부터 글자가 든 첫 조각을 취한다.
 */
function extractName(before: string): string {
  const parts = before.split(/[\t\n]/).map((s) => s.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.length < 2) continue;
    if (/^(ON|OFF)$/i.test(p)) continue;
    if (!/[가-힣A-Za-z]/.test(p)) continue;
    return p;
  }
  return '';
}

export function parseCoupangAdTable(text: string): ParseResult {
  const warnings: string[] = [];
  const anchors = Array.from(text.matchAll(ID_ANCHOR));

  if (anchors.length === 0) {
    return {
      rows: [],
      headerDetected: false,
      warnings: ['상품 ID를 찾지 못했습니다. 쿠팡 광고 화면의 표를 헤더까지 드래그해 복사했는지 확인해 주세요.'],
    };
  }

  // 첫 앵커 앞 구간이 헤더 영역이다 (헤더 + 첫 상품명이 섞여 있어도 무방)
  const headerZone = text.slice(0, anchors[0].index ?? 0);
  const spendIndexFromHeader = findSpendMoneyIndex(headerZone);
  const headerDetected = spendIndexFromHeader !== null;

  // 같은 상품이 여러 캠페인에 걸쳐 나오면 합산한다
  const byId = new Map<string, ParsedAdRow>();

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const externalId = a[1];
    const start = a.index ?? 0;
    const end = i + 1 < anchors.length ? (anchors[i + 1].index ?? text.length) : text.length;

    // 행 구간: 앵커 시작부터 다음 앵커 직전까지. 뒤쪽에는 다음 행의 ON/OFF·상품명이
    // 딸려오지만, 금액은 앞에서부터 세므로 영향이 없다.
    const block = text.slice(start + a[0].length, end);
    const prevEnd = i === 0 ? 0 : (anchors[i - 1].index ?? 0);
    const productName = extractName(text.slice(prevEnd, start));

    // "판매 방식" 열 — 로켓그로스 / 판매자배송 중 하나가 이 행 구간에 들어 있다
    const squashed = squash(block);
    const channelType: ParsedAdRow['channelType'] = squashed.includes('로켓그로스')
      ? 'coupang_rg'
      : squashed.includes('판매자배송')
      ? 'coupang_wing'
      : null;

    // 단위 순서(앞이 %인 금액)를 먼저 믿는다. 데이터 자체의 구조라 헤더가
    // 어떻게 복사되든 흔들리지 않는다. 헤더 판정은 그 규칙이 안 통할 때만 쓴다.
    const monies = Array.from(block.matchAll(MONEY)).map((m) => Number(m[1].replace(/,/g, '')));
    let adSpend: number | null = findSpendByUnitOrder(block);
    if (adSpend === null && spendIndexFromHeader !== null && monies.length > spendIndexFromHeader) {
      adSpend = monies[spendIndexFromHeader];
    }
    if (adSpend === null && monies.length > DEFAULT_SPEND_INDEX) {
      adSpend = monies[DEFAULT_SPEND_INDEX];
    }
    if (adSpend === null) {
      warnings.push(`ID ${externalId} — 집행 광고비 열을 읽지 못해 0원으로 두었습니다.`);
      adSpend = 0;
    }
    if (!Number.isFinite(adSpend) || adSpend < 0) adSpend = 0;

    const metrics = extractMetrics(block);

    const prev = byId.get(externalId);
    if (prev) {
      prev.adSpend += adSpend;
      // 미수집(null)과 0은 다르다 — 한쪽만 값이 있으면 그 값을 살린다
      prev.adRevenue = addNullable(prev.adRevenue, metrics.adRevenue);
      prev.impressions = addNullable(prev.impressions, metrics.impressions);
      prev.clicks = addNullable(prev.clicks, metrics.clicks);
      prev.adOrders = addNullable(prev.adOrders, metrics.adOrders);
      if (!prev.productName) prev.productName = productName;
      if (!prev.channelType) prev.channelType = channelType;
    } else {
      byId.set(externalId, { externalId, productName, adSpend, channelType, ...metrics });
    }
  }

  return { rows: Array.from(byId.values()), headerDetected, warnings };
}
