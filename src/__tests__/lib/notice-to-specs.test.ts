import { describe, it, expect } from 'vitest';
import { noticeToSpecs, extractNaverNoticeBody, coupangNoticesToSpecs } from '@/lib/listing/notice-to-specs';

// 라비오라 실제 고시정보 (2026-08-13 조회)
const LAVIORA = {
  capacity: '150g x 1ea / 150g x 2ea',
  specification: '모든 피부용',
  expirationDateText: '개봉 전 36개월 / 개봉 후 12개월',
  usage: '세안 후 손과 얼굴에 물기가 있는 상태에서 동전 크기 정도의 적당량을 덜어 얼굴 전체에 발라줍니다.',
  manufacturer: '(주)비앤비코리아 | 인천광역시 서구 도담로 176-4',
  producer: '대한민국',
  distributor: '(주)비온코스 | 서울특별시 서초구 신반포로 45길 9-26',
  mainIngredient: '글리세린, 수크로오스, 정제수, 1,2-헥산다이올 등',
  certificationType: '해당없음',
  caution: '1. 화장품 사용 시 또는 사용 후 직사광선에 의하여...',
  returnCostReason: '0',
  qualityAssuranceStandard: '0',
};

describe('noticeToSpecs', () => {
  it('카피에 쓸 항목만 뽑는다 — 반품 정책 항목은 제외', () => {
    const specs = noticeToSpecs(LAVIORA);
    const labels = specs.map(s => s.label);
    expect(labels).toContain('용량');
    expect(labels).toContain('사용법(제조사 표기)');
    expect(labels).toContain('주요 성분');
    expect(labels.join()).not.toContain('반품');
  });

  it('"해당없음"·"0" 같은 빈 값을 버린다', () => {
    const specs = noticeToSpecs(LAVIORA);
    expect(specs.find(s => s.label === '인증·허가')).toBeUndefined();
    expect(specs.every(s => s.value !== '0')).toBe(true);
  });

  it('제조사에서 주소를 떼고 상호만 남긴다', () => {
    const specs = noticeToSpecs(LAVIORA);
    expect(specs.find(s => s.label === '제조업자')?.value).toBe('(주)비앤비코리아');
    expect(specs.find(s => s.label === '책임판매업자')?.value).toBe('(주)비온코스');
  });

  it('주의사항은 기본 제외, 옵션으로 포함', () => {
    expect(noticeToSpecs(LAVIORA).find(s => s.label.includes('주의사항'))).toBeUndefined();
    expect(noticeToSpecs(LAVIORA, { includeCaution: true }).find(s => s.label.includes('주의사항'))).toBeDefined();
  });

  it('사용법 원문을 가공하지 않는다 — 카피가 지어내는 것을 막는 근거다', () => {
    const usage = noticeToSpecs(LAVIORA).find(s => s.label === '사용법(제조사 표기)')?.value;
    expect(usage).toBe(LAVIORA.usage);
  });

  it('빈 입력에 안전하다', () => {
    expect(noticeToSpecs(null)).toEqual([]);
    expect(noticeToSpecs({})).toEqual([]);
  });
});

describe('extractNaverNoticeBody', () => {
  it('유형 키를 제외한 본문을 꺼낸다', () => {
    const body = extractNaverNoticeBody({ productInfoProvidedNoticeType: 'COSMETIC', cosmetic: LAVIORA });
    expect(body).toBe(LAVIORA);
  });
  it('본문이 없으면 null', () => {
    expect(extractNaverNoticeBody({ productInfoProvidedNoticeType: 'WEAR' })).toBeNull();
    expect(extractNaverNoticeBody(null)).toBeNull();
  });
});

describe('coupangNoticesToSpecs', () => {
  it('쿠팡 notices 배열을 라벨-값으로 바꾼다', () => {
    const specs = coupangNoticesToSpecs([
      { noticeCategoryDetailName: '용량', content: '150g' },
      { noticeCategoryDetailName: '제조국', content: '대한민국' },
      { noticeCategoryDetailName: '인증', content: '상세페이지 참조' },
    ]);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({ label: '용량', value: '150g' });
  });
});
