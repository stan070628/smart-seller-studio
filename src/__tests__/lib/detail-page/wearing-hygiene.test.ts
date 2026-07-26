import { describe, it, expect } from 'vitest';
import { hasWearingClaim, stripCloseupClaims } from '@/lib/detail-page/image-hygiene';

describe('hasWearingClaim', () => {
  // 정규식 작업이 있었어야 할 자리 — 이 표가 있었다면 두 차례의 오탐/누락 회귀가
  // 배포 전에 잡혔을 것이다. 단일 글자 어간("모델이\s*(착용|입|들|사용|신)")은
  // "신형 모델이 들어왔습니다"·"모델이 사용 가능한"류 평범한 카피를 잡았고(회귀 1),
  // "착용한 모습"처럼 "한"을 강제하면 "착용 모습"(이미 이 저장소의
  // public/nepa_sunvisor.html alt 텍스트에 있다)을 놓쳤다(회귀 2).
  const shouldMatch = [
    // 사람+동작 공존
    '모델이 착용한 모습입니다',
    '실제 착용컷입니다',
    '입고 있는 모습',
    '모델이 들고 있는 모습을 보세요.',
    '입은 모습이 이렇습니다.',
    '착용 모습', // "한" 없이도 사진 지칭으로 잡혀야 한다
    '여성 모델 착용',
    '연출된 착용 이미지',
  ];

  const shouldNotMatch = [
    // "모델" = 제품 변형 (단일 글자 어간이 잡던 오탐)
    '신형 모델이 들어왔습니다.',
    '이 모델이 입고 예정입니다.', // 입고 = 입하
    '이번 모델이 들어간 세트 구성입니다.',
    '이 모델이 사용 가능한 어댑터입니다.',
    '이 제품은 여러 모델이 있습니다',
    '구형 모델이 아닌 최신형입니다',
    '모델이라면 누구나',
    // 평범한 제품 설명 ("들고 있는"·"사용하는 모습"이 단독으로는 사진 주장이 아님)
    '한 손으로 들고 있는 무게',
    '들고 있는 손잡이',
    '매일 사용하는 모습을 상상해보세요',
    // "착용" 단독은 사진 주장이 아니다
    '착용감이 뛰어납니다.',
    '착용 후 세탁기로 세탁하세요.',
    // 정밀도 경계 — 쫓지 않는다(판매자/모델 모호, 사이즈표, 스타일링을 뜻함)
    '실제 사람이 입어본 결과',
    '170cm 모델 기준',
    '코디 예시',
  ];

  it.each(shouldMatch)('사람이 등장한다는 주장으로 잡는다: %s', (text) => {
    expect(hasWearingClaim(text)).toBe(true);
  });

  it.each(shouldNotMatch)('제품 설명이라 잡지 않는다: %s', (text) => {
    expect(hasWearingClaim(text)).toBe(false);
  });
});

describe('stripCloseupClaims — 착용 주장 (wearing 옵션)', () => {
  const blocks = [
    { type: 'heading', text: '시원한 여름', size: 'xl' },
    { type: 'subtext', text: '모델이 착용한 모습입니다. 사이즈는 95부터 110까지 있습니다.' },
  ];

  it('옵션이 없으면 착용 문구를 건드리지 않는다', () => {
    const out = stripCloseupClaims(blocks);
    expect(out.blocks).toEqual(blocks);
    expect(out.removed).toBe(0);
  });

  it('wearing 옵션이면 착용 주장 문장만 제거한다', () => {
    const out = stripCloseupClaims(blocks, { wearing: true });
    // 부분 문자열이 아니라 정확한 전체 텍스트로 확인한다 — "앞 몇 글자만 잘라내기"
    // 류 뮤테이션은 toContain으로는 잡히지 않는다.
    expect(out.blocks).toEqual([
      { type: 'heading', text: '시원한 여름', size: 'xl' },
      { type: 'subtext', text: '사이즈는 95부터 110까지 있습니다.' },
    ]);
    expect(out.removed).toBe(1);
  });

  it('접사 주장은 옵션과 무관하게 계속 제거한다', () => {
    const closeup = [{ type: 'subtext', text: '같은 조명에서 촬영한 접사입니다.' }];
    expect(stripCloseupClaims(closeup).blocks).toHaveLength(0);
    expect(stripCloseupClaims(closeup, { wearing: true }).blocks).toHaveLength(0);
  });

  it('일반적인 착용 안내는 지우지 않는다', () => {
    // "착용" 자체가 아니라 "이 사진에 사람이 있다"는 주장만 대상이다
    const generic = [{ type: 'subtext', text: '착용 후 세탁기로 세탁하세요.' }];
    const out = stripCloseupClaims(generic, { wearing: true });
    expect(out.blocks).toEqual(generic);
    expect(out.removed).toBe(0);
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
      const block = { type: 'subtext', text };
      const out = stripCloseupClaims([block], { wearing: true });
      // 정확한 원본 블록과 동일해야 한다 — 일부라도 잘려나가면 실패한다.
      expect(out.blocks).toEqual([block]);
      expect(out.removed).toBe(0);
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
      // 한 문장짜리 블록은 통째로 사라져야 한다 — 앞 몇 글자만 지우고 나머지가
      // 남으면(예: "앞 3글자로 자르기" 뮤테이션) blocks가 비지 않는다.
      expect(out.blocks).toHaveLength(0);
      expect(out.removed).toBe(1);
    }
  });
});
