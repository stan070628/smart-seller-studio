# 설계: 상세페이지 Gemini AI 이미지 동시 생성 + 이미지 교체 기능

**날짜**: 2026-06-06  
**대상 메뉴**: 썸네일·상세만 만들기 (AssetsTab) / AI 상품등록 (Step 3)

---

## 배경 및 목적

현재 상세페이지 HTML 생성 시 Claude가 텍스트/레이아웃을 만들고, 업로드한 원본 이미지를 그대로 사용한다. 사용자는 섹션별 AI 연출 이미지를 Gemini Nano Banana(외부 툴)에서 하나씩 수동으로 만들어 붙이고 있다.

이 설계는 Gemini API를 앱에 직접 통합하여 상세 HTML 생성과 동시에 섹션 이미지를 자동 생성하고, 마음에 들지 않는 이미지는 외부에서 만든 이미지로 교체할 수 있게 한다.

---

## 요구사항

1. 상세 HTML 생성 시 `includeAiImages` 옵션을 켜면 Gemini가 섹션 이미지 3~5장을 함께 생성한다.
2. 원본 상품(소재, 텍스트, 크기, 형태)은 절대 변형하지 않는다. 배경·조명·환경만 변경한다.
3. 생성된 이미지가 마음에 들지 않으면 파일 업로드 또는 URL로 교체할 수 있다.
4. 이미지 생성 실패 시 원본 업로드 이미지로 graceful fallback한다.
5. AssetsTab과 AI 상품등록 Step 3 양쪽에 동일하게 적용된다.

---

## 아키텍처

### 생성 파이프라인

```
[Phase 1 — Claude, ~5초]
  이미지 분석(기존) + 콘텐츠 구조 생성(기존)
  + 섹션별 Gemini 이미지 프롬프트 3~5개 생성 (신규)

[Phase 2 — Gemini, ~15초, 병렬]
  원본 업로드 이미지(reference) + 각 프롬프트로 섹션 이미지 병렬 생성

[Phase 3 — HTML 빌더]
  AI 생성 이미지 + 기존 로직으로 HTML 완성
```

Phase 1 → Phase 2는 순차 (Claude 프롬프트가 Gemini 입력으로 필요).  
Phase 2 내부(이미지 3~5장)는 `Promise.all`로 병렬 실행.

### 전체 소요 시간
- `includeAiImages: false` (기존): ~5초
- `includeAiImages: true` (신규): ~20~30초

---

## 생성 이미지 구성

| 번호 | 역할 | 설명 |
|------|------|------|
| img_1 | 메인 히어로 | 화이트 스튜디오 배경, 정면 제품샷 |
| img_2 | 라이프스타일 | 실제 사용 장면 연출 |
| img_3 | 소재/디테일 | 소재·질감·마감 클로즈업 |
| img_4 | 셀링포인트 강조 | 주요 기능/특징 시각화 |
| img_5 | 추가 앵글 (선택) | 상품 복잡도에 따라 옵션 |

Claude가 상품 분석 결과를 바탕으로 각 이미지에 맞는 영어 프롬프트를 생성하고, 해당 프롬프트를 Gemini에 전달한다.

---

## 상품 원형 보존 규칙

모든 Gemini 이미지 생성 프롬프트에 아래 규칙을 고정 삽입한다 (system 레벨 강제).

```
CRITICAL RULES — must follow exactly:
- Do NOT alter the product's shape, size, or proportions
- Do NOT change any text, logos, labels, or printed graphics on the product
- Do NOT change the material, texture, or color of the product itself
- Only change the background, lighting, and surrounding environment
- The product must look IDENTICAL to the reference image provided
```

Claude가 섹션 프롬프트를 생성할 때도 위 제약을 지키도록 Claude system prompt에 동일 규칙 추가.

---

## API 변경

### `/api/ai/generate-detail-html` (수정)

**추가 파라미터**
```typescript
includeAiImages?: boolean  // default: false (하위 호환 유지)
```

**추가 응답 필드**
```typescript
aiImages?: Array<{
  url: string;      // Supabase Storage 업로드 후 공개 URL
  role: string;     // 'hero' | 'lifestyle' | 'detail' | 'feature' | 'extra'
  prompt: string;   // 생성에 사용된 프롬프트 (디버그/교체 참조용)
}>
```

`includeAiImages: false`이면 기존 동작 완전 동일 (기존 호출부 수정 불필요).

---

## UI 변경

### AssetsTab — 입력 패널 (`AssetsInputPanel`)

- 기존 "생성" 버튼 위에 토글 추가:
  ```
  ☑ Gemini AI 이미지 포함 생성  (+20~30초)
  ```
- 생성 진행 메시지 상세화:
  - "Claude 상품 분석 중..."
  - "섹션 이미지 프롬프트 생성 중..."
  - "Gemini 이미지 생성 중 (2/4)..."
  - "HTML 완성 중..."

### AssetsTab — 결과 패널 (`AssetsResultPanel`)

`includeAiImages`로 생성된 경우, 상세 HTML 미리보기 위에 **AI 이미지 교체 패널** 표시:

```
[AI 생성 이미지 목록]
  ┌─────────────────────────────────────────┐
  │  [썸네일]  메인 히어로               │
  │            [🔄 교체] [🗑 삭제]          │
  ├─────────────────────────────────────────┤
  │  [썸네일]  라이프스타일              │
  │            [🔄 교체] [🗑 삭제]          │
  └─────────────────────────────────────────┘
```

**교체 방법 (🔄 교체 클릭 시)**:
1. **파일 업로드**: PC에서 이미지 선택
2. **URL 붙여넣기**: 나노바나나 등 외부 툴에서 만든 이미지 URL 직접 입력

교체/삭제 시 HTML 미리보기 실시간 반영.

### AI 상품등록 Step 3

- 상세페이지 생성 섹션에 동일한 토글 배치
- 생성 후 동일한 교체 패널 표시

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| Gemini 이미지 생성 전체 실패 | 원본 업로드 이미지로 HTML 생성 + 경고 토스트 |
| 일부 이미지만 실패 | 성공한 이미지 사용, 실패 슬롯은 원본 이미지로 대체 |
| GOOGLE_AI_API_KEY 미설정 | 503 에러 + "AI API 키 미설정" 메시지 |
| Gemini 과부하 | 원본 이미지 fallback + "잠시 후 재시도" 안내 |

---

## 영향 범위

| 파일 | 변경 유형 |
|------|----------|
| `src/app/api/ai/generate-detail-html/route.ts` | 수정 (Phase 1~3 파이프라인 추가) |
| `src/lib/ai/imagen.ts` | 재사용 (기존 `generateFrameImage` 활용) |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 (토글 추가) |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 수정 (이미지 교체 패널 추가) |
| `src/components/listing/assets/AssetsTab.tsx` | 수정 (includeAiImages 플래그 전달) |
| `src/store/useListingStore.ts` | 수정 (aiImages 상태 추가) |
| AI 상품등록 Step 3 상세페이지 생성 컴포넌트 | 수정 (토글 + 교체 패널) |

---

## 미결 사항

- 없음 (설계 확정)
