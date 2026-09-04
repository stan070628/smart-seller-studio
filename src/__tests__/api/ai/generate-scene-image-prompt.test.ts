import { describe, it, expect } from 'vitest';
import { buildSceneUserPrompt, paletteToneHint } from '@/app/api/ai/generate-scene-image/user-prompt';
import { PALETTES } from '@/lib/detail-page/palette-config';

describe('buildSceneUserPrompt', () => {
  it('sceneHint가 있으면 Art direction 라인을 포함한다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody marble and gold');
    expect(out).toContain('Art direction');
    expect(out).toContain('moody marble and gold');
    expect(out).toContain('Section type: hero');
  });

  it('sceneHint가 없으면 Art direction 라인이 없다 (기존 동작 유지)', () => {
    const out = buildSceneUserPrompt('lifestyle', { headline: '향수' }, undefined);
    expect(out).not.toContain('Art direction');
    expect(out).toContain('Section type: lifestyle');
  });

  it('productInfo가 없어도 동작한다', () => {
    const out = buildSceneUserPrompt('detail', undefined, undefined);
    expect(out).toContain('Section type: detail');
  });

  it('공백만 있는 sceneHint는 Art direction 라인을 만들지 않는다 (하위호환)', () => {
    const withWhitespace = buildSceneUserPrompt('hero', { headline: '향수' }, '   ');
    const withUndefined = buildSceneUserPrompt('hero', { headline: '향수' }, undefined);
    expect(withWhitespace).not.toContain('Art direction');
    expect(withWhitespace).toBe(withUndefined);
  });
});

describe('buildSceneUserPrompt — 편집 모드 (editOpts.isEditMode)', () => {
  it('isEditMode=true이면 첫 번째 이미지가 편집 대상임을 프롬프트에 명시한다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '텀블러' }, undefined, {
      isEditMode: true,
      instruction: '배경을 야외로 바꿔줘',
    });
    expect(out).toContain('FIRST image');
    expect(out).toContain('existing scene');
    expect(out).toContain('배경을 야외로 바꿔줘');
  });

  it('isEditMode=true + instruction 없으면 instruction 라인이 없다', () => {
    const out = buildSceneUserPrompt('lifestyle', undefined, undefined, { isEditMode: true });
    expect(out).toContain('FIRST image');
    expect(out).not.toContain('Edit instruction');
  });

  it('isEditMode=false + instruction이면 Art direction으로 취급한다', () => {
    const out = buildSceneUserPrompt('hero', undefined, undefined, {
      isEditMode: false,
      instruction: '밝고 화사하게',
    });
    expect(out).toContain('Art direction');
    expect(out).toContain('밝고 화사하게');
    expect(out).not.toContain('FIRST image');
  });

  it('isEditMode=false이면 sceneHint와 instruction 모두 Art direction에 포함된다', () => {
    const out = buildSceneUserPrompt('hero', undefined, '골드 톤', {
      isEditMode: false,
      instruction: '밝게',
    });
    expect(out).toContain('골드 톤');
    expect(out).toContain('밝게');
  });

  it('기존 시그니처(editOpts 없음)는 하위호환 유지', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold');
    expect(out).toContain('Art direction');
    expect(out).toContain('moody gold');
    expect(out).not.toContain('FIRST image');
  });
});

describe('buildSceneUserPrompt — 상품 컨텍스트 확장', () => {
  it('소재·색상·카테고리·타깃·시즌·가격대를 프롬프트에 싣는다', () => {
    const out = buildSceneUserPrompt('lifestyle', {
      headline: '예일 후드티',
      category: '남성 후드티',
      material: '면 55% 폴리에스터 45%',
      colors: ['멜란지그레이', '네이비', '아이보리'],
      targetCustomer: '20~30대 남녀',
      season: '봄가을 간절기',
      priceTier: '5만원대 캐주얼',
    }, undefined);

    expect(out).toContain('Category: 남성 후드티');
    expect(out).toContain('Material: 면 55% 폴리에스터 45%');
    expect(out).toContain('Available colors: 멜란지그레이, 네이비, 아이보리');
    expect(out).toContain('Target customer: 20~30대 남녀');
    expect(out).toContain('Season / usage period: 봄가을 간절기');
    expect(out).toContain('Price tier: 5만원대 캐주얼');
  });

  it('sellingPoints의 description까지 싣는다 (title만 넘기던 동작 교체)', () => {
    const out = buildSceneUserPrompt('hero', {
      sellingPoints: [{ title: '캥거루 포켓', description: '손을 넣을 수 있는 앞주머니' }],
    }, undefined);

    expect(out).toContain('캥거루 포켓');
    expect(out).toContain('손을 넣을 수 있는 앞주머니');
  });

  it('description이 비면 title만 싣는다', () => {
    const out = buildSceneUserPrompt('hero', {
      sellingPoints: [{ title: '루즈핏', description: '   ' }],
    }, undefined);

    expect(out).toContain('루즈핏');
    expect(out).not.toContain('루즈핏: ');
  });

  it('avoid는 부정 지시문으로 나간다', () => {
    const out = buildSceneUserPrompt('lifestyle', {
      headline: '후드티',
      avoid: ['한겨울 눈밭', '지퍼 여밈'],
    }, undefined);

    expect(out).toContain('MUST NOT appear');
    expect(out).toContain('한겨울 눈밭');
    expect(out).toContain('지퍼 여밈');
  });

  it('확장 필드가 없으면 기존 출력과 동일하다 (하위호환)', () => {
    const legacy = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold');
    const extended = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold');

    expect(extended).toBe(legacy);
    expect(legacy).not.toContain('Category:');
    expect(legacy).not.toContain('Material:');
    expect(legacy).not.toContain('MUST NOT appear');
  });
});

describe('paletteToneHint', () => {
  it('palette가 있으면 해당 팔레트의 hex 값을 포함한 톤 힌트를 반환한다', () => {
    const hint = paletteToneHint('rose_soft');
    expect(hint).toContain(PALETTES.rose_soft.bg);
    expect(hint).toContain(PALETTES.rose_soft.accent);
    expect(hint).toContain('Color tone');
  });

  it('palette가 없으면 빈 문자열을 반환한다 (하위호환)', () => {
    expect(paletteToneHint(undefined)).toBe('');
    expect(paletteToneHint()).toBe('');
  });
});

describe('buildSceneUserPrompt — palette 톤 힌트', () => {
  it('editOpts.palette가 있으면 톤 힌트가 출력 형식 지시 앞에 들어간다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, undefined, {
      palette: 'tech_navy',
    });
    expect(out).toContain('Color tone');
    expect(out).toContain(PALETTES.tech_navy.bg);
    // 형식 지시("Return only JSON")가 마지막에 와야 LLM이 형식을 지킨다.
    expect(out.indexOf('Color tone')).toBeLessThan(out.indexOf('Return only JSON'));
    expect(out.trimEnd().endsWith('Return only JSON.')).toBe(true);
  });

  it('palette가 없으면 기존 출력과 완전히 동일하다 (하위호환)', () => {
    const withoutPalette = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold');
    const withUndefinedPalette = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold', {
      palette: undefined,
    });
    expect(withoutPalette).not.toContain('Color tone');
    expect(withUndefinedPalette).toBe(withoutPalette);
  });
});
