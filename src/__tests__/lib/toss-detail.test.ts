import { describe, it, expect } from 'vitest';
import { fitDetailHtmlForToss, countTopLevelDivs } from '@/lib/listing/toss-detail';

describe('countTopLevelDivs', () => {
  it('중첩된 div는 최상위로 세지 않는다', () => {
    expect(countTopLevelDivs('<div><div></div><div></div></div>')).toBe(1);
  });
  it('형제 div를 각각 센다', () => {
    expect(countTopLevelDivs('<div>a</div><div>b</div><div>c</div>')).toBe(3);
  });
});

describe('fitDetailHtmlForToss', () => {
  it('최상위가 여럿이면 단일 래퍼로 감싼다 — 토스가 N등분하는 것을 막는다', () => {
    const r = fitDetailHtmlForToss('<div>a</div><div>b</div>');
    expect(r.topLevelBefore).toBe(2);
    expect(r.wrapped).toBe(true);
    expect(countTopLevelDivs(r.html)).toBe(1);
  });

  it('최상위가 하나면 감싸지 않는다', () => {
    const r = fitDetailHtmlForToss('<div style="max-width:780px">본문</div>');
    expect(r.wrapped).toBe(false);
    expect(r.html).not.toContain('width:100%;box-sizing');
  });

  it('네이버 속성 필터링 주석을 제거한다', () => {
    const r = fitDetailHtmlForToss('<div><!-- Not Allowed Attribute Filtered ( data-x="1") -->본문</div>');
    expect(r.html).not.toContain('Not Allowed');
    expect(r.html).toContain('본문');
  });

  it('relaxMaxWidth를 켜야만 고정 폭을 100%로 바꾼다', () => {
    const src = '<div style="max-width:780px">a</div>';
    expect(fitDetailHtmlForToss(src).html).toContain('max-width:780px');

    const relaxed = fitDetailHtmlForToss(src, { relaxMaxWidth: true });
    expect(relaxed.html).toContain('max-width:100%');
    expect(relaxed.relaxedCount).toBe(1);
  });

  it('실제 사고 형태 — 최상위 4개가 1개로 통합된다', () => {
    const src = '<div style="max-width:780px">본문</div>' + '<div style="max-width:780px;line-height:0"><img src="x"/></div>'.repeat(3);
    const r = fitDetailHtmlForToss(src);
    expect(r.topLevelBefore).toBe(4);
    expect(countTopLevelDivs(r.html)).toBe(1);
  });
});
