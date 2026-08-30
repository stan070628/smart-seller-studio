// src/lib/ai/model-registry.ts
/**
 * AI 모델(인물) 레지스트리 — 캐릭터 시트로 인물을 고정한다.
 *
 * 문제: 씬 생성이 섹션마다 독립 호출이라 한 상세페이지 안에서도 컷마다
 * 다른 사람이 나왔다. prompts.ts의 PERSON_QUALITY는 표정·자세만 지정하고
 * 그 사람이 누구인지는 지정하지 않기 때문이다.
 *
 * 해법: 한 인물의 정면·반측면·옆모습을 한 장에 담은 캐릭터 시트를 만들어
 * 두고, 인물이 필요한 모든 생성에 그 시트를 참조로 붙인다.
 *
 * 🔵 2026-08-27 실측으로 확인했다. 같은 씬 3종을 시트 참조 있음/없음으로
 * 각각 생성한 결과, 시트를 붙인 쪽은 세 컷의 인물이 동일했고 텍스트 설명만
 * 준 쪽은 세 컷이 전부 다른 사람이었다.
 *
 * 🔴 시트를 새로 만들 때는 generateFrameImage(imagen.ts)를 쓸 수 없다.
 * 그 함수의 singleFrameConstraint가 multi-view/collage를 절대 금지하는데
 * 캐릭터 시트는 정의상 multi-view다. 생성 스크립트는
 * `공용 섹션/모델 캐릭터시트/charsheet2.mjs`에 있다.
 */

export type ModelSex = 'female' | 'male';

export interface ModelPersona {
  /** 안정 식별자. Storage 파일명과 같아야 한다 */
  id: string;
  sex: ModelSex;
  /** UI에 보이는 이름 */
  label: string;
  /** 어떤 상품에 어울리는지 — 선택을 돕는 힌트 */
  bestFor: string;
  /** 캐릭터 시트 Storage 경로 (버킷 내부 경로) */
  sheetPath: string;
}

const BUCKET_PUBLIC_PREFIX = '/storage/v1/object/public/smart-seller-studio/';

export const MODEL_PERSONAS: readonly ModelPersona[] = [
  {
    id: 'model_f_a',
    sex: 'female',
    label: '여성 A · 화사한 웨이브',
    bestFor: '생활용품·아동·캐주얼 의류 — 밝고 친근한 인상',
    sheetPath: 'model-sheets/model_f_a.jpg',
  },
  {
    id: 'model_f_b',
    sex: 'female',
    label: '여성 B · 청순 단정',
    bestFor: '뷰티·홈리빙·이너웨어 — 차분하고 단정한 인상',
    sheetPath: 'model-sheets/model_f_b.jpg',
  },
  {
    id: 'model_f_c',
    sex: 'female',
    label: '여성 C · 건강 발랄',
    bestFor: '스포츠·아웃도어·식품 — 생기 있는 인상',
    sheetPath: 'model-sheets/model_f_c.jpg',
  },
  {
    id: 'model_m_a',
    sex: 'male',
    label: '남성 A · 조각형 세련',
    bestFor: '남성 의류·시계·가전 — 정통 캠페인 모델',
    sheetPath: 'model-sheets/model_m_a.jpg',
  },
  {
    id: 'model_m_b',
    sex: 'male',
    label: '남성 B · 부드러운 미남',
    bestFor: '캐주얼·라이프스타일·2030 타깃 — 친근한 인상',
    sheetPath: 'model-sheets/model_m_b.jpg',
  },
] as const;

export function findPersona(id: string | undefined | null): ModelPersona | null {
  if (!id) return null;
  return MODEL_PERSONAS.find((p) => p.id === id) ?? null;
}

/**
 * 캐릭터 시트의 공개 URL을 만든다.
 *
 * loadReferenceImages는 allowlist에 속한 호스트만 fetch하므로(SSRF 방어)
 * Supabase Storage URL이어야 서버가 받아올 수 있다. 환경변수가 없으면
 * null을 돌려주고, 호출부는 시트 없이 진행한다 — 인물이 안 고정될 뿐
 * 생성 자체가 실패하지는 않아야 한다.
 */
export function personaSheetUrl(persona: ModelPersona): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}${BUCKET_PUBLIC_PREFIX}${persona.sheetPath}`;
}

/**
 * 매 생성 요청에 반복해서 붙이는 인물 고정 지시.
 *
 * 시트를 참조로 넣는 것만으로는 부족하다. Gemini는 참조 이미지를 "분위기
 * 힌트"로 흘려버릴 수 있어, 그것이 캐스팅 사진이라는 것을 문장으로 못박아야
 * 한다. 영상(홍아린 AI, 2026-08-25)이 "이 두 줄이 핵심"이라고 지목한 부분이다.
 */
export const IDENTITY_LOCK_INSTRUCTION =
  'IDENTITY LOCK: The person in this scene MUST be the exact same individual shown in the attached ' +
  'character reference sheet — same face structure, same eyes, same nose, same lips, same jawline, ' +
  'same hairstyle, same hair length and color, same skin tone, same apparent age. Treat the reference ' +
  'sheet as a casting photo of the model being photographed here. Do not substitute a different person. ' +
  'Ignore the plain t-shirt and grey backdrop in the reference sheet — those are studio setup, not part ' +
  'of this scene.';

/**
 * 제품 고정 지시 — 인물 경로에서 제품이 AI 렌더가 될 때 로고를 지킨다.
 *
 * 🔴 이 상수는 PRODUCT_FIDELITY_INSTRUCTION(prompts.ts)을 상쇄하려고 존재한다.
 * 그쪽은 *"as an independent creative work — not a direct reproduction of the
 * original photograph"*라고 **원본과 다르게 그리라고** 지시하는데, 2026-06-06
 * 스펙이 저작권 회피를 근거로 넣은 문구다. 그 근거는 2026-07-06 합성 경로
 * 도입(원본 픽셀을 그대로 내보냄)으로 이미 무너졌으나 문구만 남아 있다.
 *
 * 🔵 2026-08-27 실측: 나이키 다저스 반팔티(로고 4종)로 착용컷을 생성한 결과
 * 이 지시를 붙이면 Dodgers 필기체 워드마크·가슴 스우시·™이 모두 재현됐다.
 * 다만 **하단 나이키·MLB 마크가 누락되는 경우가 있어 완전하지 않다** —
 * 브랜드 상품은 생성 후 로고를 확대해 검수해야 한다.
 *
 * 🔵 같은 날 확인한 태스크 구분: "이 사진을 보정하라"(변형)는 프린트를
 * 재배치해버리지만 "참조를 보고 새 씬을 그려라"(생성)는 참조를 지킨다.
 * 두 경로를 같은 위험으로 묶으면 안 된다.
 */
export const PRODUCT_LOCK_INSTRUCTION =
  'PRODUCT LOCK (this overrides any earlier instruction to render the product as an independent or ' +
  'non-reproduced creative work): The product MUST be the exact same item shown in the attached product ' +
  'reference photo(s). Reproduce every printed graphic exactly as in the references — the same wordmark ' +
  'with the same letterforms and script style, the same brand marks in the same positions and relative ' +
  'sizes, the same colors. Do NOT invent, restyle, re-letter, relocate, or omit any logo, lettering, or ' +
  'trademark symbol. Do NOT add any graphic that is absent from the references. The product may drape, ' +
  'fold, or catch light naturally, but the printed artwork itself must stay faithful to the references.';
