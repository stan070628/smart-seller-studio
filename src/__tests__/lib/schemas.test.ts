/**
 * schemas.test.ts
 * src/lib/ai/schemas.ts 의 parseCopyResponse, parseImageResponse, AiResponseParseError 단위 테스트
 *
 * Zod 스키마 규칙:
 *
 * CopyGenerationSchema:
 *   sellingPoints: tuple([min(5).max(50), ...]) × 3
 *   bubbleCopies:  tuple([min(2).max(20), ...])  × 3
 *   titles:        tuple([min(10).max(45), ...]) × 3
 *
 * ImageAnalysisSchema:
 *   material:     string min(5).max(120)
 *   shape:        string min(5).max(120)
 *   colors:       array min(1).max(8)
 *   keyComponents:array min(2).max(6)
 *   visualPrompt: string min(20).max(250).regex(/--ar\s+9:16/)
 */

import { describe, it, expect } from 'vitest';
import {
  parseCopyResponse,
  parseImageResponse,
  AiResponseParseError,
} from '@/lib/ai/schemas';

// ---------------------------------------------------------------------------
// 유효한 픽스처 데이터
// ---------------------------------------------------------------------------

const VALID_COPY_OBJECT = {
  sellingPoints: [
    '바람에도 뒤집히지 않는 역풍 대응 구조',
    '버튼 하나로 손 다침 없이 접히는 자동 개폐',
    '카라비너 고리로 가방에 바로 걸 수 있는 편의성',
  ],
  bubbleCopies: ['바람도 두렵지 않아', '양손이 자유로워요', '어디든 걸 수 있어'],
  titles: [
    '강풍 자동개폐 카라비너 우산 방수 경량 안전버튼',
    '역풍 방지 자동 우산 카라비너 걸이 자동개폐',
    '자동 개폐 우산 강풍 카라비너 휴대 경량 방수',
  ],
};

const VALID_IMAGE_OBJECT = {
  material: '이중벽 구조의 스테인리스 스틸 소재로 무광 마감 처리되어 있습니다',
  shape: '원통형 텀블러 형태로 뚜껑이 일체형이며 하단이 넓어 안정적입니다',
  colors: ['무광 블랙', '실버'],
  keyComponents: ['이중벽 진공 단열 구조', '실리콘 그립 밴드', '원터치 잠금 뚜껑'],
  visualPrompt:
    'A cinematic slow-motion shot of a matte black stainless steel tumbler --ar 9:16',
};

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

const toJson = (obj: unknown) => JSON.stringify(obj);

// ---------------------------------------------------------------------------
// parseCopyResponse 테스트 (7개)
// ---------------------------------------------------------------------------

describe('parseCopyResponse', () => {
  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('유효한 JSON 문자열 → CopyGenerationSchemaType 반환', () => {
    const result = parseCopyResponse(toJson(VALID_COPY_OBJECT));

    expect(result).toEqual(VALID_COPY_OBJECT);
    expect(result.sellingPoints).toHaveLength(3);
    expect(result.bubbleCopies).toHaveLength(3);
    expect(result.titles).toHaveLength(3);
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('```json 코드블록으로 감싼 JSON도 정상 파싱', () => {
    const codeBlock = `\`\`\`json\n${toJson(VALID_COPY_OBJECT)}\n\`\`\``;
    const result = parseCopyResponse(codeBlock);

    expect(result.titles[0]).toBe(VALID_COPY_OBJECT.titles[0]);
    expect(result.bubbleCopies[1]).toBe(VALID_COPY_OBJECT.bubbleCopies[1]);
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('sellingPoints 2개(미달, 튜플 길이 불일치) → AiResponseParseError throw', () => {
    const invalid = {
      ...VALID_COPY_OBJECT,
      sellingPoints: ['소구점 첫 번째 항목입니다', '소구점 두 번째 항목입니다'],
    };

    expect(() => parseCopyResponse(toJson(invalid))).toThrow(AiResponseParseError);
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('bubbleCopies 원소가 max(20자) 초과 → AiResponseParseError throw', () => {
    const invalid = {
      ...VALID_COPY_OBJECT,
      // 21자 이상 문자열 (max=20)
      bubbleCopies: [
        '이 카피는 최대 글자수를 초과합니다', // 18자 → 실제 20자 초과를 위해 더 길게
        '양손이 자유로워요',
        '어디든 걸 수 있어',
      ],
    };
    // 첫 번째 원소를 확실히 21자 이상으로
    invalid.bubbleCopies[0] = '이이이이이이이이이이이이이이이이이이이이이'; // 21자

    expect(() => parseCopyResponse(toJson(invalid))).toThrow(AiResponseParseError);
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('titles 원소가 min(10자) 미달 → AiResponseParseError throw', () => {
    const invalid = {
      ...VALID_COPY_OBJECT,
      // 9자 이하 문자열 (min=10)
      titles: [
        '짧은제목', // 5자
        '역풍 방지 자동 우산 카라비너 걸이 자동개폐',
        '자동 개폐 우산 강풍 카라비너 휴대 경량 방수',
      ],
    };

    expect(() => parseCopyResponse(toJson(invalid))).toThrow(AiResponseParseError);
  });

  // ── 테스트 6 ──────────────────────────────────────────────────────────────
  it('plain text (JSON 아님) → AiResponseParseError throw', () => {
    expect(() => parseCopyResponse('죄송합니다, 처리할 수 없습니다.')).toThrow(
      AiResponseParseError,
    );
  });

  // ── 테스트 7 ──────────────────────────────────────────────────────────────
  it('빈 문자열 → AiResponseParseError throw', () => {
    expect(() => parseCopyResponse('')).toThrow(AiResponseParseError);
  });
});

// ---------------------------------------------------------------------------
// parseImageResponse 테스트 (5개)
// ---------------------------------------------------------------------------

describe('parseImageResponse', () => {
  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('유효한 JSON → ImageAnalysisSchemaType 반환 (visualPrompt에 --ar 9:16 포함)', () => {
    const result = parseImageResponse(toJson(VALID_IMAGE_OBJECT));

    expect(result).toEqual(VALID_IMAGE_OBJECT);
    expect(result.visualPrompt).toMatch(/--ar\s+9:16/);
    expect(Array.isArray(result.colors)).toBe(true);
    expect(result.colors.length).toBeGreaterThanOrEqual(1);
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('--ar 9:16 없는 visualPrompt → AiResponseParseError throw', () => {
    const invalid = {
      ...VALID_IMAGE_OBJECT,
      // --ar 9:16 regex 미충족
      visualPrompt: 'A cinematic shot of a matte black stainless steel tumbler in studio',
    };

    expect(() => parseImageResponse(toJson(invalid))).toThrow(AiResponseParseError);
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('colors 빈 배열 → AiResponseParseError throw', () => {
    const invalid = {
      ...VALID_IMAGE_OBJECT,
      colors: [], // min(1) 위반
    };

    expect(() => parseImageResponse(toJson(invalid))).toThrow(AiResponseParseError);
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('material 5자 미만 → AiResponseParseError throw', () => {
    const invalid = {
      ...VALID_IMAGE_OBJECT,
      material: '금속', // 2자, min(5) 위반
    };

    expect(() => parseImageResponse(toJson(invalid))).toThrow(AiResponseParseError);
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('JSON 파싱 불가 문자열 → AiResponseParseError throw', () => {
    expect(() => parseImageResponse('이건 JSON이 아닙니다 { invalid')).toThrow(
      AiResponseParseError,
    );
  });
});

// ---------------------------------------------------------------------------
// AiResponseParseError 테스트 (2개)
// ---------------------------------------------------------------------------

describe('AiResponseParseError', () => {
  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('인스턴스가 Error를 상속하는지 확인', () => {
    const err = new AiResponseParseError('테스트 에러', '원본 텍스트');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AiResponseParseError);
    expect(err.name).toBe('AiResponseParseError');
    expect(err.message).toBe('테스트 에러');
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('rawText, zodIssues 필드가 정상 설정되는지 확인', () => {
    const rawText = '원본 텍스트 내용';
    const zodIssues = [
      { code: 'too_small' as const, path: ['sellingPoints'], message: '소구점이 너무 짧습니다', minimum: 5, type: 'string' as const, inclusive: true },
    ];

    const err = new AiResponseParseError('스키마 검증 실패', rawText, zodIssues);

    expect(err.rawText).toBe(rawText);
    expect(err.zodIssues).toEqual(zodIssues);
    expect(err.zodIssues).toHaveLength(1);
    expect(err.zodIssues![0].message).toBe('소구점이 너무 짧습니다');

    // rawText가 500자로 잘리는지 확인
    const longText = 'A'.repeat(600);
    const errWithLongText = new AiResponseParseError('긴 텍스트 에러', longText);
    expect(errWithLongText.rawText).toHaveLength(500);

    // zodIssues가 없는 경우
    const errNoIssues = new AiResponseParseError('이슈 없음', '텍스트');
    expect(errNoIssues.zodIssues).toBeUndefined();
  });
});
