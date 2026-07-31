import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  UNBRANDED,
  CLUTTER,
  unbrandedKeyFor,
  toneInstruction,
  buildBeforePrompt,
  buildAfterBackgroundPrompt,
} from '@/lib/detail-page/compare-image-prompts';
import { cropBox, composeComparePair, CROP_RATIO, GAP } from '@/lib/detail-page/compare-image-compose';
import { PALETTE_NAMES } from '@/lib/detail-page/palette-config';
import { isComparePairSlot, resolveGenSlot } from '@/lib/detail-page/gen-slots';

describe('unbrandedKeyFor', () => {
  it('fashion은 apparel, food는 food, 나머지는 generic', () => {
    expect(unbrandedKeyFor('fashion')).toBe('apparel');
    expect(unbrandedKeyFor('food')).toBe('food');
    expect(unbrandedKeyFor('basic')).toBe('generic');
    expect(unbrandedKeyFor('living')).toBe('generic');
    expect(unbrandedKeyFor(undefined)).toBe('generic');
  });
});

describe('toneInstruction', () => {
  it('팔레트 전체를 덮는다 — 누락 시 undefined가 프롬프트에 새어든다', () => {
    for (const p of PALETTE_NAMES) {
      const s = toneInstruction(p);
      expect(s).not.toContain('undefined');
      expect(s.length).toBeGreaterThan(40);
    }
  });
});

describe('프롬프트 조립', () => {
  // 문구 자체를 단언하지 않는다 — 다듬을 때마다 깨지는 change-detector가 된다.
  // 검증된 블록이 최종 프롬프트에 "포함되는지"만 본다.
  it('좌측에는 무브랜드·어질러짐 블록이 모두 들어간다', () => {
    const p = buildBeforePrompt({
      beforeHint: '세면대 위에 스킨케어 용기 일곱 개가 놓여 있다',
      category: 'basic',
      palette: 'warm_cream',
    });
    expect(p).toContain('세면대 위에');
    expect(p).toContain(UNBRANDED.generic);
    expect(p).toContain(CLUTTER);
  });

  it('카테고리에 맞는 무브랜드 문구를 고른다', () => {
    const p = buildBeforePrompt({ beforeHint: 'x', category: 'fashion', palette: 'warm_cream' });
    expect(p).toContain(UNBRANDED.apparel);
    expect(p).not.toContain(UNBRANDED.food);
  });

  it('우측 배경에는 어질러짐을 넣지 않고, 제품을 그리지 말라고 지시한다', () => {
    const p = buildAfterBackgroundPrompt({ afterHint: '정돈된 선반', palette: 'warm_cream' });
    expect(p).not.toContain(CLUTTER);
    expect(p).toContain('composited in afterwards');
  });
});

describe('cropBox', () => {
  it('1024 → 760을 중앙에서 잘라낸다', () => {
    expect(cropBox(1024)).toEqual({ left: 132, width: 760 });
  });

  it('어떤 폭에서도 이미지 밖으로 나가지 않는다', () => {
    for (const w of [1, 2, 3, 7, 100, 513, 1024, 2048]) {
      const b = cropBox(w);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.width).toBeGreaterThan(0);
      expect(b.left + b.width).toBeLessThanOrEqual(w);
    }
  });

  it('비율을 유지한다', () => {
    expect(cropBox(2048).width).toBe(Math.round(2048 * CROP_RATIO));
  });
});

/** 단색 사각형 PNG */
async function solid(w: number, h: number, color: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

describe('composeComparePair', () => {
  it('1024x1024 두 장 → 폭 760*2+4, 높이 1024', async () => {
    const out = await composeComparePair(
      await solid(1024, 1024, '#ff0000'),
      await solid(1024, 1024, '#0000ff'),
    );
    const m = await sharp(out).metadata();
    expect(m.width).toBe(760 * 2 + GAP);
    expect(m.height).toBe(1024);
  });

  it('좌우 순서가 뒤바뀌지 않는다 — 좌측이 기존 방식이어야 한다', async () => {
    const out = await composeComparePair(
      await solid(1024, 1024, '#ff0000'), // 좌: 빨강
      await solid(1024, 1024, '#0000ff'), // 우: 파랑
    );
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number) => {
      const i = (Math.floor(info.height / 2) * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(px(100)[0]).toBeGreaterThan(200);       // 좌측 R 큼
    expect(px(info.width - 100)[2]).toBeGreaterThan(200); // 우측 B 큼
  });

  it('높이가 다르면 작은 쪽에 맞춘다 — 늘리면 비율이 깨진다', async () => {
    const out = await composeComparePair(
      await solid(1024, 1024, '#ff0000'),
      await solid(1024, 800, '#0000ff'),
    );
    const m = await sharp(out).metadata();
    expect(m.height).toBe(800);
  });

  it('깨진 입력은 조용히 넘기지 않고 오류를 낸다', async () => {
    await expect(composeComparePair(Buffer.from('not an image'), await solid(10, 10, '#fff')))
      .rejects.toThrow();
  });
});

describe('unbrandedKeyFor — 상품명 추론', () => {
  // PRO 경로는 category를 항상 ''로 보낸다. 상품명으로도 못 가르면 의류·식품
  // 전용 문구가 죽고 전부 generic으로 떨어진다.
  it('카테고리가 비어도 상품명으로 의류를 잡는다', () => {
    expect(unbrandedKeyFor('', '남성 라운지 반바지 2매 세트')).toBe('apparel');
    expect(unbrandedKeyFor('', '여름 잠옷 상하 세트')).toBe('apparel');
  });

  it('식품도 상품명으로 잡는다', () => {
    expect(unbrandedKeyFor('', '건조 망고 간식 200g')).toBe('food');
  });

  it('해당 없으면 generic', () => {
    expect(unbrandedKeyFor('', '콜맨 캠핑 웨건')).toBe('generic');
  });

  it('명시적 카테고리가 상품명보다 우선한다', () => {
    expect(unbrandedKeyFor('food', '티셔츠 모양 젤리')).toBe('food');
  });
});

describe('isComparePairSlot', () => {
  it('compare_pair만 참', () => {
    expect(isComparePairSlot('compare_pair')).toBe(true);
    expect(isComparePairSlot('flux_lifestyle')).toBe(false);
    expect(isComparePairSlot(undefined)).toBe(false);
  });

  it('resolveGenSlot이 compare_pair를 찾는다 — 못 찾으면 결과가 놓일 자리가 없다', () => {
    expect(resolveGenSlot([{ slotType: 'compare_pair' }])).toEqual({ index: 0, slotType: 'compare_pair' });
  });
});

describe('buildAfterBackgroundPrompt — 같은 방 지시', () => {
  // 톤만 통일해서는 부족했다. 두 이미지를 독립 생성하면 색보정이 같아도 가구가
  // 갈려 다른 방으로 읽힌다(실물: 좌 무지 크림 의자 / 우 플로럴 패턴 의자).
  it('withReference가 켜지면 같은 방·같은 가구 지시가 들어간다', () => {
    const p = buildAfterBackgroundPrompt({ afterHint: '정돈된 의자', palette: 'warm_cream', withReference: true });
    expect(p).toContain('SAME room');
    expect(p).toContain('upholstery pattern');
  });

  it('꺼져 있으면 넣지 않는다 — 레퍼런스 없이 그 문구를 주면 존재하지 않는 이미지를 가리킨다', () => {
    const p = buildAfterBackgroundPrompt({ afterHint: '정돈된 의자', palette: 'warm_cream' });
    expect(p).not.toContain('SAME room');
  });
});
