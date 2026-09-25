// src/__tests__/lib/erp/sku/report.test.ts
import { describe, it, expect } from 'vitest';
import { renderReport } from '@/lib/erp/sku/report';
import type { Draft } from '@/lib/erp/sku/draft';

const draft: Draft = {
  skus: [
    { key: 'cp:100:', name: '다슈 왁스', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: ['pc-dasu'] },
    { key: 'cp:200:블랙', name: '콜맨 왜건', optionLabel: '블랙', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
  ],
  listings: [
    { key: 'coupang_wing|11|', channel: 'coupang_wing', externalProductId: '11', externalOptionKey: '', altProductId: '100', label: '다슈 · 1개', linkMode: 'single' },
    { key: 'coupang_wing|12|', channel: 'coupang_wing', externalProductId: '12', externalOptionKey: '', altProductId: '100', label: '다슈 · 2개', linkMode: 'single' },
    { key: 'naver|900|5001', channel: 'naver', externalProductId: '900', externalOptionKey: '5001', altProductId: null, label: '왜건 · 블랙', linkMode: 'single' },
  ],
  links: [
    { listingKey: 'coupang_wing|11|', skuKey: 'cp:100:', multiplier: 1 },
    { listingKey: 'coupang_wing|12|', skuKey: 'cp:100:', multiplier: 2 },
    { listingKey: 'naver|900|5001', skuKey: 'cp:200:블랙', multiplier: 1 },
  ],
  issues: [
    { kind: 'legacy_multiplier_mismatch', ref: 'coupang_wing|12|', detail: '레거시 배수 3 / 초안 배수 2' },
    { kind: 'multi_vid_listing', ref: 'naver|901|', detail: '쿠팡 옵션 2개' },
  ],
};

describe('renderReport', () => {
  const md = renderReport(draft, { date: '2026-09-26', notes: ['네이버 판매 가져오기가 흰티만 잡는다'] });

  it('제목과 요약 수치를 싣는다', () => {
    expect(md).toContain('# SKU 마스터 점검 보고서 2026-09-26');
    expect(md).toMatch(/SKU \| 2/);
    expect(md).toMatch(/리스팅 \| 3/);
  });

  it('판단이 필요한 이슈를 정보성 이슈보다 먼저 싣고 종류별로 묶는다', () => {
    expect(md.indexOf('레거시 배수와 다름')).toBeLessThan(md.indexOf('같은 SKU의 수량 옵션 여러 개가 붙은 채널 리스팅'));
    expect(md).toContain('| coupang_wing\\|12\\| | 레거시 배수 3 / 초안 배수 2 |');
  });

  it('SKU마다 연결된 리스팅과 배수를 보여준다', () => {
    expect(md).toContain('`cp:100:`');
    expect(md).toMatch(/coupang_wing 11 ×1[\s\S]*coupang_wing 12 ×2/);
  });

  it('운영 메모를 싣는다', () => {
    expect(md).toContain('네이버 판매 가져오기가 흰티만 잡는다');
  });
});

describe('renderReport — linkMode 표시', () => {
  it('single이 아닌 리스팅은 SKU 표의 배수 뒤에 linkMode를 덧붙인다', () => {
    const draftWithAnyOf: Draft = {
      skus: [
        { key: 'cp:100:', name: '다슈 왁스', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
      ],
      listings: [
        { key: 'naver|950|x', channel: 'naver', externalProductId: '950', externalOptionKey: 'x', altProductId: null, label: '다슈 · any_of', linkMode: 'any_of' },
      ],
      links: [{ listingKey: 'naver|950|x', skuKey: 'cp:100:', multiplier: 1 }],
      issues: [],
    };
    const md = renderReport(draftWithAnyOf, { date: '2026-09-26', notes: [] });
    expect(md).toContain('naver 950/x ×1 [any_of]');
  });

  it('linkMode가 single이면 덧붙이지 않는다', () => {
    const md = renderReport(draft, { date: '2026-09-26', notes: [] });
    expect(md).not.toContain('[single]');
    expect(md).toMatch(/coupang_wing 11 ×1(?!\s*\[)/);
  });
});
