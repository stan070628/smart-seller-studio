# CLOVA API 연동 설계 스펙

> 작성일: 2026-05-26  
> 범위: Feature 1 (CLOVA OCR) + Feature 2 (CLOVA STT)  
> Feature 3 (Papago 번역)은 보류

---

## 배경

현재 `analyze-image`는 Claude Vision으로 이미지의 시각적 특징(소재·형태·색상·핵심부품)을 분석하지만, 이미지 내 인쇄된 텍스트(브랜드명·용량·성분·인증마크)는 정확히 추출하지 못한다. CLOVA OCR을 병렬로 추가하면 이 공백을 채우고, 카피 생성 품질을 높일 수 있다.

리뷰 입력은 현재 타이핑 전용이다. CLOVA STT를 추가해 음성 입력을 지원하면 셀러의 입력 마찰을 줄인다.

---

## 채택 접근법: Approach A (analyze-image 내 병렬 통합)

`analyze-image` route에서 Claude Vision과 CLOVA OCR을 `Promise.all`로 병렬 호출한다. 클라이언트는 기존처럼 `analyze-image`를 한 번만 호출하고, 응답에 포함된 `ocrText`를 Zustand에 저장했다가 `generate-frames` 호출 시 함께 전달한다.

---

## Feature 1: CLOVA OCR

### 데이터 흐름

```
[Sidebar] 이미지 업로드 → POST /api/ai/analyze-image
  └─ 서버: Promise.all([
       Claude Vision → { material, shape, colors, keyComponents, visualPrompt },
       CLOVA OCR    → { ocrText: string[] }
     ])
  └─ 응답: 기존 ImageAnalysisSchemaType + ocrText[]
  └─ 클라이언트: Zustand imageAnalysis.ocrText 저장

[Sidebar] AI 카피 생성 클릭 → POST /api/ai/generate-frames
  └─ 요청 바디에 ocrText: string[] 포함
  └─ 서버: buildFrameUserPrompt에 "이미지 텍스트" 섹션 추가 → Claude 호출
```

### 신규 파일

| 파일 | 설명 |
|------|------|
| `src/lib/ai/clova-ocr.ts` | CLOVA OCR API 래퍼. Base64 이미지를 받아 인식된 텍스트 배열 반환 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/api/ai/analyze-image/route.ts` | Claude Vision 호출과 Promise.all로 CLOVA OCR 병렬 호출. 응답에 ocrText 포함 |
| `src/lib/ai/schemas.ts` | `ImageAnalysisSchema`에 `ocrText: z.array(z.string()).default([])` 추가 |
| `src/lib/ai/prompts/frame-generation.ts` | `FrameUserPromptParams`에 `ocrText?: string[]` 추가. 값이 있을 때 "이미지 내 텍스트" 섹션으로 프롬프트에 주입 |
| `src/store/useEditorStore.ts` | imageAnalysis 관련 타입에 ocrText 반영 |
| `src/components/editor/Sidebar.tsx` | OCR 결과 섹션 추가 (ocrText.length > 0일 때만 렌더, chip 형태) |

### CLOVA OCR API

- 엔드포인트: `https://naveropenapi.apigw.ntruss.com/ocr/v1/infer`
- 인증: `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`
- 입력: 이미지 Base64 (첫 번째 이미지만 전달 — 상품 대표 이미지)
- 출력: 인식된 텍스트 블록 배열 → 텍스트 문자열만 추출해 `string[]` 반환

### 에러 처리

- CLOVA OCR 실패(네트워크 오류, API 오류 포함) → `ocrText: []`로 graceful degradation. Claude Vision 결과는 정상 반환
- 환경변수 미설정(`NAVER_CLOVA_OCR_API_KEY_ID` 없음) → OCR 호출 skip, `ocrText: []` 반환

### UI

사이드바 이미지 분석 결과 섹션 내:
- `ocrText.length > 0`일 때만 "텍스트 인식" 항목 렌더
- 인식된 텍스트를 소형 chip 태그 형태로 나열
- 빈 배열이면 섹션 전체 숨김 (빈 상태 메시지 없음)

---

## Feature 2: CLOVA STT

### 데이터 흐름

```
[VoiceInputButton] 마이크 버튼 클릭
  └─ 브라우저 MediaRecorder 시작 (WebM/Opus)
  └─ Zustand isRecording = true

[VoiceInputButton] 버튼 재클릭 or 60초 도달
  └─ MediaRecorder 종료 → Blob 수집
  └─ POST /api/ai/speech-to-text (오디오 바이너리)
  └─ 서버: CLOVA Speech → { text: string }
  └─ 리뷰 textarea에 텍스트 append (기존 내용 유지)
  └─ Zustand isRecording = false
```

### 신규 파일

| 파일 | 설명 |
|------|------|
| `src/lib/ai/clova-speech.ts` | CLOVA STT API 래퍼. 오디오 바이너리를 받아 텍스트 반환 |
| `src/app/api/ai/speech-to-text/route.ts` | POST endpoint. 오디오 바이너리를 받아 CLOVA Speech 호출 후 텍스트 반환 |
| `src/components/editor/VoiceInputButton.tsx` | 마이크 버튼 컴포넌트. 녹음 시작/종료, STT 호출, textarea append 담당 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/store/useEditorStore.ts` | `isRecording: boolean` 상태 및 setter 추가 |
| `src/components/editor/Sidebar.tsx` | 리뷰 입력 textarea 아래에 VoiceInputButton 마운트 |

### CLOVA STT API

- 엔드포인트: `https://naveropenapi.apigw.ntruss.com/recog/v1/stt`
- 인증: 동일 (`X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`)
- 입력: 오디오 바이너리 (WebM/Opus, 최대 60초), `lang=Kor`
- 출력: `{ text: string }`

### 녹음 종료 조건

- 버튼 재클릭 (주 종료 수단)
- 60초 도달 → 자동 종료 후 STT 전송 (경고 없이)
- ~~5초 침묵 감지~~ — 제외 (복잡도 대비 UX 개선 미미, 의도치 않은 종료 위험)

### 에러 처리

| 상황 | 처리 |
|------|------|
| 마이크 권한 거부 | 토스트: "마이크 접근 권한이 필요합니다" |
| CLOVA STT 실패 | 토스트: "음성 인식에 실패했습니다. 다시 시도해주세요". textarea 값 변경 없음 |
| 환경변수 미설정 | 서버에서 503 반환, 클라이언트 토스트 처리 |

### UI

- 기본 상태: `🎤 음성입력` 버튼
- 녹음 중: `⏹ 녹음중...` + 빨간 점 pulse 애니메이션
- STT 처리 중: 버튼 비활성화 + 로딩 스피너
- 녹음 완료 후 텍스트는 기존 textarea 내용 끝에 append (덮어쓰기 아님)

---

## 환경변수

```env
# CLOVA OCR
NAVER_CLOVA_OCR_API_KEY_ID=
NAVER_CLOVA_OCR_API_KEY=

# CLOVA STT
NAVER_CLOVA_SPEECH_API_KEY_ID=   # OCR과 같은 Application이면 동일 값
NAVER_CLOVA_SPEECH_API_KEY=
```

NCP 콘솔에서 하나의 Application에 두 서비스를 모두 등록하면 `API_KEY_ID`는 동일하게 사용 가능.

---

## 테스트 계획

### OCR

- [ ] 텍스트 있는 상품 이미지 → `ocrText` 정상 반환, 사이드바 chip 표시 확인
- [ ] `generate-frames` 프롬프트에 ocrText 섹션 포함 확인
- [ ] 텍스트 없는 이미지 → `ocrText: []`, 사이드바 섹션 숨김 확인
- [ ] CLOVA 키 미설정 → OCR skip, Claude Vision 정상 동작 확인

### STT

- [ ] 마이크 허용 → 녹음 → 재클릭 → 텍스트 textarea append 확인
- [ ] 마이크 거부 → 토스트 확인
- [ ] 60초 녹음 → 자동 종료 및 STT 전송 확인
- [ ] CLOVA STT 실패 → 토스트, textarea 값 유지 확인

---

## 구현 우선순위

| 순서 | 작업 | 예상 공수 |
|------|------|-----------|
| 1 | clova-ocr.ts 래퍼 + analyze-image 수정 | 0.5일 |
| 2 | schemas.ts + frame-generation.ts 수정 | 0.5일 |
| 3 | Sidebar OCR UI + Zustand 타입 반영 | 0.5일 |
| 4 | clova-speech.ts + speech-to-text route | 0.5일 |
| 5 | VoiceInputButton 컴포넌트 | 1일 |
| 6 | Sidebar VoiceInputButton 마운트 + Zustand isRecording | 0.5일 |
