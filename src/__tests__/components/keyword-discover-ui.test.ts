import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/KeywordTrackerTab.tsx'),
  'utf-8',
);

describe('KeywordTrackerTab — 키워드 발굴 UI', () => {
  it('"키워드 발굴" 버튼 텍스트가 있다', () => {
    expect(src).toContain('키워드 발굴');
  });

  it('/api/ai/keyword-discover 엔드포인트를 호출한다', () => {
    expect(src).toContain('keyword-discover');
  });

  it('DiscoveredKeyword 타입이 있다', () => {
    expect(src).toMatch(/DiscoveredKeyword|discoverResults/);
  });

  it('isDiscovering 로딩 상태가 있다', () => {
    expect(src).toContain('isDiscovering');
  });
});
