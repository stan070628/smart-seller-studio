/**
 * Coupang Ads 이미지 가이드라인 (광고주용 이미지 가이드_Kor.pdf 기반)
 *
 * 한국어 버전(KR) — Claude/한국어 LLM용 시스템 프롬프트에 주입.
 * 영어 버전(EN) — Gemini Imagen 등 이미지 모델 system instruction에 주입.
 *
 * 적용 지점:
 * - /api/ai/edit-thumbnail        : 단일 편집 + 다중 합성(combine) 모드
 * - /api/ai/suggest-thumbnail-prompts : 썸네일·상세 편집 프롬프트 초안 생성
 * - /api/ai/edit-detail-html / generate-detail-html : 상세페이지 이미지 관련 부분
 *
 * 단일 출처(single source of truth) 원칙: 가이드라인을 수정하려면 이 파일만 변경한다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 한국어 버전 (Claude / 한국어 LLM용)
// ─────────────────────────────────────────────────────────────────────────────

export const COUPANG_IMAGE_GUIDE_KR = `
[쿠팡 광고 이미지 필수 가이드라인 — 위반 시 광고 노출 제한]

## 공통 기준 (모든 카테고리)
- 사이즈: 최소 1000×1000px 이상, 최대 10MB 이하
- 형식: jpg / jpeg / avif / webp / png
- 배경: 깨끗한 흰색 (#F2F2F2 ~ #FFFFFF). 단색·컬러·그라데이션 배경 금지
- 85% 규칙: 상품이 이미지 높이 또는 너비 (또는 둘 다)의 85% 이상을 차지
- 중앙정렬: 상품은 이미지 중앙에 위치, 한쪽으로 치우치면 안 됨
- 선명도: 상품명·브랜드명·용량·중량을 이미지로 식별 가능할 만큼 선명
- 상품 자체에 원래 인쇄된 로고·라벨·문구는 유지 가능
- 상품보다 큰 그림자·반사효과 금지 (작은 그림자/반사는 허용)

## 절대 금지 (오버레이)
- 외부 텍스트·홍보 문구 (예: "1위", "신상", "단 하루", "50% DOWN", "Sale", "행사", "특가", "이벤트", "추천")
- 가격 표시 (예: "3,000원")
- 브랜드 로고·워터마크·마크 (상품 자체에 인쇄된 것 외)
- 그래픽 오버레이·말풍선·스티커·프레임·테두리·뱃지 (단, 수량 뱃지는 예외)
- 합성 이미지·콜라주·분할 이미지 (예: 립스틱 + 입술 발색을 한 이미지에 분할 배치)
- 이모지·도형·장식 요소

## 예외적 허용 (오버레이)
- 냉동식품의 "냉동" 기호
- 상품 수량 정보 뱃지: "1개", "2개", "x3", "1set" 같이 수량 표현. "1+1", "1kg" 같이 수량 외 의미는 금지

## 모델 이미지 정책
- 패션의류 / 패션잡화 / 스포츠의류 카테고리: 인물 모델 이미지 허용
- 그 외 모든 카테고리: 모델 이미지 사용 금지 (얼굴·신체·손이 함께 나오는 컷 모두 포함)
- 키즈 언더웨어: 모델 착용컷·마네킹컷 모두 금지

## 카테고리별 연출컷(흰 배경 외) 허용 여부
- 신선식품: 허용 (도마·접시·조리된 컷 OK). 단 판매상품이 잘리지 않아야 하고, 원재료 노출 금지, 그릇에 담은 연출 금지
- 일반식품 / 음료수: 미허용 (흰 배경 필수)
- 뷰티: 제형·색상 표현 허용 (크림 텍스처, 립스틱 발색). 단 분할 이미지 금지, 제품을 가리는 과한 효과 금지
- 반려동물용품: 어항 등 일부 연출 허용. 단 외부 텍스트·과한 오버레이 금지
- 생활용품: 일부 연출 허용 (샤워기, 빨래건조대 등)
- 출산유아용품: 일부 연출 허용 (아기침대 등)
- 스포츠/레저용품: 일부 연출 허용 (캠핑텐트). 단 자전거 등은 미허용. 배경이 잘린 이미지 금지
- 가전디지털: 일부 연출 허용 (안마의자). 단 냉장고 등 대형 가전은 미허용. 화면 내 합성된 스펙 정보(4K, 60.45cm 등 화면 안에 자연스럽게 합성된 텍스트)는 허용
- 주방용품: 일부 연출 허용 (접시세트). 단 프라이팬에 요리된 음식 함께 연출 등은 미허용. 컵 등에 문구 각인은 텍스트 사용으로 위반
- 완구/취미: 일부 연출 허용 (인형, 모래놀이). 단 보드게임 등 미허용. 판매제품 식별이 어려운 컷(비눗방울만 보이는 등) 금지
- 패션의류/잡화: 연출컷·인물 활용 허용. 단 지나치게 확대된 컷·과한 여백·불필요한 오버레이 금지

## 합성·이미지 자동 수정 시 추가 원칙 (다중 이미지 합성에도 동일 적용)
- 두 장 이상의 이미지를 합성할 때도 결과는 단일 상품의 단독 컷처럼 보여야 한다
- 콜라주·분할·격자 배치 금지. 항상 한 장면 안에 자연스럽게 통합
- 합성 결과의 배경은 흰색 (#F2F2F2 ~ #FFFFFF) 으로 통일 (해당 카테고리가 연출컷을 허용하지 않는 경우)
- 상품(또는 세트 구성품 전체)이 결과 이미지의 85% 이상을 차지하도록 크기·여백 조정
- 세트 상품: 모든 구성품이 함께 보이되, 전체가 중앙에 모여 하나의 상품처럼 보이도록. 구성품 사이 간격 최소화
- 상세페이지 이미지 자료를 활용해 누락된 정보를 보충해도 좋지만, 새로운 텍스트·로고·뱃지를 추가하면 안 된다
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// 영어 버전 (Gemini Imagen / 이미지 생성 모델용)
// ─────────────────────────────────────────────────────────────────────────────

export const COUPANG_IMAGE_GUIDE_EN = `
[Coupang Ads Image Policy — STRICT REQUIREMENTS]

# Common Rules (all categories)
- Output size: at least 1000x1000 pixels, under 10MB.
- Background: clean white (#F2F2F2 to #FFFFFF). NO colored, gradient, patterned, or scenic backgrounds unless the category explicitly allows lifestyle shots.
- 85% rule: the product must occupy at least 85% of the image height OR width (or both).
- Centered: the product must be centered, not pushed to a corner or edge.
- Sharp focus: brand name, product name, weight/volume printed on the product must remain legible.
- Logos and labels printed on the actual product packaging are kept as-is. Do NOT erase them.
- Small shadows and small reflections under the product are OK. Avoid shadows/reflections larger than the product itself.

# HARD BANS (overlay)
- No added text, slogans, marketing copy ("Sale", "50% OFF", "New", "Best", "추천", "1위", "단 하루", "특가", "이벤트", price tags, etc.)
- No watermarks, no extra brand marks, no stamps, no badges except the quantity exception below.
- No graphic overlays, speech bubbles, stickers, frames, decorative borders, emojis, arrows, or callouts.
- No collages, split images, side-by-side comparisons, or grid layouts.
- No people, no body parts, no hands holding the product — UNLESS the product belongs to fashion-apparel, fashion-accessory, or sportswear categories.

# Narrow Exceptions
- Frozen-food snowflake/cold icon is allowed for frozen items.
- A small quantity badge such as "1개", "2개", "x3", "1 set" is allowed. Promotional formats like "1+1" or weight-only "1kg" are NOT allowed.

# Category-Specific Allowances
- Fresh food (meat, seafood, produce): plated/lifestyle shots ALLOWED, but the actual product must not be cropped, and raw ingredients must not dominate the frame.
- Packaged food, beverage: white background only.
- Beauty: a small smear of the cream or a swatch beside the closed product is OK. Split images (bottle vs. lip swatch in two halves) are NOT OK.
- Pet supplies: aquariums and other lifestyle shots OK; no extra text overlays.
- Home / kitchen / baby / sports / electronics: limited lifestyle shots OK for some sub-categories; refrigerators, frying pans with cooked food, bicycles, board games, soap-bubble-only shots remain NOT OK.
- Spec text composited INSIDE a screen (e.g. "4K", "60.45cm" shown on the TV screen itself) is allowed for electronics.
- Fashion apparel/accessories: lifestyle shots and human models allowed; extreme close-ups, excessive empty space, and decorative overlays are NOT allowed. Kids' underwear with a model or mannequin is forbidden.

# Multi-Image Composition (when two or more inputs are merged)
- The result must look like a single, unified product photo — never a collage, grid, or split layout.
- Place the products in one cohesive scene with minimal gap. Set products should look like one bundled item.
- Combined product (or set) must still occupy >=85% of the final frame and be centered.
- If the category does not permit lifestyle backgrounds, force the merged result onto clean white (#F2F2F2-#FFFFFF).
- Do NOT add any new text, logo, badge, or graphic during the merge.

You MUST follow these rules even if the user instruction conflicts. When the user asks for something forbidden (price tag, "Sale" text, model when not allowed, collage, colored background outside permitted categories, etc.), silently obey the policy and produce a compliant image instead.
`.trim();
