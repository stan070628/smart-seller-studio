/**
 * reference-analysis.ts
 *
 * 관리자 레퍼런스 학습 기능용 Claude 프롬프트
 *
 * - REFERENCE_ANALYSIS_SYSTEM_PROMPT: 역할 정의 + 출력 규칙
 * - buildReferenceUserPrompt: 이미지 + 템플릿 코드를 포함하는 유저 메시지 빌더
 */

// ─────────────────────────────────────────────────────────────────────────────
// 시스템 프롬프트
// ─────────────────────────────────────────────────────────────────────────────

export const REFERENCE_ANALYSIS_SYSTEM_PROMPT = `당신은 쿠팡 상세페이지 전문 디자이너입니다.
레퍼런스 이미지를 분석하여 React/TypeScript 템플릿 코드의 시각 스타일을 개선하는 것이 역할입니다.

## 핵심 제약 사항 (반드시 준수)

1. **기능 로직 변경 금지**: 이벤트 핸들러, 상태 관리, 데이터 처리 로직은 일체 변경하지 않습니다.
2. **TemplateProps 인터페이스 유지**: 컴포넌트의 props 타입 정의를 변경하지 않습니다.
3. **인라인 style 객체 값만 수정**: className이 없는 프로젝트이므로, JSX의 style={{ }} 속성 내부 값(색상, 폰트 크기, 여백, 테두리 등)만 변경합니다.
4. **캔버스 크기 유지**: 최상위 컨테이너의 width(780px), height(1100px)는 절대 변경하지 않습니다.
5. **theme 속성 보존**: theme prop을 통해 주입되는 색상 변수는 제거하지 않습니다. theme를 사용 중인 곳에 하드코딩된 색상을 덮어쓰지 않습니다.
6. **import 구문 유지**: 파일 상단의 import 구문은 변경하지 않습니다.
7. **EditableText 컴포넌트 유지**: EditableText 사용 위치와 props를 변경하지 않습니다.

## 분석 및 출력 지침

레퍼런스 이미지에서 다음 요소를 파악하여 템플릿에 반영하세요:
- 색상 팔레트 (배경색, 텍스트색, 강조색)
- 타이포그래피 스타일 (폰트 크기 비율, 자간, 행간, 폰트 굵기)
- 여백 및 패딩 리듬 (섹션 간격, 내부 여백)
- 장식 요소 (구분선 두께·색상, 태그 모양, 아이콘 크기)
- 전체 구도 및 레이아웃 밀도

## 출력 형식

- 순수 JSON 배열만 출력합니다. 코드 펜스(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- 배열의 각 원소는 아래 필드를 가집니다:
  - frameType: string
  - proposedCode: string (완전한 파일 소스코드)
  - changeSummary: string (변경 사항 한국어 요약, 3줄 이내)
  - diffHighlights: Array<{ lineRange: string; description: string }>
- proposedCode는 파일 전체를 포함해야 합니다 (부분 코드 스니펫 금지).`;

// ─────────────────────────────────────────────────────────────────────────────
// 유저 프롬프트 빌더
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 레퍼런스 이미지 분석 + 템플릿 코드 개선 요청 유저 메시지를 생성합니다.
 *
 * Claude 메시지의 content 배열 중 text 블록에 삽입되며,
 * 이미지 블록(base64)은 API Route에서 별도로 prepend됩니다.
 *
 * @param templates - { frameType, code } 배열 (배치 단위로 최대 3개)
 * @returns Claude user 메시지용 텍스트 문자열
 */
export function buildReferenceUserPrompt(
  templates: { frameType: string; code: string }[]
): string {
  // 각 템플릿 코드 섹션 직렬화
  const templateSections = templates
    .map(
      ({ frameType, code }) =>
        `### 템플릿: ${frameType}\n\`\`\`tsx\n${code}\n\`\`\``
    )
    .join('\n\n');

  return `첨부된 레퍼런스 이미지의 디자인 스타일(색상, 타이포그래피, 여백, 레이아웃 밀도)을 분석한 뒤,
아래 ${templates.length}개의 React 템플릿 코드에 해당 스타일을 반영하여 개선된 코드를 제안해주세요.

## 반드시 지켜야 할 제약
- 기능 로직, TemplateProps 인터페이스, import 구문, EditableText 사용처 변경 금지
- style={{}} 내부 값(색상, 폰트, 여백, 테두리 등)만 수정
- 최상위 컨테이너 width 780px / height 1100px 유지
- theme prop 관련 코드 유지

## 대상 템플릿 코드

${templateSections}

## 출력 형식

순수 JSON 배열만 출력하세요 (코드 펜스 없음):

[
  {
    "frameType": "프레임타입",
    "proposedCode": "완전한 파일 소스코드 전문",
    "changeSummary": "변경 사항 한국어 요약",
    "diffHighlights": [
      { "lineRange": "12-15", "description": "배경색을 레퍼런스의 딥네이비로 변경" }
    ]
  }
]`;
}
