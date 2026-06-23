# CLOVA API 연동 업데이트 요청서

> 작성일: 2026-05-26  
> 대상 프로젝트: smart_seller_studio  
> 우선순위 순으로 기술

---

## 배경 및 목적

현재 `smart_seller_studio`는 이미지 분석에 Claude Vision, 카피 생성에 Claude Sonnet, 키워드 수요 분석에 Naver Datalab을 사용하고 있다. Naver CLOVA API를 추가 연동하면 다음 두 가지 핵심 문제를 해결할 수 있다.

1. **이미지 텍스트 인식 공백**: Claude Vision은 이미지의 시각적 특징(색상·재질·분위기)을 잘 분석하지만, 상품 이미지 내 인쇄된 텍스트(브랜드명, 용량, 성분, 인증마크, 가격표 등)를 정확히 추출하는 데는 OCR 전용 모델이 더 신뢰성이 높다.
2. **카피 품질 향상 여지**: 현재 Claude 카피 생성 시 이미지에서 뽑아낸 텍스트 정보(스펙·인증·용량)가 컨텍스트에 포함되지 않아, 셀러가 수동으로 입력해야 하는 마찰이 있다.

---

## Feature 1: CLOVA OCR — 상품 이미지 텍스트 자동 추출

### 개요

셀러가 상품 이미지를 업로드하면, 기존 Claude Vision 분석과 **병렬**로 CLOVA OCR을 호출하여 이미지 내 텍스트를 추출한다. 추출 결과는 카피 생성 컨텍스트에 자동으로 주입된다.

### API

- 엔드포인트: `https://naveropenapi.apigw.ntruss.com/ocr/v1/infer`
- 인증: `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`
- 입력: 이미지 Base64 또는 URL
- 출력: 인식된 텍스트 블록 배열 (위치 좌표 + 텍스트)

### 변경 범위

#### 신규 파일

```
src/lib/ai/clova-ocr.ts          — CLOVA OCR API 래퍼
src/lib/ai/prompts/ocr-context.ts — OCR 결과를 카피 프롬프트에 주입하는 포매터
```

#### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/api/ai/analyze-image/route.ts` | Claude Vision 호출과 병렬로 CLOVA OCR 호출 추가. 두 결과를 합쳐서 반환 |
| `src/lib/ai/schemas.ts` | `ImageAnalysisSchema`에 `ocrText: string[]` 필드 추가 |
| `src/lib/ai/prompts/copy-generation.ts` | OCR 추출 텍스트를 프롬프트 컨텍스트에 섹션으로 추가 |
| `src/app/api/ai/generate-copy/route.ts` | 요청 바디에 `ocrText?: string[]` 수신, Claude 프롬프트에 포함 |

#### 환경변수 추가

```
NAVER_CLOVA_OCR_API_KEY_ID=
NAVER_CLOVA_OCR_API_KEY=
```

### 응답 스키마 변경 (예시)

```ts
// 기존
interface ImageAnalysisOutput {
  materials: string[];
  colors: string[];
  features: string[];
  visualPrompt: string;
}

// 변경 후
interface ImageAnalysisOutput {
  materials: string[];
  colors: string[];
  features: string[];
  visualPrompt: string;
  ocrText: string[];       // 추가: OCR 인식 텍스트 목록
  ocrRawBlocks?: unknown[]; // 옵션: 원본 좌표 데이터 (향후 하이라이트 UI용)
}
```

### UI 변경 (최소)

- 에디터 사이드바 이미지 분석 결과 섹션에 "텍스트 인식" 항목을 추가 표시
- OCR 결과가 없으면(텍스트 없는 이미지) 해당 섹션 숨김

### 에러 처리

- CLOVA OCR 실패 시 OCR 결과를 빈 배열로 처리하고 Claude Vision 결과는 정상 반환 (OCR은 보조 수단이므로 fatal 처리 안 함)

---

## Feature 2: CLOVA Speech (STT) — 리뷰 음성 입력

### 개요

현재 에디터 사이드바에서 셀러가 고객 리뷰를 **타이핑**으로 입력한다. 음성 입력 버튼을 추가하여, 셀러가 말로 리뷰 내용을 입력할 수 있게 한다. 브라우저 Web Speech API 대신 CLOVA Speech를 쓰는 이유는 한국어 인식률과 쇼핑 도메인 어휘 정확도 때문이다.

### API

- 엔드포인트: `https://naveropenapi.apigw.ntruss.com/recog/v1/stt`
- 인증: 동일 (`X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`)
- 입력: 오디오 바이너리 (PCM / WAV / MP3, 최대 60초)
- 출력: `{ text: string }`

### 변경 범위

#### 신규 파일

```
src/lib/ai/clova-speech.ts        — STT API 래퍼
src/app/api/ai/speech-to-text/route.ts — POST /api/ai/speech-to-text
src/components/editor/VoiceInputButton.tsx — 마이크 버튼 + 녹음 상태 UI
```

#### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/editor/Sidebar.tsx` | 리뷰 입력 영역에 `VoiceInputButton` 추가 |
| `src/store/useEditorStore.ts` | `isRecording: boolean` 상태 추가 |

#### 환경변수 추가

```
NAVER_CLOVA_SPEECH_API_KEY_ID=
NAVER_CLOVA_SPEECH_API_KEY=
```

(OCR과 Key ID를 공유하는 Application으로 발급 시 동일 값 사용 가능)

### 흐름

```
마이크 버튼 클릭
  → MediaRecorder로 브라우저 녹음 시작 (WebM/Opus)
  → 버튼 재클릭 또는 5초 침묵 감지 시 녹음 종료
  → /api/ai/speech-to-text 에 오디오 바이너리 POST
  → CLOVA Speech 호출 → 텍스트 반환
  → 리뷰 입력 textarea에 텍스트 자동 입력
```

### 에러 처리

- 마이크 권한 거부 시 안내 토스트 표시
- CLOVA STT 실패 시 에러 토스트, 입력값 변경 없음
- 오디오 60초 초과 시 클라이언트에서 자동 분할(향후 확장) 또는 경고 표시

---

## Feature 3: Papago Translation — 카피 다국어 번역 (보류)

> 현재 타겟이 국내 스마트스토어 셀러이므로 우선순위 낮음. 향후 글로벌 플랫폼 진출 시 추가.

### 개요

`/api/ai/generate-copy` 응답에 `translations` 필드를 추가하여, 생성된 한국어 카피를 영어·일본어·중국어로 자동 번역 제공.

### API

- 엔드포인트: `https://naveropenapi.apigw.ntruss.com/nmt/v1/translation`
- 입력: `source`, `target`, `text`

---

## 환경변수 전체 정리

기존 변수에 아래를 추가:

```env
# CLOVA OCR
NAVER_CLOVA_OCR_API_KEY_ID=
NAVER_CLOVA_OCR_API_KEY=

# CLOVA Speech (STT)
NAVER_CLOVA_SPEECH_API_KEY_ID=
NAVER_CLOVA_SPEECH_API_KEY=
```

NCP 콘솔에서 하나의 Application에 `CLOVA OCR`과 `CLOVA Speech Recognition` 두 서비스를 모두 등록하면 `API_KEY_ID`는 동일하게 사용 가능.

---

## 구현 우선순위

| 순서 | Feature | 예상 공수 | 비고 |
|------|---------|-----------|------|
| 1 | CLOVA OCR | 1~2일 | 기존 `analyze-image` 흐름에 병렬 추가, UI 변경 최소 |
| 2 | CLOVA STT | 2~3일 | 신규 컴포넌트 + 브라우저 MediaRecorder 연동 필요 |
| 3 | Papago | 미정 | 비즈니스 니즈 확인 후 |

---

## 테스트 계획

### OCR
- [ ] 텍스트 있는 상품 이미지 → OCR 결과 정상 반환 확인
- [ ] 텍스트 없는 이미지(사진) → 빈 배열 반환, 에러 없음
- [ ] CLOVA OCR 키 미설정 시 → OCR 스킵, Vision 분석 정상 동작
- [ ] OCR 결과가 카피 생성 프롬프트에 포함되는지 확인

### STT
- [ ] 마이크 권한 허용 → 녹음 및 텍스트 변환 정상 동작
- [ ] 마이크 권한 거부 → 안내 메시지 표시
- [ ] 한국어 쇼핑 도메인 어휘("쿠팡", "스마트스토어", "무료배송") 인식률 확인
- [ ] 60초 초과 녹음 시 동작 확인
