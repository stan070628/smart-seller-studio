import { describe, it, expect } from 'vitest';
import { missingRequiredSpecs, requiredSpecWarnings } from '@/lib/detail-page/required-specs';

describe('missingRequiredSpecs', () => {
  it('의류인데 실측·혼용률이 없으면 둘 다 잡는다', () => {
    const missing = missingRequiredSpecs('의류', '남성 라운지 반바지 2매', ['밴딩 허리', '사이드 포켓']);
    expect(missing).toHaveLength(2);
    expect(missing.join()).toContain('사이즈 실측');
    expect(missing.join()).toContain('혼용률');
  });

  it('실측과 혼용률이 입력돼 있으면 아무것도 요구하지 않는다', () => {
    const missing = missingRequiredSpecs('의류', '반바지', ['허리단면 36cm', '총장 42cm', '면 100%']);
    expect(missing).toEqual([]);
  });

  it('일부만 입력되면 나머지만 잡는다', () => {
    const missing = missingRequiredSpecs('의류', '반바지', ['허리단면 36cm', '총장 42cm']);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('혼용률');
  });

  // 부분문자열 매칭이던 시절의 오탐들. 값이 없는데 있다고 판정하면 경고가 영영 안 뜬다.
  it('"허리단면"의 면을 소재 혼용률로 오인하지 않는다', () => {
    const missing = missingRequiredSpecs('의류', '반바지', ['허리단면 36cm', '어깨단면 42cm']);
    expect(missing.join()).toContain('혼용률');
  });

  it('"통기성 92%"를 혼용률로 오인하지 않는다', () => {
    expect(missingRequiredSpecs('의류', '반바지', ['통기성 92%']).join()).toContain('혼용률');
  });

  it('섬유명만 있고 비율이 없으면 혼용률로 보지 않는다', () => {
    expect(missingRequiredSpecs('의류', '반바지', ['면 소재라 시원합니다']).join()).toContain('혼용률');
    expect(missingRequiredSpecs('의류', '반바지', ['면 100%']).join()).not.toContain('혼용률');
    expect(missingRequiredSpecs('의류', '반바지', ['폴리에스터 65% 면 35%']).join()).not.toContain('혼용률');
  });

  it('치수 이름만 있고 숫자가 없으면 실측으로 보지 않는다', () => {
    expect(missingRequiredSpecs('의류', '반바지', ['소매가 없어 시원함']).join()).toContain('사이즈 실측');
    expect(missingRequiredSpecs('의류', '반바지', ['소매길이 22cm']).join()).not.toContain('사이즈 실측');
  });

  it('카테고리가 비어도 상품명으로 판정한다', () => {
    expect(missingRequiredSpecs('', '여름 잠옷 세트', []).length).toBeGreaterThan(0);
  });

  it('규칙에 없는 카테고리는 아무것도 요구하지 않는다', () => {
    expect(missingRequiredSpecs('문구', '볼펜 10자루', [])).toEqual([]);
  });

  it('식품은 원산지·보관 계열을 요구한다', () => {
    expect(missingRequiredSpecs('식품', '건조 망고', [])).toHaveLength(1);
    expect(missingRequiredSpecs('식품', '건조 망고', ['원산지 필리핀', '실온 보관'])).toEqual([]);
  });
});

describe('requiredSpecWarnings', () => {
  it('빠진 항목을 한 줄로 묶어 입력을 안내한다', () => {
    const w = requiredSpecWarnings('의류', '반바지', []);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('사이즈 실측');
    expect(w[0]).toContain('입력하면');
  });

  it('다 채워져 있으면 조용하다', () => {
    expect(requiredSpecWarnings('의류', '반바지', ['허리단면 36cm', '면 100%'])).toEqual([]);
  });

  it('해당 없는 카테고리는 조용하다', () => {
    expect(requiredSpecWarnings('문구', '볼펜', [])).toEqual([]);
  });

  // 생성 결과(spec_table 유무)는 판정에 넣지 않는다 — C8이 허용하는 option_grid
  // sublabel 배치로 잘 처리한 경우까지 매번 경고가 뜨면 셀러가 경고를 무시하게 된다.
  it('입력만 보고 판정한다 — 결과 sections를 받지 않는다', () => {
    expect(requiredSpecWarnings.length).toBe(3);
  });
});
