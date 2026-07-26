import { describe, it, expect } from 'vitest';
import { stripCloseupClaims } from '@/lib/detail-page/image-hygiene';

describe('stripCloseupClaims — 착용 주장 (wearing 옵션)', () => {
  const blocks = [
    { type: 'heading', text: '시원한 여름', size: 'xl' },
    { type: 'subtext', text: '모델이 착용한 모습입니다. 사이즈는 95부터 110까지 있습니다.' },
  ];

  it('옵션이 없으면 착용 문구를 건드리지 않는다', () => {
    const out = stripCloseupClaims(blocks);
    expect(JSON.stringify(out.blocks)).toContain('모델이 착용한 모습입니다');
  });

  it('wearing 옵션이면 착용 주장 문장만 제거한다', () => {
    const out = stripCloseupClaims(blocks, { wearing: true });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain('모델이 착용한 모습입니다');
    // 같은 블록의 다른 문장은 보존한다
    expect(json).toContain('사이즈는 95부터 110까지');
    expect(out.removed).toBeGreaterThan(0);
  });

  it('접사 주장은 옵션과 무관하게 계속 제거한다', () => {
    const closeup = [{ type: 'subtext', text: '같은 조명에서 촬영한 접사입니다.' }];
    expect(JSON.stringify(stripCloseupClaims(closeup).blocks)).not.toContain('접사입니다');
    expect(
      JSON.stringify(stripCloseupClaims(closeup, { wearing: true }).blocks),
    ).not.toContain('접사입니다');
  });

  it('일반적인 착용 안내는 지우지 않는다', () => {
    // "착용" 자체가 아니라 "이 사진에 사람이 있다"는 주장만 대상이다
    const generic = [{ type: 'subtext', text: '착용 후 세탁기로 세탁하세요.' }];
    const out = stripCloseupClaims(generic, { wearing: true });
    expect(JSON.stringify(out.blocks)).toContain('착용 후 세탁기로');
  });

  it('제품 변형을 뜻하는 "모델"과 평범한 제품 설명은 지우지 않는다', () => {
    // 한국 이커머스에서 "모델"은 제품 변형을 뜻하는 경우가 흔하고,
    // "들고 있는"·"사용하는 모습"은 평범한 제품 설명이다.
    const ok = [
      '이 제품은 여러 모델이 있습니다.',
      '구형 모델이 아닌 최신형입니다.',
      '모델이라면 누구나 만족할 사이즈입니다.',
      '한 손으로 들고 있는 무게가 가볍습니다.',
      '들고 있는 손잡이가 편안합니다.',
      '매일 사용하는 모습을 상상해보세요.',
      '착용감이 뛰어납니다.',
      '착용 후 세탁기로 세탁하세요.',
    ];
    for (const text of ok) {
      const out = stripCloseupClaims([{ type: 'subtext', text }], { wearing: true });
      expect(JSON.stringify(out.blocks)).toContain(text.slice(0, 8));
    }
  });

  it('사람이 등장한다는 주장은 지운다', () => {
    const claims = [
      '모델이 착용한 모습입니다.',
      '실제 착용컷입니다.',
      '모델이 들고 있는 모습을 보세요.',
      '입은 모습이 이렇습니다.',
    ];
    for (const text of claims) {
      const out = stripCloseupClaims([{ type: 'subtext', text }], { wearing: true });
      expect(JSON.stringify(out.blocks)).not.toContain(text.slice(0, 6));
    }
  });
});
