// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  buildTranslateOverlayUserPrompt,
  parseTranslateOverlayResponse,
} from '@/lib/ai/prompts/translate-overlay';

describe('buildTranslateOverlayUserPrompt', () => {
  it('인덱스가 부여된 중국어 텍스트 목록을 포함한다', () => {
    const prompt = buildTranslateOverlayUserPrompt(['产品', '尺寸表']);
    expect(prompt).toContain('0: 产品');
    expect(prompt).toContain('1: 尺寸表');
  });
});

describe('parseTranslateOverlayResponse', () => {
  it('JSON 응답을 인덱스 순서대로 파싱한다', () => {
    const raw = '{"translations":[{"index":0,"ko":"제품"},{"index":1,"ko":"사이즈표"}]}';
    expect(parseTranslateOverlayResponse(raw, 2)).toEqual(['제품', '사이즈표']);
  });

  it('코드펜스로 감싼 응답도 파싱한다', () => {
    const raw = '```json\n{"translations":[{"index":0,"ko":"제품"}]}\n```';
    expect(parseTranslateOverlayResponse(raw, 1)).toEqual(['제품']);
  });

  it('응답 길이가 입력과 다르면 에러를 던진다', () => {
    const raw = '{"translations":[{"index":0,"ko":"제품"}]}';
    expect(() => parseTranslateOverlayResponse(raw, 2)).toThrow(/길이/);
  });

  it('인덱스가 뒤섞여도 위치에 맞게 정렬한다', () => {
    const raw = '{"translations":[{"index":1,"ko":"사이즈표"},{"index":0,"ko":"제품"}]}';
    expect(parseTranslateOverlayResponse(raw, 2)).toEqual(['제품', '사이즈표']);
  });
});
