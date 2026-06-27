# Point 씬 배경 제거 — Fidelity 개선

## 배경

Gemini로 생성된 Point 섹션 씬 이미지(알약, 약통 등)가 원본 제품과 다르게 생성되는 fidelity 문제. 원인: 레퍼런스 이미지에 배경이 포함되어 있어 Gemini가 배경 요소까지 학습, 제품 형태·색상 재현 정확도 저하.

Hero 섹션은 방금 edit 모드(원본 → Gemini 배경 교체)로 수정 완료. 이 스펙은 **Point 섹션(sectionType: lifestyle/detail/feature)만 대상**.

---

## 해결 방향

Point 씬 생성 전 ref 이미지에서 배경을 제거 → 순수 제품 이미지만 Gemini에 전달 + 프롬프트 강화.

```
기존:
  productImageUrls (배경 있음)
    → loadReferenceImages()
    → Gemini 씬 생성

변경 후:
  productImageUrls (배경 있음)
    → loadReferenceImages()
    → removeImageBackgrounds()  ← 신규 (Replicate API)
    → Gemini 씬 생성 + 강화된 프롬프트
```

---

## 변경 범위

| 파일 | 역할 |
|------|------|
| `src/lib/ai/remove-background.ts` | 신규 — Replicate API로 배경 제거, sharp로 흰 배경 JPEG 변환 |
| `src/app/api/ai/generate-scene-image/route.ts` | lifestyle/detail/feature 섹션 시 배경 제거 적용, 프롬프트 강화 |

환경변수 `REPLICATE_API_TOKEN` 필요 (`.env.local`, Vercel 환경변수).

---

## 상세 설계

### 1. `src/lib/ai/remove-background.ts` (신규)

**인터페이스:**
```typescript
import type { ReferenceImage } from './reference-images';

export async function removeImageBackgrounds(
  refs: ReferenceImage[],
): Promise<{ refs: ReferenceImage[]; anyRemoved: boolean }>
```

**동작 순서 (이미지 1장):**
1. `ReferenceImage.base64` (JPEG) → `data:image/jpeg;base64,...` data URL 생성
2. Replicate API 호출: `POST https://api.replicate.com/v1/models/cjwbw/rembg/predictions`
   - 입력: `{ image: dataUrl }`
   - 출력: 배경 제거된 PNG URL (polling 방식)
3. 결과 PNG URL → fetch → Buffer
4. sharp로 흰 배경(#FFFFFF) 위에 PNG 합성 → JPEG(quality 85) 변환
5. base64 → `ReferenceImage { base64, mimeType: 'image/jpeg' }` 반환

**실패 처리:**
- 이미지 1장 실패 시 원본 `ReferenceImage` 그대로 사용 (graceful fallback)
- 전체 실패 시 `anyRemoved: false` 반환 → 프롬프트 강화 문구 미적용
- `Promise.allSettled`로 병렬 처리 (최대 3장)

**환경변수:**
- `REPLICATE_API_TOKEN`: Replicate API 인증 토큰

**Replicate polling:**
- `predictions` POST → `{ id, status }` 반환
- `status === 'succeeded'`일 때까지 500ms 간격 polling (최대 60초)
- timeout 시 실패 처리

---

### 2. `generate-scene-image/route.ts` 변경

**배경 제거 적용 조건:**

```typescript
const BACKGROUND_REMOVAL_SECTIONS = new Set(['lifestyle', 'detail', 'feature']);

const productRefs = await loadReferenceImages({ ... });

let cleanRefs = productRefs;
let bgRemoved = false;
if (BACKGROUND_REMOVAL_SECTIONS.has(sectionType) && productRefs.length > 0) {
  const result = await removeImageBackgrounds(productRefs);
  cleanRefs = result.refs;
  bgRemoved = result.anyRemoved;
}

const allImages = [...baseImages, ...cleanRefs].slice(0, 3);
```

- `hero`: 미적용 (edit 모드로 이미 처리)
- `lifestyle`, `detail`, `feature`: 배경 제거 적용
- `baseImageUrl` (edit 모드)가 있더라도 `productRefs`에는 적용

**프롬프트 강화:**

배경 제거 성공(`bgRemoved === true`) 시 `PRODUCT_FIDELITY_INSTRUCTION` 앞에 추가 문구 삽입:

```typescript
const BG_REMOVED_PREFIX = `The reference image(s) provided have had their backgrounds removed — only the product itself is visible with a clean white background. `;

const BG_REMOVED_STRICT = ` STRICT FIDELITY CONSTRAINT: The reference shows the exact product to reproduce. Do NOT redesign, recolor, or reinterpret the product in any way — same shape, same color palette, same material texture, same proportions, same number of items. Treat it as a pixel-accurate reference for the product only.`;

// 프롬프트 조합
finalScenePrompt = directPrompt
  ? `${directPrompt} ${bgRemoved ? BG_REMOVED_PREFIX : ''}${PRODUCT_FIDELITY_INSTRUCTION}${bgRemoved ? BG_REMOVED_STRICT : ''}`
  : /* Claude 생성 후 동일 조합 */;
```

---

## 실패 시나리오 처리

| 시나리오 | 처리 |
|----------|------|
| Replicate API 키 없음 | 배경 제거 skip, 원본 ref로 씬 생성 (기존 동작) |
| 개별 이미지 배경 제거 실패 | 해당 이미지만 원본 사용, 나머지는 정상 처리 |
| 전체 배경 제거 실패 | `bgRemoved: false` → 강화 프롬프트 미적용, 기존 프롬프트로 씬 생성 |
| Replicate polling timeout | 실패 처리 → 원본 fallback |

---

## 범위 외

- Hero 섹션 배경 제거 (이미 edit 모드로 처리)
- `handleRegenerateScene` 단일 재생성 시 배경 제거 (차기 개선)
- Replicate 외 다른 배경 제거 서비스 연동
- 배경 제거 캐싱 (동일 이미지 재사용 시)
