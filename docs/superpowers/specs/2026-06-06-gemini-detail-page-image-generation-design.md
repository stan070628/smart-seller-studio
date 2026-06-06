# 설계: 상세페이지 Gemini AI 이미지 동시 생성 + 이미지 교체 기능

**날짜**: 2026-06-06  
**대상 메뉴**: 썸네일·상세만 만들기 (AssetsTab) / AI 상품등록 (Step 3)  
**상태**: 최종 확정 (Opus 4.8 리뷰 반영)

---

## 배경 및 목적

현재 상세페이지 HTML 생성 시 Claude가 텍스트/레이아웃을 만들고, 업로드한 원본 이미지를 그대로 사용한다. 사용자는 섹션별 AI 연출 이미지를 Gemini Nano Banana(외부 툴)에서 하나씩 수동으로 만들어 붙이고 있다.

이 설계는 Gemini API를 앱에 직접 통합하여 상세 HTML 생성과 동시에 섹션 이미지를 자동 생성하고, 마음에 들지 않는 이미지는 교체할 수 있게 한다.

---

## 요구사항

1. "AI 이미지 포함" 옵션을 켜면 Gemini가 섹션 이미지 3~5장을 자동 생성한다.
2. 모든 섹션 이미지는 동일한 비주얼 아이덴티티(색감·무드·조명)를 공유하여 디자인 통일성을 갖는다.
3. 원본 상품(소재, 텍스트, 크기, 형태)은 절대 변형하지 않는다. 배경·조명·환경만 변경한다.
4. 이미지 내에 어떠한 텍스트도 생성하지 않는다 (Gemini의 한글 렌더링 불안정 대응).
5. 생성된 이미지가 마음에 들지 않으면 파일 업로드 또는 URL 입력으로 교체할 수 있다.
6. 이미지 생성 실패 시 원본 업로드 이미지로 graceful fallback한다.
7. AssetsTab과 AI 상품등록 Step 3 양쪽에 동일하게 적용된다.

---

## 아키텍처

### 핵심 결정: 클라이언트 분산 호출

단일 거대 API 호출 대신 **클라이언트가 단계별로 직접 호출**한다.

- 진행률을 SSE 없이 자연스럽게 표시 가능
- 이미지 1장 실패해도 나머지 진행 (`Promise.allSettled`)
- 기존 `generate-frame-image` 라우트 재사용 (신규 API 불필요)
- 교체/재생성도 동일 라우트 재사용

### 3단계 클라이언트 오케스트레이션

```
[Step 1 — Claude, ~5초]
POST /api/ai/generate-detail-html  (기존 라우트, includeAiImages 없음)
→ 반환: content (섹션 구조) + imagePrompts (섹션별 Gemini 프롬프트 4개)
  ※ generate-detail-html은 기존과 동일하게 동작, imagePrompts만 추가 반환
메시지: "상품 분석 완료. AI 이미지 생성 시작..."

[Step 2 — Gemini, 병렬, ~20~30초]
POST /api/ai/generate-frame-image × 4장 (기존 라우트, 병렬)
→ 각 완료 시 진행 카운터 업데이트
메시지: "AI 이미지 생성 중 (1/4)... (2/4)... (3/4)... (4/4)"
※ Promise.allSettled로 부분 실패 허용

[Step 3 — HTML 조립, ~1초]
클라이언트에서 buildAiDetailPageHtml(content, aiImages) 호출
→ 역할 기반 레이아웃으로 HTML 완성
메시지: "HTML 완성 중..."
```

### 전체 소요 시간

- 기존 (AI 이미지 없음): ~5초
- 신규 (AI 이미지 포함): ~25~35초
  - Stability AI 워터마크 제거(장당 ~2~3초) 포함 시 ~35~50초

---

## API 변경

### `/api/ai/generate-detail-html` (최소 수정)

기존 동작 완전 유지. `includeAiImages` 플래그 없이, `imagePrompts` 필드만 추가 반환.

**추가 응답 필드**
```typescript
imagePrompts?: Array<{
  role: 'hero' | 'lifestyle' | 'detail' | 'feature';
  prompt: string;           // Gemini에 전달할 영어 프롬프트 (비주얼 아이덴티티 포함)
  referenceImageIndex: number; // 원본 이미지 중 reference로 쓸 인덱스
}>
visualIdentity?: {          // 디버그/로깅용
  colorPalette: string;
  mood: string;
  lighting: string;
  background: string;
}
```

`imagePrompts`가 없으면 기존 플로우 그대로 (하위 호환 완전 유지).

### `maxDuration` 추가

```typescript
// generate-detail-html/route.ts
export const maxDuration = 120;
```

### `/api/ai/generate-frame-image` (기존 재사용)

변경 없음. Step 2에서 그대로 호출.

---

## 신규 함수: `buildAiDetailPageHtml`

`src/lib/detail-page/ai-html-builder.ts` (신규)

기존 `buildDetailPageHtml`은 건드리지 않는다.

### 역할 기반 레이아웃

```
┌──────────────────────────────────────────┐
│  [히어로 이미지 — 전체 폭]                │
│  헤드라인 + 서브헤드라인                  │
├──────────────────────────────────────────┤
│  셀링포인트 1 텍스트  │  라이프스타일 이미지 │
├──────────────────────────────────────────┤
│  소재/디테일 이미지  │  셀링포인트 2 텍스트  │
├──────────────────────────────────────────┤
│  기능 강조 이미지 — 전체 폭               │
│  특징 목록                               │
└──────────────────────────────────────────┘
```

- 순수 함수: 클라이언트/서버 양쪽에서 호출 가능
- snippet(780px) / naverSnippet(860px) / fullHtml 3벌 동시 생성
- AI 이미지 일부 없을 때: 원본 이미지로 graceful fallback

---

## 비주얼 아이덴티티 + 프롬프트 구조

### Claude가 생성하는 비주얼 아이덴티티

상품 이미지와 카테고리를 분석하여 자동 정의:

| 항목 | 예시 (리빙) | 예시 (패션) |
|------|------------|------------|
| Color palette | warm ivory, soft beige, muted sage | deep navy, crisp white, gold accent |
| Mood | premium minimal, calm | bold, editorial, confident |
| Lighting | soft diffused natural light | dramatic side lighting |
| Background | off-white linen texture | clean studio white |

### 각 섹션 이미지 프롬프트 구조

```
[1] 비주얼 아이덴티티 (공유 prefix — 4장 모두 동일)
"Visual style: {colorPalette}. Mood: {mood}. Lighting: {lighting}.
 Background: {background}."

[2] 섹션별 장면 설명 (각각 다름)

[3] 상품 원형 보존 + 텍스트 금지 규칙 (공유 suffix — 4장 모두 동일)
"CRITICAL RULES:
 - Do NOT alter the product's shape, size, proportions, or colors.
 - Do NOT change any text, logos, labels, or printed graphics on the product.
 - Do NOT change the material or texture of the product itself.
 - Only change the background, lighting, and surrounding environment.
 - The product must look IDENTICAL to the reference image.
 - Do NOT render any text, letters, words, captions, or typography anywhere
   in the generated image. The image must be completely text-free.
   (The product's original printed labels must be preserved as-is.)"
```

---

## 이미지 교체 설계

### 클라이언트 상태 구조

교체는 "HTML 문자열 치환"이 아닌 **구조 보관 후 빌더 재실행** 방식.

```typescript
// useListingStore — aiImageSlots 추가
aiImageSlots: Array<{
  role: 'hero' | 'lifestyle' | 'detail' | 'feature';
  url: string;        // Supabase Storage URL
  prompt: string;     // 원본 생성 프롬프트 (재생성 시 재사용)
  isOriginal: boolean; // false = AI 생성, true = 사용자 교체
}>
```

교체 발생 시:
1. 해당 슬롯의 `url` + `isOriginal` 업데이트
2. `buildAiDetailPageHtml(content, aiImageSlots)` 재실행
3. html / snippet / naverSnippet 3벌 동시 갱신

### 교체 방법

| 방법 | 처리 |
|------|------|
| 파일 업로드 | 클라이언트 → Supabase Storage 업로드 → URL 확보 |
| URL 붙여넣기 | **서버를 통해 Storage에 재업로드 필수** (외부 URL 직접 사용 시 쿠팡/네이버 등록 시 깨짐) |
| Gemini 재생성 | 동일 프롬프트로 `generate-frame-image` 재호출 |

### 결과 패널 UI

```
[AI 생성 이미지]
  ┌────────────────────────────────────────────┐
  │  [썸네일]  히어로           AI 생성        │
  │            [🔄 교체] [↺ 재생성] [🗑 삭제]  │
  ├────────────────────────────────────────────┤
  │  [썸네일]  라이프스타일     AI 생성        │
  │            [🔄 교체] [↺ 재생성] [🗑 삭제]  │
  └────────────────────────────────────────────┘
```

삭제 시: 원본 업로드 이미지로 fallback (빈 슬롯 없음).

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| Gemini 이미지 전체 실패 | 원본 이미지로 buildAiDetailPageHtml + 경고 토스트 |
| 일부 이미지 실패 (`Promise.allSettled`) | 성공 슬롯은 AI 이미지, 실패 슬롯은 원본 이미지 대체 |
| 워터마크 제거 실패 | 워터마크 있는 원본 Gemini 이미지 그대로 사용 |
| 외부 URL 재업로드 실패 | 에러 토스트 "이미지 URL을 가져올 수 없습니다" |
| GOOGLE_AI_API_KEY 미설정 | 503 + "AI API 키 미설정" |
| Gemini safety filter 차단 | 해당 슬롯 원본으로 대체 + 슬롯에 "생성 불가" 표시 |
| maxDuration 초과 | 클라이언트 분산 호출 구조상 Step별 timeout 관리 가능 |

---

## 영향 범위

| 파일 | 변경 유형 |
|------|----------|
| `src/app/api/ai/generate-detail-html/route.ts` | 수정 — `imagePrompts` + `visualIdentity` 추가 반환, `maxDuration` 추가 |
| `src/lib/ai/prompts/detail-page.ts` | 수정 — 비주얼 아이덴티티 + 이미지 프롬프트 생성 로직 추가 |
| `src/lib/detail-page/ai-html-builder.ts` | **신규** — 역할 기반 레이아웃 빌더 |
| `src/app/api/ai/generate-frame-image/route.ts` | 재사용 (변경 없음) |
| `src/store/useListingStore.ts` | 수정 — `aiImageSlots` 상태 추가 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 — "AI 이미지 포함" 토글 추가 |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 수정 — 이미지 교체 패널 추가 |
| `src/components/listing/assets/AssetsTab.tsx` | 수정 — 3단계 클라이언트 오케스트레이션 로직 |
| AI 상품등록 Step 3 컴포넌트 | 수정 — 동일 토글 + 교체 패널 |

---

## 미결 사항

없음. 설계 최종 확정.
