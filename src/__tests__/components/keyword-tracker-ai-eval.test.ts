import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/KeywordTrackerTab.tsx'),
  'utf-8',
);

describe('KeywordTrackerTab — AI 평가 기반', () => {
  it('KeywordEntry에 aiPass 필드가 있다', () => {
    expect(src).toContain('aiPass: boolean | null');
  });

  it('KeywordEntry에 aiReasoning 필드가 있다', () => {
    expect(src).toContain('aiReasoning: string | null');
  });

  it('judgeKeyword 함수가 제거되었다', () => {
    expect(src).not.toContain('function judgeKeyword');
  });

  it('isSuggestedPass 함수가 제거되었다', () => {
    expect(src).not.toContain('function isSuggestedPass');
  });

  it('테이블에서 aiPass === true 분기로 ✅를 렌더링한다', () => {
    expect(src).toContain('aiPass === true');
  });

  it('테이블에서 aiPass === false 분기로 ❌를 렌더링한다', () => {
    expect(src).toContain('aiPass === false');
  });

  it('reasoning을 title 속성으로 툴팁에 표시한다', () => {
    expect(src).toMatch(/title.*aiReasoning|aiReasoning.*title/s);
  });

  it('상단 통계에 미평가 카운트가 있다', () => {
    expect(src).toContain('미평가');
    expect(src).toContain('nullCount');
  });

  it('수동 저장 시 /api/ai/keyword-evaluate를 호출한다', () => {
    expect(src).toContain('/api/ai/keyword-evaluate');
  });

  it('SuggestedKeyword에 pass 필드가 있다', () => {
    expect(src).toContain('pass: boolean | null');
  });

  it('SuggestedKeyword에 reasoning 필드가 있다', () => {
    expect(src).toMatch(/reasoning.*string.*null|string.*null.*reasoning/s);
  });

  it('모달 배지가 s.pass로 판정한다', () => {
    expect(src).toContain('s.pass');
  });

  it('handleAddSuggested가 aiPass를 저장한다', () => {
    expect(src).toContain('aiPass: s.pass');
  });

  it('통과/탈락 기준 안내 고정 텍스트가 제거되었다', () => {
    expect(src).not.toContain('월 검색량 3,000~30,000');
  });

  it('AI 평가 결과 업데이트 시 functional setEntries를 사용한다', () => {
    expect(src).toContain('setEntries((prev) =>');
  });
});
