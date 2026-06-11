# 상품상세 자동만들기 — 쿠팡 모바일 스타일 완전 재설계

날짜: 2026-06-11
상태: 승인됨 (Approach B — 모바일 전용 콘텐츠 스키마 신설)

## 1. 배경 / 문제

`/listing/detail-maker`(상품상세 자동만들기)가 생성하는 상세페이지가 모바일에서 보기 부적합하다.

- `section-renderer.ts`의 섹션 패딩이 `60px 40px` — 375px 모바일 화면에서 측면 여백만 80px를 차지해 콘텐츠 폭이 약 215px로 줄어든다.
- 헤딩이 데스크톱 기준 고정 크기이고 미디어 쿼리가 거의 없다.
- 이미지 섹션에 side padding이 있어 전체 폭을 활용하지 못한다.
- 전반적인 구조(Hero → 카드 3개 → 리스트)가 쿠팡 모바일 상세페이지의 검증된 패턴(후킹 헤더 → Point N 섹션 → 옵션 그리드 → 스펙 테이블)과 다르다.

참고 자료: 쿠팡 모바일 상세페이지 캡처 12장(킵틸 KeepTill 펜파우치) — 사용자 제공.

## 2. 핵심 아키텍처 결정

### 2-1. 섹션 타입 체계에 통합 (HTML 빌더 별도 신설 아님)

`DetailMakerClient`는 생성 직후 `contentToSections()`로 섹션을 파싱해 `DetailPageEditor`에 넘기고, 이후 사용자가 보고 편집하고 다운로드하는 HTML은 전부 `/api/detail-page/render` → `section-renderer.ts`가 렌더링한다. 별도 HTML 빌더의 출력은 섹션 파싱 성공 즉시 버려진다.

따라서 쿠팡 모바일 구조를 **섹션 타입 체계 자체에 추가**하여 에디터·렌더 API를 그대로 통과하게 한다.

```
AI 생성: images → Claude → MobileDetailPageContent (Point N 구조 스키마)
        → mobileContentToSections() → DetailSection[] (신규 타입 포함)
        → DetailPageEditor (기존 에디터 그대로)
        → /api/detail-page/render → section-renderer.ts (신규 타입 렌더러 추가)
```

이로써 섹션 드래그 정렬, AI 섹션 편집, 테마 변경, 렌더 API가 전부 기존 경로 그대로 동작한다.

### 2-2. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/types/detail-page.ts` | 신규 섹션 타입 3종(`brand_header`, `point`, `image_grid`) + `DetailPageTheme.layoutMode` 추가 |
| `src/lib/ai/prompts/detail-page.ts` | `MobileDetailPageContent` 스키마 + 모바일 시스템 프롬프트 + `parseMobileDetailPageResponse` |
| `src/lib/detail-page/section-parser.ts` | `mobileContentToSections()` 추가, `createEmptySection`에 신규 타입 3종 케이스 추가 |
| `src/lib/detail-page/section-renderer.ts` | 신규 타입 3종 렌더러 + 기존 4종(hero/spec_table/warning/cta)의 mobile layoutMode 분기 |
| `src/app/api/ai/generate-detail-html/route.ts` | `mobileMode` 파라미터 → 모바일 프롬프트 분기, `content` 응답에 모바일 구조 포함 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `mobileMode: true` 전달, theme 초기값 `layoutMode: 'mobile'` |

기존 4개 섹션 타입의 desktop 렌더링과 기존 메뉴(`/detail` 등)는 영향 없음 (`layoutMode` 기본값 `'desktop'`).

## 3. 신규 섹션 타입

```ts
// 브랜드 헤더 — "킵틸 KeepTill ──── pencil pouch" 줄
interface BrandHeaderContent {
  type: 'brand_header';
  brandName: string;     // 좌측 (브랜드명)
  rightLabel: string;    // 우측 (영문 카테고리, 예: "pencil pouch")
}

// Point 섹션 — 쿠팡 스타일의 핵심. "Point N" 라벨 + 볼드 헤딩 + 부제 + 전체폭 이미지
interface PointContent {
  type: 'point';
  pointLabel: string;    // "Point 1" — 빈 문자열이면 라벨 줄 숨김 ("넉넉하게" 류 요약 섹션)
  headline: string;      // 예: "펼치면 바로 '보이는' 필통"
  subheadline: string;   // 예: "180도 완전 오픈형 구조"
}
// 이미지는 기존 attachedImages 필드 재활용 (전체폭, padding 0 렌더링)

// 이미지 그리드 — "Product Info." 색상 옵션 2컬럼
interface ImageGridContent {
  type: 'image_grid';
  title: string;                                  // "Product Info." (빈 값이면 생략)
  items: Array<{ label: string; swatchColor?: string }>; // "레드" + ● 스와치
}
// 각 item의 이미지는 attachedImages와 index로 매칭
```

`SectionType` 유니온, `SectionContent` 유니온, 타입 가드 3종(`isBrandHeaderContent` 등)을 함께 추가한다.

## 4. 테마 확장 — layoutMode

```ts
interface DetailPageTheme {
  // ... 기존 필드 유지
  layoutMode?: 'desktop' | 'mobile';  // 기본값 'desktop' — 기존 흐름 무영향
}
```

`section-renderer.ts`가 `layoutMode === 'mobile'`일 때 hero/spec_table/warning/cta를 모바일 스타일(패딩 24px 20px, 큰 타이포, 전체폭 이미지)로 렌더링한다. 렌더 API는 이미 theme을 통째로 전달하므로 API 시그니처 변경 없음. `mobile_hero`/`mobile_spec` 같은 중복 타입은 만들지 않는다.

## 5. AI 출력 스키마 — MobileDetailPageContent

```ts
interface MobileDetailPageContent {
  brandName: string;            // 없으면 상품명에서 유추
  categoryLabelEn: string;      // "pencil pouch"
  hook: {                       // 최상단 후킹 섹션
    eyebrow: string;            // "Keep Till" — 필기체 렌더링
    headline: string;           // "완전 오픈 · 넉넉한 수납"
    hashtags: string[];         // ["#한눈에 보여", "#쉽게 꺼내", "#깔끔하게 정리"]
  };
  points: Array<{               // 3~4개 — Point 1/2/3 + 요약 섹션
    pointLabel: string;         // "Point 1" 또는 ""
    headline: string;
    subheadline: string;
  }>;
  colorOptions: Array<{ label: string; swatchColor: string }>; // 없으면 빈 배열
  specs: Array<{ label: string; value: string }>;
  warnings: string[];
  ctaText: string;
}
```

hook은 기존 `hero` 섹션으로 변환된다 — eyebrow는 기존 `DetailSection.eyebrow` 필드, hashtags는 subheadline에 합쳐 mobile hero 렌더러가 분리 표시한다(공백 2칸 구분 `#태그` 패턴). 별도 타입을 만들지 않는다.

## 6. 이미지 자동 배치 규칙 (업로드 1~6장)

`mobileContentToSections(content, imageUrls)`가 결정적으로 매핑한다:

- `img[0]` → hook(hero) 전체폭 메인 이미지
- `img[1..n]` → 각 point 섹션에 순서대로 1장씩
- 남는 이미지 2장 이상 → `image_grid`에 배치, 정확히 1장 → 마지막 point에 추가
- 이미지가 부족하면 point 섹션은 텍스트만 렌더링 (이미지 줄 생략)
- `colorOptions`가 빈 배열이고 남는 이미지도 없으면 `image_grid` 섹션 자체를 생략

## 7. 섹션 출력 순서

`brand_header` → `hero`(hook) → `point` ×3~4 → `image_grid` → `spec_table` → `warning` → `cta`

## 8. AI 프롬프트 — 카피라이팅 가이드

참고 이미지의 카피 패턴을 시스템 프롬프트에 반영한다.

- **hook 헤드라인**: 명사형 압축 — `"완전 오픈 · 넉넉한 수납"`처럼 가운뎃점(·)으로 가치 2개 연결, 12자 이내. 해시태그 3개, 각 5~7자.
- **point 헤드라인**: 작은따옴표 강조 활용 — `펼치면 바로 '보이는' 필통`, `펼치면 '박스처럼' 서는 설계`. subheadline은 구체적 사실 1문장.
- **라벨 없는 요약 point**: 부사형 한 단어 헤드라인(`넉넉하게`, `든든하게`, `조용하게`) + 구체 부연(`20 CM 자·가위도 여유롭게 들어요`).
- **금칙**: 기존 `checkProhibitedPhrases` 그대로 적용. 번역투 금지·쿠팡 광고 가이드 조항(효능 과장, "1위", "세일" 금지 등)은 기존 프롬프트에서 승계.
- **파서**: `parseMobileDetailPageResponse` — JSON 추출 → 필수 필드 검증 → 부분 누락 시 빈 배열 fallback (기존 `parseDetailPageResponse`와 동일 방식).

## 9. 렌더링 타이포 스펙 (mobile layoutMode)

| 요소 | 스펙 |
|------|------|
| 컨테이너 | maxWidth 780px 유지 (쿠팡 규격), 텍스트는 모바일 축소를 견디는 큰 사이즈 |
| brand_header | 좌 15px/600 `#333`, 우 13px `#999`, 하단 1px `#ddd` 보더, 패딩 16px 20px |
| hook eyebrow | 필기체 `'Snell Roundhand','Brush Script MT',cursive` fallback 체인, 22px, `#8a7560` |
| hook headline | 34px / 800 / `#1a1a1a`, letter-spacing -1px, 중앙 정렬 |
| hashtags | 18px / 700, flex 가로 나열, gap 16px, 중앙 정렬 |
| point label | 이탤릭 세리프 26px `#999` (`Georgia, serif; font-style:italic`) + 상단 체크 아이콘 ☑ |
| point headline | 28px / 800 / `#111`, 중앙 정렬 |
| point subheadline | 17px / 400 / `#555` |
| 이미지 | 전체폭 `width:100%; display:block`, 이미지 섹션 패딩 0 (텍스트 블록만 24px 20px) |
| image_grid | 2컬럼 `display:flex;flex-wrap:wrap`, 셀 50%, 라벨 = ● 스와치 14px + 텍스트 15px |
| spec_table | 회색 패널 `#f4f5f7` 위 행 구분선, label 40% `#666`, value `#222`, 15px, 패딩 14px |
| warning / cta | 기존 디자인 유지, 패딩 32px 20px로 축소 |

섹션 간 여백은 마진 대신 각 섹션 패딩으로 처리한다(쿠팡 인라인 스타일 제약 호환). 모든 스타일은 인라인 — 기존 렌더러 방식 그대로. 텍스트 출력은 전부 `escapeHtml` 경유.

## 10. 에디터 호환

- `SECTION_LABELS`에 3종 추가: `brand_header: '브랜드 헤더'`, `point: '포인트'`, `image_grid: '이미지 그리드'`
- `createEmptySection`에 3종 케이스 추가 (수동 섹션 추가 지원)
- AI 섹션 편집(`/api/detail-page/edit-section`)은 섹션 content를 JSON으로 다루므로 신규 타입 자동 호환 — 프롬프트에 신규 타입 설명만 추가

## 11. DetailMakerClient 변경

- 생성 요청에 `mobileMode: true` 고정 (이 메뉴는 모바일 전용으로 전환)
- theme 초기값에 `layoutMode: 'mobile'` 설정
- 응답 처리: 기존 `contentToSections(json.content)` 대신 `mobileContentToSections(json.mobileContent, uploadedUrls)` 호출
- 미리보기는 기존 DetailPageEditor 프리뷰 그대로 (HTML 자체가 모바일 스타일이므로 추가 변경 최소화)

## 12. API 변경 — generate-detail-html

- `RequestSchema`에 `mobileMode: z.boolean().optional()` 추가
- `mobileMode === true`이면: 모바일 시스템 프롬프트로 카피 생성 → `MobileDetailPageContent` 파싱 → 응답 `content`에 포함 (`mobileContent` 필드로 구분)
- 신규 모드의 초기 `html`/`snippet`은 `mobileContentToSections` + `renderAllSections`(mobile theme)로 생성 — 클라이언트 fallback과 동일 경로 사용으로 이중 구현 방지
- 기존 모드(`mobileMode` 미지정)는 동작 변화 없음

## 13. 테스트

- `mobileContentToSections` 단위 테스트: 이미지 0/1/3/6장 배치 규칙, colorOptions 빈 배열 + 남는 이미지 없을 때 image_grid 생략, 섹션 순서·order 연속성
- `parseMobileDetailPageResponse` 파싱/필수 필드 누락 fallback 테스트
- 신규 렌더러 3종 + mobile layoutMode 분기 테스트 (escapeHtml 적용, padding 0 이미지 전체폭 확인)
- 기존 desktop 렌더링 회귀 없음 확인 (layoutMode 미지정 시 기존 스냅샷 동일)

## 14. 범위 외 (YAGNI)

- 상표등록증/브랜드 신뢰 섹션 — 참고 이미지에 있으나 입력 데이터가 없어 제외
- Gemini 씬 합성 이미지 생성 연동 — 기존 `includeImagePrompts` 경로 그대로, 이번 범위 아님
- 기존 데스크톱 템플릿 제거 — 유지 (다른 메뉴에서 사용 중)
