import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/KeywordTrackerTab.tsx'),
  'utf-8',
);

describe('KeywordTrackerTab — enriched 모달', () => {
  it('SuggestedKeyword 타입에 searchVolume 필드가 있다', () => {
    expect(src).toContain('searchVolume');
  });

  it('SuggestedKeyword 타입에 competitorCount 필드가 있다', () => {
    expect(src).toContain('competitorCount');
  });

  it('통과/탈락 배지 렌더링 로직이 있다', () => {
    expect(src).toContain('통과');
    expect(src).toContain('탈락');
  });

  it('searchVolume이 null일 때를 처리한다', () => {
    expect(src).toMatch(/searchVolume.*null|null.*searchVolume/s);
  });

  it('통과 키워드 상단 정렬 로직이 있다', () => {
    expect(src).toMatch(/sort/i);
  });

  it('"검색량 조회" 로딩 메시지가 있다', () => {
    expect(src).toContain('검색량 조회');
  });
});
