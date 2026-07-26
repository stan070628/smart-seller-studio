import { describe, it, expect } from 'vitest';
import {
  sectionCap,
  hasCloseupClaim,
  stripCloseupClaims,
  findReusedImages,
  imageHygieneWarnings,
} from '@/lib/detail-page/image-hygiene';

describe('sectionCap', () => {
  it('사진이 적으면 섹션도 줄인다 — 3장으로 9섹션을 만들던 게 재탕의 원인이었다', () => {
    expect(sectionCap(3)).toBe(6);
    expect(sectionCap(4)).toBe(8);
  });

  it('사진이 많아도 10개를 넘지 않는다', () => {
    expect(sectionCap(5)).toBe(10);
    expect(sectionCap(20)).toBe(10);
  });

  it('하한 6 — 서사 아크(hook·compare·assure)가 성립하는 최소치', () => {
    expect(sectionCap(1)).toBe(6);
    expect(sectionCap(0)).toBe(6);
  });
});

describe('hasCloseupClaim', () => {
  it('접사를 주장하는 표현을 잡는다', () => {
    expect(hasCloseupClaim('같은 조명에서 촬영한 접사입니다.')).toBe(true);
    expect(hasCloseupClaim('가까이서 보면 짜임이 보입니다')).toBe(true);
    expect(hasCloseupClaim('확대하면 봉제선이 보입니다')).toBe(true);
  });

  it('일반적인 서술은 잡지 않는다 — 멀쩡한 카피를 지우면 안 된다', () => {
    expect(hasCloseupClaim('원단을 자세히 살펴보고 골랐습니다')).toBe(false);
    expect(hasCloseupClaim('꼼꼼하게 마감했습니다')).toBe(false);
    expect(hasCloseupClaim('짜임이 촘촘합니다')).toBe(false);
  });
});

describe('stripCloseupClaims', () => {
  it('subtext에서 접사 문장만 빼고 나머지 문장은 남긴다', () => {
    const r = stripCloseupClaims([
      { type: 'subtext', text: '그린 스트라이프와 네이비 프린트입니다. 같은 조명에서 촬영한 접사입니다.' },
    ]);
    const b = r.blocks[0] as { text: string };
    expect(b.text).toBe('그린 스트라이프와 네이비 프린트입니다.');
    expect(r.removed).toBe(1);
  });

  it('문장이 하나뿐이라 통째로 비면 블록을 제거한다', () => {
    const r = stripCloseupClaims([
      { type: 'subtext', text: '같은 조명에서 촬영한 접사입니다.' },
      { type: 'heading', text: '원단', size: 'lg' },
    ]);
    expect(r.blocks).toHaveLength(1);
    expect((r.blocks[0] as { type: string }).type).toBe('heading');
  });

  it('bullet_list는 해당 항목만 뺀다', () => {
    const r = stripCloseupClaims([
      { type: 'bullet_list', items: ['가까이서 보면 실 색이 나뉜 게 보임', '밑단이 접어박기로 마감됨'] },
    ]);
    expect((r.blocks[0] as { items: string[] }).items).toEqual(['밑단이 접어박기로 마감됨']);
    expect(r.removed).toBe(1);
  });

  it('heading은 지우지 않고 보고만 한다 — 지우면 섹션에 제목이 없어진다', () => {
    const r = stripCloseupClaims([{ type: 'heading', text: '가까이서 보면', size: 'lg' }]);
    expect(r.blocks).toHaveLength(1);
    expect(r.headingClaims).toEqual(['가까이서 보면']);
    expect(r.removed).toBe(0);
  });

  it('columns 안에 중첩된 블록도 처리한다', () => {
    const r = stripCloseupClaims([
      { type: 'columns', cols: [[{ type: 'subtext', text: '접사입니다.' }], [{ type: 'subtext', text: '남는 문장' }]] },
    ]);
    const cols = (r.blocks[0] as { cols: unknown[][] }).cols;
    expect(cols[0]).toHaveLength(0);
    expect(cols[1]).toHaveLength(1);
    expect(r.removed).toBe(1);
  });

  it('접사 주장이 없으면 아무것도 바꾸지 않는다', () => {
    const blocks = [{ type: 'subtext', text: '밑단이 무릎 위에서 끝납니다.' }];
    const r = stripCloseupClaims(blocks);
    expect(r.removed).toBe(0);
    expect(r.headingClaims).toEqual([]);
    expect(r.blocks).toEqual(blocks);
  });
});

describe('findReusedImages', () => {
  it('대형 1장짜리 섹션에서 같은 사진이 2번 이상 쓰이면 잡는다', () => {
    const reused = findReusedImages([
      { title: '히어로', urls: ['a.jpg'] },
      { title: '포켓', urls: ['a.jpg'] },
      { title: '소재', urls: ['b.jpg'] },
    ]);
    expect(reused).toHaveLength(1);
    expect(reused[0]!.url).toBe('a.jpg');
    expect(reused[0]!.sections).toEqual(['히어로', '포켓']);
  });

  it('옵션 카드처럼 여러 장 쓰는 섹션은 세지 않는다', () => {
    // 카드 썸네일은 옵션마다 다른 사진을 쓰는 게 정상이고, 대형 컷과 겹쳐도 거슬리지 않는다.
    const reused = findReusedImages([
      { title: '히어로', urls: ['a.jpg'] },
      { title: '색상', urls: ['a.jpg', 'b.jpg', 'c.jpg'] },
    ]);
    expect(reused).toEqual([]);
  });

  it('이미지 없는 섹션과 빈 URL은 무시한다', () => {
    expect(findReusedImages([
      { title: '텍스트', urls: [] },
      { title: '빈값', urls: [''] },
      { title: '빈값2', urls: [''] },
    ])).toEqual([]);
  });
});

describe('imageHygieneWarnings', () => {
  it('재탕·fallback·heading 잔존을 각각 한 줄로 만든다', () => {
    const w = imageHygieneWarnings({
      reused: [{ url: 'a.jpg', sections: ['히어로', '포켓'] }],
      fallbackSections: 2,
      strippedClaims: 3,
      headingClaims: ['가까이서 보면'],
    });
    expect(w).toHaveLength(3);
    expect(w[0]).toContain('히어로');
    expect(w[1]).toContain('2개 섹션');
    expect(w[1]).toContain('3곳');
    expect(w[2]).toContain('가까이서 보면');
  });

  it('제거한 표현이 없으면 fallback 문구에 그 얘기를 넣지 않는다', () => {
    const w = imageHygieneWarnings({ reused: [], fallbackSections: 1, strippedClaims: 0, headingClaims: [] });
    expect(w).toHaveLength(1);
    expect(w[0]).not.toContain('접사');
  });

  it('아무 문제 없으면 조용하다', () => {
    expect(imageHygieneWarnings({ reused: [], fallbackSections: 0, strippedClaims: 0, headingClaims: [] })).toEqual([]);
  });
});
