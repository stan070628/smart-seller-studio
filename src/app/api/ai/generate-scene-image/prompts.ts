/**
 * generate-scene-image의 시스템 프롬프트 + Gemini 지시 상수 단일 출처.
 * Claude에 보내는 사용자 프롬프트는 ./user-prompt.ts에 있다 — 새 문자열을 넣을 때
 * 어느 쪽인지 먼저 판단할 것.
 *
 * 여기 있는 문자열은 실물 생성으로 검증된 것이다. 문구를 약화시키면 결과가 달라지므로
 * 수정 전에 반드시 실제 생성으로 재검증할 것. 특히 NOT ~ 형태의 부정문은
 * "AI가 수렴하는 기본값을 배제"하는 역할이며, 긍정 지시로 대체하면 효과가 사라진다.
 *
 * 검증 근거: docs/superpowers/specs/2026-07-26-pro-model-wearing-design.md
 */

// ── 인물 품질 조건절 ────────────────────────────────────────────────────
// 실물 35장 생성으로 확정된 인물 서술. 예전에는 sectionType: 'wearing' 전용
// 경로(buildWearingInstruction)로 프레이밍까지 강제했으나, 실물 검증에서
// (a) Claude가 그 슬롯 자체를 만들지 않았고 (b) 만들어도 gender/프레이밍
// 지시가 뒤에서 이겨내지 못했다. 반면 flux_lifestyle(자유 프레이밍)는 이미
// 한국인·정적 포즈·색보존이 된 착용컷을 만들었다 — 프레이밍만 자유롭게 두고
// "인물이 나오면 이래야 한다"는 조건절만 남긴다.
//
// 작명 규칙: <제약 대상>_<값|기준>. 접두사는 무엇을 제약하는지를 말한다
// (MODEL/POSE/COLOR — `MODEL`은 항상 패션 모델(인물)을 가리키며 AI 모델이 아니다).
// 접미사는 그 대상에 지시하는 값(KO, STATIC) 또는 그 대상을 규정하는 기준·축
// (CONTEXT, ACCURACY)이다. 예: 배경 관련 상수를 추가하면 BACKGROUND_*.

/** 인물 외형 서술(성별별). */
export const MODEL_KO = {
  male:
    'a Korean man in his late twenties with a clean modern Korean haircut — softly layered, ' +
    'natural black hair, fair even skin tone, slim build',
  female:
    'a Korean woman in her late twenties with long straight black hair, natural dewy Korean makeup, ' +
    'fair even skin tone, slim build',
} as const;

/**
 * "East Asian"에서 시작했으나 중국인처럼 보인다는 지적을 받았다. "Korean"으로 바꿔도
 * (MODEL_KO) 범아시아 평균으로 애매하게 수렴했다 — 이 상수의 한국 화보 맥락·스타일링
 * 명시(긍정 지시)와 "not a Western or Chinese catalog"(부정 지시)가 함께 작용해
 * 한국 화보 전형으로 고정시켰다.
 */
export const MODEL_CONTEXT =
  'Styled like a Korean lifestyle magazine editorial shot in Seoul, not a Western or Chinese catalog.';

/** 제품 색 보존. 골든아워에서 화이트 민소매가 살구색으로 렌더된 것을 막는다 */
export const COLOR_ACCURACY =
  'COLOR ACCURACY IS CRITICAL: neutral daylight with accurate white balance. ' +
  "The product's color must match the reference image exactly — a white item renders as pure white. " +
  'NOT golden hour, NOT sunset, NOT warm color cast.';

/**
 * 포즈 제약. 동적 포즈는 손을 뭉개고(프레임 배제 지시도 통하지 않았다)
 * 팔을 들면 프레임 기준이 밀려 크롭이 깨진다.
 */
export const POSE_STATIC =
  'POSE CONSTRAINTS: both arms stay BELOW shoulder height — never raised, never overhead. ' +
  'Hands hang naturally relaxed with open fingers or rest in pockets — never clenched into fists. ' +
  'The person stands, leans or walks slowly — NO running, NO jumping, NO mid-action motion.';

/**
 * 인물 품질 조건절. "If a person appears"로 시작해 인물을 강제하지 않는다 —
 * Claude가 씬에 인물을 넣을지는 기존 판단(promptHint 등)에 맡기고, 넣었을 때만
 * 한국인·정적 포즈·중립 조명을 보장한다. 성별은 뒤에서 덮어쓰지 않고(실물에서
 * 실패한 방식) male/female 서술을 나란히 제시해 Claude가 씬에 맞게 고르게 한다.
 */
export const PERSON_QUALITY =
  `If a person appears, they must look confident, comfortable, and at ease — relaxed or lightly ` +
  `positive expression, upright active posture. No grimacing, exhaustion, hunching over, hands on ` +
  `knees, slumping, distress, or discomfort. They must be Korean — either ${MODEL_KO.male}, or ` +
  `${MODEL_KO.female} — whichever matches the scene and the product's likely wearer. ${MODEL_CONTEXT} ` +
  `${POSE_STATIC} ${COLOR_ACCURACY}`;

export const PRODUCT_FIDELITY_INSTRUCTION = `Using the attached product image(s) as a visual reference, study the product's overall shape, proportions, color palette, material texture, and key design details, then render it as a new photorealistic image naturally integrated in the scene. The product rendition should faithfully capture the reference's essential visual characteristics (form, color scheme, distinctive features) as an independent creative work — not a direct reproduction of the original photograph. IMPORTANT: Use EXACTLY the same quantity of items as shown in the reference image — do not add more items, do not duplicate products. SINGLE FRAME ONLY: Generate exactly one single continuous photograph — no split panels, diptychs, multi-view layouts, before/after comparisons, or composite image compositions. NO SPARKLE MARKS: Do NOT render any four-pointed star, sparkle, glitter, or diamond glyph anywhere in the image — not on the garment, product surface, or background. If such a mark appears in the reference image, treat it as an artifact and omit it. POSITIVE SUBJECT: ${PERSON_QUALITY}`;

// 아래에서 PRODUCT_FIDELITY_INSTRUCTION을 보간한다 → 이 선언보다 먼저 와야 한다.
export const SCENE_PROMPT_SYSTEM = `You are an expert e-commerce product photographer and AI image prompt engineer.

Given one or more reference images of the SAME product (often photographed from different angles) and product information, create a highly detailed English prompt for Gemini image generation that will produce a professional commercial lifestyle scene.

Rules:
- The product from the reference image(s) MUST appear prominently in the generated scene
- Create a COMPLETE scene with the product naturally integrated — not just a background
- Be extremely specific: lighting quality, environment details, props, camera angle, mood, color palette
- Do NOT include any text, logos, watermarks, or price tags in the scene description
- Do NOT describe any four-pointed star, sparkle, or glitter mark on the product or background. If a person appears, describe a confident, comfortable, energetic subject — never fatigue, strain, or discomfort.
- The output must be a photorealistic commercial photography scene
- CRITICAL PRODUCT COUNT: The multiple reference images show the SAME single product from different angles — they do NOT represent multiple products. Carefully count the EXACT number of each item type that makes up ONE product unit (e.g., "1 spoon and 1 chopstick set" or "3 bottles sold together"). Your prompt MUST specify this EXACT count. NEVER duplicate or multiply items based on the number of reference images provided. State the count explicitly: "exactly 1 [item]" etc.
- CRITICAL: The generated prompt MUST end with this exact instruction: "${PRODUCT_FIDELITY_INSTRUCTION}"

Section type directions:
- hero: Clean studio shot with the product as the clear hero. Dramatic professional lighting, minimal elegant background, product centered.
- lifestyle: Product shown in its actual real-world use context. Creative authentic scene (e.g. fragrance diffuser hanging from a car rearview mirror, cutlery arranged on a fine dining table, skincare product on a marble bathroom counter). Natural or mood lighting.
- detail: Extreme close-up macro shot of the product's most distinctive material, texture, or craftsmanship detail. Very shallow depth of field, soft bokeh.
- feature: Aspirational scene that visually communicates the product's key function or benefit. Creative and conceptual but still photorealistic.

Return ONLY valid JSON: {"prompt": "your detailed English prompt here"}`;

// 합성 모드 전용 시스템 프롬프트: Claude가 "제품이 포함된 씬"이 아니라
// "빈 배경 플레이트" 프롬프트를 처음부터 작성하도록 한다. 기존에는
// SCENE_PROMPT_SYSTEM(제품 필수 등장)으로 쓴 프롬프트에 no-product suffix를
// 덧붙여 모순이 생겼고, Gemini가 절충안으로 카테고리 소품(라켓 등)을 지어냈다.
export const BACKGROUND_PROMPT_SYSTEM = `You are an expert e-commerce art director writing a Gemini image-generation prompt for an EMPTY background plate.

A real cut-out photograph of the product will be composited onto this background later, placed at the lower-center of the frame and occupying roughly the lower half. Study the attached product reference image(s) ONLY to infer an appropriate setting, camera height, and lighting direction — the product itself must NOT appear in the background and must NOT be described in your prompt.

Rules:
- Describe ONLY the environment: the location, surfaces, lighting, and atmosphere.
- Absolutely NO products, merchandise, packaging, or any equipment/accessories from the product's category. NO people, hands, or body parts.
- Require a clean, unobstructed, well-lit horizontal surface (floor, table, or counter) across the LOWER-CENTER foreground where the product will rest.
- Specify a single consistent key light with a clear direction and believable grounded shadows, so the composited product can be matched to the scene.
- Be extremely specific: lighting quality, environment details, camera angle, mood, color palette.
- Photorealistic commercial photography only. No text, logos, watermarks, sparkles, four-pointed stars, split panels, or collages.

Section type directions:
- lifestyle: an authentic real-world setting where the product would naturally be used — the location and surfaces only, natural daylight, grounded eye-level perspective, no equipment or items from the product's category present.
- detail: a macro-photography backdrop — a softly blurred neutral surface (marble, linen, concrete) with gentle diffused lighting.
- feature: a premium editorial studio backdrop with visual depth — a subtly textured dark surface with soft directional light, dramatic but physically plausible.

Return ONLY valid JSON: {"prompt": "your detailed English background prompt here"}`;

// 공통: 제품 제외 지시
const NO_PRODUCT_BASE =
  '\n\nCRITICAL: Do NOT include any product, item, bottle, jar, package, container, pill, capsule, or any tangible object in this generated image. ' +
  'Generate ONLY the background environment — the setting, surface, lighting, and atmosphere. ' +
  'The product will be composited onto this background separately. ' +
  // 합성 제품이 바닥에 놓인 것처럼 보이도록 하부 전경에 명확한 지면과 일관된 광원을 확보한다.
  'Leave a clear, unobstructed, well-lit horizontal surface (ground, floor, table, or counter) across the LOWER-CENTER foreground where a product will naturally rest. ' +
  'Use a single consistent light source with believable, grounded shadows so a composited product will match the scene lighting and cast direction.';

// 섹션 타입별 배경 분위기 보강 지시
const SECTION_BG_HINTS: Record<string, string> = {
  feature:
    ' Use rich, atmospheric studio lighting with a premium, high-contrast look. ' +
    'The background should have visual depth — a subtly textured dark surface (matte fabric, brushed metal, stone, deep gradient) ' +
    'with soft directional light that creates a dramatic, editorial feel. Avoid plain white or empty-looking backgrounds.',
  detail:
    ' Use a clean macro-photography backdrop: a softly blurred, slightly warm or cool neutral surface ' +
    '(marble, linen, concrete) with gentle diffused lighting to highlight material texture.',
  lifestyle:
    ' Create an authentic, true-to-life real-world SETTING where this product would naturally be used — ' +
    'the location, surfaces, and atmosphere only, with NO equipment, gear, or items from the product\'s category present, ' +
    'shot like a real editorial/commercial photograph with natural daylight and a grounded, eye-level perspective. ' +
    'AVOID the typical "AI look": no heavy bokeh/blur haze, no dreamy glow or bloom, no lens flare, no oversaturation, ' +
    'and NO blurry, faceless, or ghost-like human figures in the background. Keep lighting and shadows physically consistent.',
};

// 동일 카테고리 연관 물품(장비·액세서리·동반 제품)까지 금지 — "환경 소품"으로
// 위장한 카테고리 물품(예: 셔틀콕 씬의 라켓)이 배경에 등장하는 것을 막는다.
const NO_CATEGORY_PROPS =
  ' Do NOT include the product itself OR any related equipment, accessories, tools, companion products, or merchandise from the same product category ' +
  '(e.g., if the product is a shuttlecock: no rackets, no racket bags, no nets, no players; if it is a phone case: no phones). ' +
  'The scene must contain NO recognizable product of any kind — an empty, prop-light environment only.';

export function buildNoProductSuffix(sectionType: string, productName?: string): string {
  const hint = SECTION_BG_HINTS[sectionType] ?? '';
  const trimmedName = productName?.trim();
  const identity = trimmedName
    ? ` The product being sold is: "${trimmedName}". Nothing resembling it or its category may appear in this background.`
    : '';
  return NO_PRODUCT_BASE + NO_CATEGORY_PROPS + identity + hint;
}

// ── 합성 후 리파인 패스 (환경변수 SCENE_COMPOSITE_REFINE=true 일 때만) ─────
// Sharp 합성 결과를 Gemini에 유일한 참조로 넘겨 조명/그림자/가장자리만
// 정합시킨다. 제품을 다시 그릴 위험이 있으므로 기본 OFF — 반드시 플래그로만.
export const COMPOSITE_REFINE_PROMPT =
  'This is a composite photograph: a real product photo has been placed onto a generated background. ' +
  'Refine it into a seamless photorealistic image. STRICT RULES: keep the product\'s exact shape, colors, ' +
  'proportions, position, and every visible detail pixel-faithful — do NOT add, remove, move, resize, or ' +
  'redraw any object, and do NOT alter the product in any way. ONLY harmonize: match the lighting and color ' +
  'temperature between the product and the background, correct the contact shadow so the product sits ' +
  'naturally on the surface, and soften the cut-out edges. Output a single continuous photograph, no text.';
