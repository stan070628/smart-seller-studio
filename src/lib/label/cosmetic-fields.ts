// src/lib/label/cosmetic-fields.ts
//
// 화장품 라벨 2×3의 필드 구조와 하위 호환 마이그레이션.
//
// 확장 이전 구조는 호주 비누 4종 버라이어티팩 전용이었다. 품목명·전성분은 soap1~soap4로
// 고정돼 있었고, 브랜드 헤더·제조국·제조원·사용방법·푸터는 Preview 컴포넌트에 하드코딩돼
// 있어 값으로 존재하지 않았다. 단일 품목(워시오프 팩 등)을 그리려면 그 하드코딩을 전부
// 필드로 끌어내야 하는데, 그러면 이미 인쇄해 쓰던 비누 라벨의 렌더 경로가 함께 바뀐다.
//
// migrateCosmeticFields는 그 회귀를 막는 지점이다. 레거시 구조가 들어오면 하드코딩이던
// 값을 그대로 채워 넣어, 확장 전후 렌더 결과가 같아지게 한다.

export interface CosmeticItem {
  en: string;
  ko: string;
  ingredients: string;
}

export interface CosmeticFields {
  collection: 'floral' | 'creamy' | 'custom';
  brandHeader: string;
  collectionLabel: string;
  optionLabel: string;
  itemCount: number;
  items: CosmeticItem[];
  weight: string;
  lotNumber: string;
  expiryDate: string;
  expiryNote: string;
  countryOfOrigin: string;
  manufacturer: string;
  usage: string;
  caution: string;
  importer: string;
  importerAddress: string;
  phone: string;
  footerNote: string;
  recycleMark: string;
  /** 라벨 전체 글자 크기 배율. 품목 수가 적으면 셀에 여백이 남으므로 키워서 채운다. */
  fontScale: number;
}

const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 3;

/** 확장 이전 Preview 컴포넌트에 하드코딩돼 있던 호주 비누 값들 */
const LEGACY_SOAP_META = {
  brandHeader: 'Australian Botanical',
  countryOfOrigin: '호주 (Australia)',
  manufacturer:
    'Australian Botanical Soap · 143 Scanlon Drive, Epping VIC 3076, Australia',
  usage:
    '물에 적셔 거품을 낸 후 세정 부위에 고르게 펴 바르고 깨끗한 물로 헹구어 냅니다. 사용 후 건조한 곳에 보관하세요.',
  caution:
    '1. 눈에 들어갔을 때는 즉시 씻어내십시오. 2. 어린이 손이 닿지 않는 곳에 보관하십시오. 3. 직사광선을 피해 보관하십시오. 4. 이상이 나타나면 사용을 중단하고 전문의와 상담하십시오. 5. 상처가 있는 부위에는 사용을 자제하십시오.',
  expiryNote: '또는 개봉 후 24개월',
  footerNote: 'Made in Australia',
  recycleMark: '♻종이/PE',
} as const;

/**
 * 전성분 칸을 넘친 만큼 배율을 줄여 되돌린다.
 *
 * 글자를 키우면 글자 높이와 줄 수가 함께 늘어, 텍스트 블록 높이는 배율의 제곱에 비례한다.
 * 그래서 넘친 비율의 제곱근만큼 줄이면 한 번에 거의 맞는다. 0.98은 반올림과 줄바꿈
 * 위치 변화로 한 줄이 더 생기는 경우를 흡수하는 여유분이다.
 *
 * 측정값이 0이면 아직 레이아웃 전(또는 jsdom)이므로 손대지 않는다.
 */
export function fitScale(
  current: number,
  contentHeight: number,
  availableHeight: number,
): number {
  if (!contentHeight || !availableHeight) return current;
  if (contentHeight <= availableHeight) return current;

  const shrunk = current * Math.sqrt(availableHeight / contentHeight) * 0.98;
  return Math.max(FONT_SCALE_MIN, +shrunk.toFixed(3));
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function scale(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n));
}

/** 레거시 soap1~soap4 구조를 items 배열로 옮긴다 */
function legacyItems(raw: Record<string, unknown>): CosmeticItem[] {
  return [1, 2, 3, 4].map((n) => ({
    en: str(raw[`soap${n}En`]),
    ko: str(raw[`soap${n}Ko`]),
    ingredients: str(raw[`soap${n}Ingredients`]),
  }));
}

/** 신규 구조의 items 배열을 읽는다. 비어 있거나 배열이 아니면 null */
function parseItems(value: unknown): CosmeticItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      en: str(item.en),
      ko: str(item.ko),
      ingredients: str(item.ingredients),
    };
  });
}

export function migrateCosmeticFields(raw: unknown): CosmeticFields {
  const src = (raw ?? {}) as Record<string, unknown>;

  // items가 있으면 신규 구조, 없으면 레거시 soap1~soap4로 간주한다.
  const items = parseItems(src.items) ?? legacyItems(src);

  const collection =
    src.collection === 'creamy' ? 'creamy'
      : src.collection === 'custom' ? 'custom'
        : 'floral';

  const defaultCollectionLabel =
    collection === 'creamy'
      ? '크리미 컬렉션 Variety Pack 4종'
      : '플로럴 컬렉션 Variety Pack 4종';
  const defaultOptionLabel =
    collection === 'creamy' ? 'Option 02 · Creamy' : 'Option 01 · Floral';

  return {
    collection,
    brandHeader: str(src.brandHeader, LEGACY_SOAP_META.brandHeader),
    collectionLabel: str(src.collectionLabel, defaultCollectionLabel),
    optionLabel: str(src.optionLabel, defaultOptionLabel),
    // itemCount는 items 길이가 진실이다. 저장된 값이 어긋나 있어도 렌더가 깨지지 않게 한다.
    itemCount: items.length,
    items,
    weight: str(src.weight),
    lotNumber: str(src.lotNumber),
    expiryDate: str(src.expiryDate),
    expiryNote: str(src.expiryNote, LEGACY_SOAP_META.expiryNote),
    countryOfOrigin: str(src.countryOfOrigin, LEGACY_SOAP_META.countryOfOrigin),
    manufacturer: str(src.manufacturer, LEGACY_SOAP_META.manufacturer),
    usage: str(src.usage, LEGACY_SOAP_META.usage),
    caution: str(src.caution, LEGACY_SOAP_META.caution),
    importer: str(src.importer),
    importerAddress: str(src.importerAddress),
    phone: str(src.phone),
    footerNote: str(src.footerNote, LEGACY_SOAP_META.footerNote),
    recycleMark: str(src.recycleMark, LEGACY_SOAP_META.recycleMark),
    fontScale: scale(src.fontScale),
  };
}
