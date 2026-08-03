import { describe, it, expect } from 'vitest';
import { infoShotsFor, serializeInfoShotChecklist } from './info-shots';

const subjects = (c: string, n: string, b = false) => infoShotsFor(c, n, b).map((s) => s.subject);

describe('infoShotsFor', () => {
  it('의류면 케어라벨과 실측을 필수로 안내한다', () => {
    const shots = infoShotsFor('의류', '남성 반바지');
    const care = shots.find((s) => s.subject.includes('케어라벨'));
    const measure = shots.find((s) => s.subject.includes('실측'));

    expect(care?.required).toBe(true);
    expect(measure?.required).toBe(true);
    // 2026-08-02 반바지에서 실제로 이 라벨이 소재·제조국·수입자를 전부 줬다
    expect(care?.yields).toEqual(
      expect.arrayContaining(['소재 혼용률', '제조국', '수입자·제조사']),
    );
  });

  it('행택은 앞뒤를 모두 찍도록 안내한다', () => {
    // 반바지 판매 포인트 4개가 전부 행택 뒷면에 있었다
    const tag = infoShotsFor('의류', '반바지').find((s) => s.subject.includes('행택'));
    expect(tag?.subject).toContain('앞·뒤');
    expect(tag?.yields).toEqual(expect.arrayContaining(['제품 기능 아이콘']));
  });

  it('카테고리 없이 상품명만으로도 판정한다', () => {
    // PRO 업로드 화면에서는 카테고리를 비워두는 경우가 많다
    expect(subjects('', '나이키 반팔 티셔츠')).toContain('케어라벨 (품질표시 라벨)');
  });

  it('식품은 유통기한과 표시사항을 안내한다', () => {
    const s = subjects('식품', '견과류 선물세트');
    expect(s).toContain('제품 뒷면 표시사항');
    expect(s).toContain('유통기한 각인');
    expect(s).not.toContain('케어라벨 (품질표시 라벨)');
  });

  it('가전은 정격 라벨과 KC 인증을 안내한다', () => {
    const s = subjects('생활가전', '무선 청소기');
    expect(s).toContain('정격 라벨 (에너지·전기 표시)');
    expect(s).toContain('KC 인증 마크');
  });

  it('카테고리를 못 알아봐도 최소 안내는 한다', () => {
    const s = infoShotsFor('', '이름없는물건');
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.subject).toBe('제품 표시사항 라벨');
    expect(s[0]!.required).toBe(true);
  });

  it('브랜드 상품이면 정품 인증 택을 추가한다', () => {
    expect(subjects('의류', '티셔츠', false)).not.toContain('정품 인증 택 · 홀로그램');
    expect(subjects('의류', '티셔츠', true)).toContain('정품 인증 택 · 홀로그램');
  });

  it('가격표는 카테고리와 무관하게 항상 포함한다', () => {
    // 할인 종료일이 재사입 데드라인이 된다 (반바지 8/16)
    for (const [c, n] of [['의류','반바지'], ['식품','과자'], ['', '무엇']]) {
      expect(subjects(c!, n!)).toContain('가격표 · 영수증');
    }
  });

  it('여러 카테고리가 동시에 걸리면 양쪽을 모두 안내한다', () => {
    // "주방가전 식품 선물세트"처럼 카테고리 문자열에 두 영역이 섞이는 경우가 있다
    const s = subjects('주방가전 식품', '커피머신 원두 세트');
    expect(s).toContain('정격 라벨 (에너지·전기 표시)');
    expect(s).toContain('유통기한 각인');
    // 결과에 중복이 없어야 한다. 규칙이 늘어 같은 subject를 공유하게 되면
    // out.some(...) 방어가 여기서 걸린다 — 지금 규칙들은 subject가 겹치지 않아
    // 이 단언 자체는 자명하지만, 규칙 추가 시 회귀를 잡는 자리다.
    expect(new Set(s).size).toBe(s.length);
  });
});

describe('serializeInfoShotChecklist', () => {
  it('필수 항목에 표시를 붙이고 위치와 얻는 것을 함께 적는다', () => {
    const text = serializeInfoShotChecklist(infoShotsFor('의류', '반바지'));
    expect(text).toContain('⭐ 필수');
    expect(text).toContain('위치:');
    expect(text).toContain('얻는 것:');
    expect(text).toContain('촬영 팁');
  });

  it('빈 목록도 안전하다', () => {
    expect(serializeInfoShotChecklist([])).toBe('촬영할 정보 사진이 없습니다.');
  });
});
