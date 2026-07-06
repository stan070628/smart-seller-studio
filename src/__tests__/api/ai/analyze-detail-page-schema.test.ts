import { describe, it, expect } from 'vitest';
import { AnalyzedSectionSchema } from '@/app/api/ai/analyze-detail-page/route';

describe('AnalyzedSectionSchema — option_grid', () => {
  it('사이즈/색상 등 병렬 선택 옵션을 option_grid로 인식한다', () => {
    const section = {
      blockType: 'option_grid',
      rawText: 'S 40x35cm  M 55x45cm  L 65x50cm',
      extractedData: {
        type: 'option_grid',
        items: [
          { label: 'S', sublabel: '40 x 35cm' },
          { label: 'M', sublabel: '55 x 45cm', highlight: true },
          { label: 'L', sublabel: '65 x 50cm' },
        ],
      },
      confidence: 'high',
      needsReview: false,
    };

    const result = AnalyzedSectionSchema.safeParse(section);
    expect(result.success).toBe(true);
  });
});

// Gemini 실제 출력에서 관찰된 흔들림들 — 섹션을 통째로 버리지 않고 흡수해야 한다.
describe('AnalyzedSectionSchema — LLM 출력 관대화(P1 회귀 방지)', () => {
  const base = {
    blockType: 'text',
    rawText: 'x',
    extractedData: { type: 'text', body: '본문' },
    confidence: 'high',
    needsReview: false,
  };

  it('confidence 대문자("High")를 정규화한다', () => {
    const r = AnalyzedSectionSchema.safeParse({ ...base, confidence: 'High' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confidence).toBe('high');
  });

  it('confidence가 enum 밖 값이면 medium으로 흡수한다', () => {
    const r = AnalyzedSectionSchema.safeParse({ ...base, confidence: 0.9 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confidence).toBe('medium');
  });

  it('needsReview가 문자열 "true"여도 boolean으로 변환한다', () => {
    const r = AnalyzedSectionSchema.safeParse({ ...base, needsReview: 'true' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.needsReview).toBe(true);
  });

  it('optional 필드가 null이어도(heading: null) 통과한다', () => {
    const r = AnalyzedSectionSchema.safeParse({
      ...base,
      extractedData: { type: 'text', heading: null, body: '본문' },
    });
    expect(r.success).toBe(true);
  });

  it('extractedData.type가 blockType과 다르면 blockType으로 통일한다', () => {
    const r = AnalyzedSectionSchema.safeParse({
      blockType: 'process_flow',
      rawText: '주문→배송',
      extractedData: { type: 'shipping', items: [{ label: '주문접수' }] },
      confidence: 'high',
      needsReview: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.extractedData.type).toBe('process_flow');
  });

  it('stat_row value가 숫자여도 문자열로 강제한다', () => {
    const r = AnalyzedSectionSchema.safeParse({
      blockType: 'stat_row',
      rawText: '만족도 98%',
      extractedData: { type: 'stat_row', items: [{ label: '만족도', value: 98, unit: '%' }] },
      confidence: 'high',
      needsReview: false,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.extractedData.type === 'stat_row') {
      expect(r.data.extractedData.items[0].value).toBe('98');
    }
  });

  it('Gemini가 분류 못한 unknown 섹션(description 없음)도 rawText를 보존해 통과한다', () => {
    const r = AnalyzedSectionSchema.safeParse({
      blockType: 'unknown',
      rawText: '분류하기 애매한 섹션 텍스트',
      extractedData: { type: 'unknown' },
      confidence: 'low',
      needsReview: true,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.extractedData.type === 'unknown') {
      expect(r.data.extractedData.description).toBe('분류하기 애매한 섹션 텍스트');
    }
  });

  it('progress_bar value가 "75%" 문자열이어도 숫자로 변환한다', () => {
    const r = AnalyzedSectionSchema.safeParse({
      blockType: 'progress_bar',
      rawText: '흡수력 75%',
      extractedData: { type: 'progress_bar', items: [{ label: '흡수력', value: '75%' }] },
      confidence: 'high',
      needsReview: false,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.extractedData.type === 'progress_bar') {
      expect(r.data.extractedData.items[0].value).toBe(75);
    }
  });
});
