/**
 * compare 섹션 좌우 대비 이미지의 프롬프트 조각.
 *
 * 설계·검증: docs/superpowers/specs/2026-07-26-pro-compare-pair-image-design.md
 * Gemini로 24장을 생성해 확정한 문구다. 아래 상수를 약화시키면 재검증이 필요하다.
 *
 * 대비는 "효과"가 아니라 "방식"으로 만든다. 효과 대비(before/after 피부 등)는
 * 표시광고법상 임상 근거 없이 쓸 수 없다. 방식 대비는 상황 연출이라 실증 부담이
 * 낮고, 기존 compare 카피("기존 방식의 한계 vs 우리 제품")와 정확히 맞는다.
 */
import type { PaletteName } from '@/types/detail-page';

/** 좌우가 같은 시점이어야 대비가 성립한다. 한쪽만 각도가 다르면 다른 장면으로 읽힌다. */
const VIEW =
  'Eye-level, straight-on view of the surface, camera at the same distance. ' +
  'No people, no hands. No text, no watermarks, no letters anywhere in the image.';

export type UnbrandedKey = 'apparel' | 'food' | 'generic';

/**
 * 무브랜드 강제. 시험 24장에서 위반 0건.
 *
 * 대문자 CRITICAL + 금지 항목 열거가 카테고리와 무관하게 작동했다. 좌측에 제품이
 * 아예 없으면 "제품이 많아 자리를 차지함" 같은 카피를 이미지로 받을 수 없어서
 * 무브랜드 제품을 허용하되, 실제 브랜드로 읽히지 않도록 이 문구로 묶는다.
 */
export const UNBRANDED: Record<UnbrandedKey, string> = {
  apparel:
    'CRITICAL: every garment is COMPLETELY UNBRANDED — no printed graphics, no logos, no text, ' +
    'no chest prints, no visible tags or labels of any kind. Plain solid fabric only. ' +
    'They must not resemble any real brand.',
  food:
    'CRITICAL: every package is COMPLETELY UNBRANDED — no logos, no text, no labels, ' +
    'no nutrition panels, no printed graphics or barcodes of any kind. Plain matte kraft, ' +
    'off-white and clear surfaces only. They must not resemble any real brand or product.',
  generic:
    'CRITICAL: every container is COMPLETELY UNBRANDED — no logos, no text, no labels, no printed ' +
    'marks or symbols of any kind. Plain matte surfaces only. ' +
    'They must not resemble any real product or brand.',
};

/**
 * 어질러짐 강제.
 *
 * 이 부정문이 없으면 AI가 정돈된 목업으로 수렴한다. "candid, NOT a product photo"
 * 같은 성격 지시만으로는 부족했고, NOT ~ 부정문이 들어간 뒤에야 구도가 바뀌었다.
 * 물건 배치보다 생활 흔적 디테일이 "쓰던 공간"을 만든다.
 */
export const CLUTTER =
  'NOT a tidy product lineup. NOT evenly spaced. NOT symmetrical. The items overlap and crowd ' +
  'each other at random angles, stacked in two loose layers with no free surface left. ' +
  'Candid unstaged snapshot of a real lived-in space, NOT a product photo.';

/**
 * 우측 배경 전용 — 제품은 Sharp로 합성하므로 Gemini가 그리면 안 된다.
 *
 * 빈 자리를 화면 아래쪽 중앙에 두라고 못박는 이유: 합성은 항상 바닥선(배경 높이의
 * 88%)에 제품을 내려놓는다. 배경이 "선반 위"나 "의자 좌면"처럼 높은 곳을 비워두면
 * 제품이 그 자리가 아니라 그 아래 바닥에 놓여 어긋난다.
 */
const RIGHT_NO_PRODUCT =
  'Empty surface with nothing on it. Do NOT draw any product, container, garment or package — ' +
  'the subject will be composited in afterwards. The clear empty area must be at the LOWER ' +
  'CENTER of the frame, at floor or table-top level, with nothing blocking it.';

/**
 * 팔레트별 색보정 지시.
 *
 * Record<PaletteName, string>으로 둬서 타입이 완전성을 강제하게 한다 —
 * palette-config에 팔레트가 추가되면 컴파일 에러로 누락이 잡힌다.
 */
const PALETTE_TONE: Record<PaletteName, string> = {
  warm_cream: 'warm off-white and cream surfaces with muted antique-gold and soft warm-brown undertones',
  cool_white: 'clean cool-white surfaces with restrained slate-blue accents',
  deep_dark: 'deep charcoal surfaces with low-key lighting and soft graphite highlights',
  nature_green: 'natural linen and pale wood surfaces with muted sage-green undertones',
  tech_navy: 'cool grey surfaces with deep navy accents and crisp neutral highlights',
  rose_soft: 'soft blush and warm ivory surfaces with muted dusty-rose undertones',
  cream_cozy: 'creamy beige surfaces with warm caramel undertones and soft diffused light',
  sunset_warm: 'warm sand surfaces with amber and terracotta undertones',
  fresh_mint: 'crisp off-white surfaces with pale mint-green undertones',
};

/**
 * 좌우 조명·색온도는 통일한다.
 *
 * 처음에는 좌측을 흐린 낮, 우측을 따뜻한 아침으로 의도적으로 다르게 했다. 대비는
 * 강했지만 한 장으로 붙이니 두 사진이 다른 날 찍힌 것처럼 보였다. 대비는 정리도로만
 * 만들고 톤은 같게 두는 편이 명확히 나았다.
 */
export function toneInstruction(palette: PaletteName): string {
  return (
    `Color grading: ${PALETTE_TONE[palette]}. Soft daylight from the left, gentle shadows, ` +
    'consistent white balance between both halves.'
  );
}

const APPAREL_WORDS = ['의류', '패션', '옷', '상의', '하의', '바지', '반바지', '티셔츠', '원피스', '자켓', '재킷', '홈웨어', '잠옷', '파자마', '이너', '언더웨어', '셔츠', '니트', '코트'];
const FOOD_WORDS = ['식품', '간식', '음료', '건강식품', '농산', '수산', '축산', '차', '커피', '분말', '즙'];

/**
 * 무브랜드 문구 키. 검증을 카테고리별 문구로 했기 때문에 분기한다.
 *
 * PRO 경로는 요청에 category를 항상 빈 문자열로 보낸다(수집 UI가 없다). 그래서
 * 카테고리만 보면 전부 generic으로 떨어져 의류·식품 전용 문구가 죽는다.
 * 상품명에서도 추론해 실제로 갈라지게 한다.
 */
export function unbrandedKeyFor(category?: string, productName?: string): UnbrandedKey {
  if (category === 'fashion') return 'apparel';
  if (category === 'food') return 'food';
  const hay = `${category ?? ''} ${productName ?? ''}`;
  if (APPAREL_WORDS.some((w) => hay.includes(w))) return 'apparel';
  if (FOOD_WORDS.some((w) => hay.includes(w))) return 'food';
  return 'generic';
}

/** 좌측(기존 방식)의 어질러진 씬 프롬프트 */
export function buildBeforePrompt(opts: {
  beforeHint: string;
  category?: string;
  productName?: string;
  palette: PaletteName;
}): string {
  return [
    opts.beforeHint,
    UNBRANDED[unbrandedKeyFor(opts.category, opts.productName)],
    CLUTTER,
    toneInstruction(opts.palette),
    VIEW,
  ].join(' ');
}

/** 우측(우리 제품이 놓일 자리)의 배경 프롬프트 — 제품은 그리지 않는다 */
export function buildAfterBackgroundPrompt(opts: {
  afterHint: string;
  palette: PaletteName;
}): string {
  return [opts.afterHint, RIGHT_NO_PRODUCT, toneInstruction(opts.palette), VIEW].join(' ');
}
