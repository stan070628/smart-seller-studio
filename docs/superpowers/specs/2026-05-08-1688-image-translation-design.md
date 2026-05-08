---
title: 1688 상품 이미지 중국어→한국어 자동 번역 (오버레이)
date: 2026-05-08
status: draft
---

## 개요

1688에서 가져온 상품 상세 이미지에 박힌 중국어 텍스트를 한국어로 자동 치환하여, 셀러가 별도 편집 없이 쿠팡 상세페이지에 그대로 사용할 수 있게 한다.

원본 이미지를 그대로 게시하는 현재 흐름은 인포그래픽·사이즈표 같은 "글자가 핵심인 이미지"의 가치를 셀러가 그대로 활용하지 못하게 한다. 본 설계는 OCR로 글자 위치를 잡고, 그 위에 흰 박스 + 한국어를 얹는 "오버레이 방식"으로 가독성을 확보한다.

---

## 결정 사항 요약 (브레인스토밍 결과)

| 항목 | 선택 | 이유 |
|---|---|---|
| 품질 수준 | **B. 오버레이 방식** (흰 박스 + 한국어 텍스트) | 인페인팅 품질 편차 회피, 비용·속도 안정 |
| 적용 범위 | **C. lifestyle 제외 전부** | 메인 상품컷 라벨까지 커버, OCR 헛돌림은 textBox 0개 케이스에서 즉시 종료 |
| 엔진 | **A. Google Cloud Vision OCR + Claude 번역** | 좌표 정밀도 최우선. 번역은 기존 Claude 파이프라인에 얹어 일관성 확보 |
| UX | **B. 자동 번역 + 이미지별 원본/번역 토글** | 망한 케이스를 셀러가 즉시 원복 가능한 안전망 |

---

## 전체 파이프라인

기존 흐름에 `translate-images` 단계를 `classify`와 `generate` 사이에 신설한다.

```
classify  →  [NEW] translate-images  →  generate  →  미리보기 (토글 UI)
```

`translate-images` 라우트의 이미지별 처리:

```
원본 URL
 ├─ 캐시 조회 (image_translations, key = sha256(원본 URL))
 │   ├─ 히트 → translated_url 즉시 반환
 │   └─ 미스 ↓
 ├─ Google Vision OCR → [{ text_zh, bbox }, ...]
 ├─ 텍스트 0개 → status='no_text', translated_url=null
 ├─ Claude 배치 번역 → [{ text_zh, text_ko, bbox }, ...]
 ├─ sharp 합성: 흰 박스 + SVG 한국어 오버레이 → JPEG
 ├─ Supabase Storage 업로드 → translated_url
 └─ 캐시 저장 → 반환
```

핵심 원칙: **한 이미지 실패가 전체를 막지 않는다.** 실패 시 `translated_url=null`로 응답에 포함되며, 프론트는 해당 이미지에 대해 원본만 표시한다.

### 동시성 제어

- 라우트 내부에서 이미지를 **동시 5개까지** 병렬 처리 (`p-limit` 등 사용)
- 너무 많이 병렬화하면 GCV 쿼터·Vercel Function 메모리 압박이 동시에 터질 수 있음
- 캐시 히트는 동시성 제한과 무관하게 즉시 반환

---

## 신규 파일

| 파일 | 역할 |
|---|---|
| `src/app/api/listing/import-1688/translate-images/route.ts` | 새 API 라우트. classify 결과를 받아 이미지를 lifestyle 제외하고 병렬 처리 |
| `src/lib/listing/image-translator.ts` | 핵심 파이프라인 함수. 캐시 → OCR → 번역 → 합성 → 업로드 |
| `src/lib/listing/google-vision-client.ts` | `@google-cloud/vision` 래퍼. 서비스 계정 JSON으로 인증 |
| `src/lib/ai/prompts/translate-overlay.ts` | Claude 배치 번역 시스템·유저 프롬프트 + zod 스키마 |
| `src/lib/listing/sharp-overlay.ts` | sharp + SVG 합성 함수. 글자 크기 자동 축소 알고리즘 포함 |
| `supabase/migrations/056_create_image_translations.sql` | 캐시 테이블 + RLS |

## 변경 파일

- `src/lib/listing/import-1688-types.ts`
  - 이미지 객체에 `translatedUrl?: string` 필드 추가
  - `TranslateImagesRequest`, `TranslateImagesResponse` 타입 신설
- `src/lib/detail-page/html-builder.ts`
  - `<img>` 디폴트 `src`는 `translatedUrl ?? originalUrl`
  - `data-original-src` 속성에 원본 URL 함께 박음 (토글에서 복원용)
- `src/components/listing/import1688/ResultPreview.tsx`
  - 이미지 hover 시 우상단 토글 배지 [🇰🇷 한국어 ⇄ 🇨🇳 원본]
  - 클릭 시 `src` 교체. 셀러가 본 마지막 상태가 최종 저장본
  - `translatedUrl`이 null인 이미지는 토글 비활성, 원본만 표시
- `src/app/listing/import-1688/page.tsx`
  - classify 응답 후 `translate-images` 호출 단계 추가
  - state에 `translateProgress`(이미지별 처리 상태) 보관해 진행률 표시
- `src/app/api/listing/import-1688/generate/route.ts`
  - request body의 `images` 항목이 `translatedUrl?`을 포함한 채로 도착
  - generate는 변경 거의 없음 — html-builder가 알아서 처리

---

## 데이터 모델

### `image_translations` 테이블

```sql
create table image_translations (
  image_url_hash text primary key,        -- sha256(original_url)
  original_url   text not null,
  translated_url text,                    -- null = 텍스트 없거나 실패
  ocr_blocks     jsonb,                   -- [{ text_zh, text_ko, bbox: {x,y,w,h} }, ...]
  status         text not null check (status in ('ok','no_text','failed')),
  error_message  text,
  created_at     timestamptz default now()
);

create index image_translations_status_idx on image_translations(status);

-- RLS: service_role만 접근. 일반 사용자는 직접 접근 X (라우트 통과해야 함)
alter table image_translations enable row level security;
```

캐시 키를 `sha256(original_url)`로 잡는 이유: 같은 1688 상품을 여러 셀러가 import해도 한 번만 처리. 비용·시간 절감.

### Supabase Storage

번역본 저장 경로: `1688-translations/{image_url_hash}.jpg`
- 공개 버킷, 영구 캐시
- 같은 해시면 idempotent하게 덮어씀(overwrite=true)

---

## Sharp 합성 디테일

각 OCR 블록에 대해 흰 박스 + SVG 한국어 텍스트를 합성한다.

### 박스

- bbox를 픽셀 단위로 +2px 확장 → 안티앨리어싱 잔흔 가림
- 색: 단순 흰색 `#ffffff` 고정
- 배경색 샘플링은 본 범위에서 제외 (YAGNI). 1688 인포그래픽 대다수가 흰 배경, 그라디언트 위 텍스트는 어차피 깔끔히 안 됨.

### 글자

- 폰트: **Pretendard** (서버 번들에 폰트 파일 포함)
- 색: `#1a1a1a` 고정
- 초기 크기: bbox 높이의 70%
- **자동 축소 알고리즘**:
  1. SVG `<text>` 렌더 후 텍스트 폭이 박스 폭의 105%를 넘으면 1px씩 축소
  2. 최소 8px까지 시도
  3. 그래도 넘으면 줄바꿈 1회 허용 (높이 충분할 때만)
  4. 줄바꿈으로도 안 들어가면 말줄임표(`…`)로 잘라냄

### 출력

- 형식: JPEG, quality 90
- 원본 해상도 유지

폰트 폭 계산은 `text-to-svg` 또는 동등한 라이브러리로 메트릭 추출 (정확한 폭 계산이 자동 축소 알고리즘의 정확도를 좌우).

---

## 에러 처리 / 폴백

| 단계 | 실패 시 동작 |
|---|---|
| OCR 호출 자체 실패 (네트워크/쿼터) | 1회 재시도 → `status='failed'`, `translated_url=null` |
| OCR 결과 텍스트 0개 | `status='no_text'`, `translated_url=null` (원본 그대로 사용) |
| Claude 번역 실패 | 1회 재시도 → 실패 시 `status='failed'` |
| sharp 합성 실패 | 로그만 남기고 `status='failed'` |
| Supabase Storage 업로드 실패 | 1회 재시도 → 실패 시 `status='failed'` |
| 한 이미지 실패 | 다른 이미지 처리 계속. 라우트는 200 반환, 결과 배열에 실패 항목 포함 |
| `translate-images` 라우트 자체 실패 (예: 5xx) | 프론트는 원본 이미지로 그대로 generate 진행 가능하게 폴백 옵션 노출 |

---

## 토글 UI 명세

미리보기 컴포넌트의 `<img>` 래퍼:

- hover 시 우상단에 작은 pill 배지 노출: `🇰🇷 한국어` ⇄ `🇨🇳 원본`
- 클릭 시 `src`를 React state 토글로 교체
- 각 이미지의 토글 상태는 React state(`Map<imageId, 'ko'|'zh'>`)로 보관
- 저장 시 각 이미지의 마지막 상태에 해당하는 URL을 detailPageHtml에 박아 넣음
- `translatedUrl`이 null인 이미지: 토글 배지 비활성, 원본만 표시
- 일괄 토글(전체 원본/전체 한국어) 버튼은 본 범위에서 제외 (YAGNI)

---

## 외부 의존성 / 환경변수

### 신규 npm 패키지

- `@google-cloud/vision` — Google Vision OCR 클라이언트
- `text-to-svg` (또는 동등) — SVG 텍스트 폭 정확 계산

### 환경변수

- `GOOGLE_APPLICATION_CREDENTIALS_JSON` — 서비스 계정 JSON을 base64로 인코딩한 문자열
  - Vercel 환경변수에 추가
  - 라우트에서 디코드하여 `@google-cloud/vision` 클라이언트 초기화

### 자산

- Pretendard 폰트 파일을 `public/fonts/PretendardVariable.ttf`에 포함
- Vercel Function 번들에 포함되도록 `next.config` 또는 `vercel.json`에서 처리

---

## 테스트 전략

- **단위 (sharp-overlay.ts)**: 골든 샘플 5종으로 픽셀 회귀 — 짧은 라벨, 긴 캡션, 사이즈표, 그라디언트 배경, 작은 글자. diff 5% 이내 통과.
- **단위 (image-translator.ts)**: GCV·Claude·sharp 모두 mock. 캐시 히트/미스/에러 분기 커버.
- **통합 (translate-images route)**: Supabase mock. 부분 실패 시 응답 형태 검증 (배열 일부 항목만 `translatedUrl=null`).
- **E2E (Playwright)**: 1688 import 전체 플로 1회. 미리보기에서 토글 클릭 → 저장 → 결과 HTML에 올바른 URL 박혔는지 확인.

---

## 비용 / 성능 견적

이미지 1장 처리 시:
- Google Vision OCR: ~$0.0015
- Claude Sonnet 4.6 번역 (텍스트 평균 200자): ~$0.005
- sharp 합성: 200~500ms (Vercel Function 메모리 1GB 가정)
- **합계: ~$0.0065 / 장, 1.5~3초**

1688 import 1건 평균 10장(lifestyle 제외) 가정:
- **금액: ~$0.065 / import** (캐시 미스 100% 기준)
- **시간: 10장 병렬 처리 시 +5~10초**
- 캐시 히트율 50% 가정 시 절반으로 떨어짐

Supabase Storage:
- 1688 이미지 평균 200KB × 추가 저장 = 200KB/장 추가 (원본은 외부 URL 그대로 참조, 번역본만 저장)
- 1만 장 누적 시 ~2GB

---

## 향후 고려사항 (현재 범위 외)

- 사이즈표 전용 "표 다시 그리기" (D 옵션 일부) — 텍스트 레이아웃 분석 + HTML 표 → 이미지 렌더링
- 배경색 샘플링으로 박스 자연스러움 향상
- 일괄 토글(전체 원본/전체 번역) 버튼
- 셀러가 번역문을 수동 편집할 수 있는 인라인 에디터
- OCR/번역 비용 사용량 대시보드
