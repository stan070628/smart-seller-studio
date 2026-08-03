import { describe, it, expect } from 'vitest';
import {
  parseLabelReading,
  toKeyPointCandidates,
  toNoticeDraft,
  countRead,
} from './label-reading';

/** 2026-08-02 잉글리쉬런더리 반바지 라벨에서 실제로 읽힌 값 */
const SHORTS = JSON.stringify({
  material: { raw: '겉감 - 폴리에스터 96%, 폴리우레탄 4%', value: '겉감 폴리에스터 96%, 폴리우레탄 4%', imageIndex: 0 },
  origin: { raw: 'MADE IN BANGLADESH', value: '방글라데시', imageIndex: 0 },
  importer: { raw: '(주)코스트코 코리아', value: '(주)코스트코 코리아', imageIndex: 0 },
  brand: { raw: 'ENGLISH LAUNDRY', value: 'ENGLISH LAUNDRY', imageIndex: 1 },
  officialName: { raw: 'VENT AIR SHORT', value: '벤트 에어 쇼트', imageIndex: 1 },
  careInstructions: { raw: '30℃ 이하 세탁', value: '30℃ 이하 세탁 · 표백 금지', imageIndex: 0 },
  features: [
    { raw: 'STRETCH FABRIC', value: '신축 원단', imageIndex: 2 },
    { raw: 'QUICK DRY', value: '빠른 건조', imageIndex: 2 },
    { raw: 'SECURITY POCKET', value: '지퍼 시큐리티 포켓', imageIndex: 2 },
  ],
  certifications: [],
});

describe('parseLabelReading', () => {
  it('실제 반바지 라벨 응답을 그대로 파싱한다', () => {
    const r = parseLabelReading(SHORTS);
    expect(r.material?.value).toBe('겉감 폴리에스터 96%, 폴리우레탄 4%');
    expect(r.origin?.value).toBe('방글라데시');
    expect(r.importer?.value).toBe('(주)코스트코 코리아');
    expect(r.features).toHaveLength(3);
    // 원문을 보존해야 셀러가 사진과 대조할 수 있다
    expect(r.origin?.raw).toBe('MADE IN BANGLADESH');
    expect(r.features[0]!.imageIndex).toBe(2);
  });

  it('코드펜스나 앞뒤 설명이 섞여도 JSON만 뽑는다', () => {
    const r = parseLabelReading('```json\n' + SHORTS + '\n```\n읽었습니다.');
    expect(r.material?.value).toContain('폴리에스터 96%');
  });

  it('파싱 실패에도 던지지 않고 빈 결과를 준다', () => {
    // 라벨 판독은 보조 기능이다. 실패로 등록 흐름 전체가 막히면 안 된다
    for (const bad of ['', '읽을 수 없습니다', '{ 깨진 json', 'null']) {
      const r = parseLabelReading(bad);
      expect(countRead(r)).toBe(0);
      expect(r.features).toEqual([]);
    }
  });

  it('빈 문자열 필드는 없는 것으로 본다', () => {
    const r = parseLabelReading(JSON.stringify({
      material: { raw: '', value: '', imageIndex: 0 },
      origin: { raw: '  ', value: '', imageIndex: 0 },
    }));
    expect(r.material).toBeUndefined();
    expect(r.origin).toBeUndefined();
  });

  it('value가 없으면 raw를 값으로 쓴다', () => {
    // 한국어 라벨은 번역이 불필요해 모델이 value를 비우는 경우가 있다
    const r = parseLabelReading(JSON.stringify({
      importer: { raw: '(주)코스트코 코리아', imageIndex: 0 },
    }));
    expect(r.importer?.value).toBe('(주)코스트코 코리아');
  });

  it('imageIndex가 없거나 이상하면 0으로 둔다', () => {
    const r = parseLabelReading(JSON.stringify({
      brand: { raw: 'NIKE', value: 'NIKE' },
      origin: { raw: 'A', value: 'A', imageIndex: -3 },
    }));
    expect(r.brand?.imageIndex).toBe(0);
    expect(r.origin?.imageIndex).toBe(0);
  });
});

describe('toKeyPointCandidates', () => {
  it('브랜드+제품명, 기능, 소재를 판매 포인트로 만든다', () => {
    const pts = toKeyPointCandidates(parseLabelReading(SHORTS));
    expect(pts[0]).toBe('ENGLISH LAUNDRY 벤트 에어 쇼트');
    // 행택 뒷면의 기능 아이콘이 그대로 판매 포인트가 된다
    expect(pts).toEqual(expect.arrayContaining(['신축 원단', '빠른 건조', '지퍼 시큐리티 포켓']));
    expect(pts).toContain('겉감 폴리에스터 96%, 폴리우레탄 4%');
  });

  it('중복을 접는다', () => {
    const r = parseLabelReading(JSON.stringify({
      brand: { raw: 'NIKE', value: 'NIKE', imageIndex: 0 },
      features: [
        { raw: 'DRI-FIT', value: '드라이핏', imageIndex: 0 },
        { raw: 'DRI-FIT', value: '드라이핏', imageIndex: 1 },
      ],
    }));
    const pts = toKeyPointCandidates(r);
    expect(pts.filter((p) => p === '드라이핏')).toHaveLength(1);
  });

  it('읽은 게 없으면 빈 배열', () => {
    expect(toKeyPointCandidates(parseLabelReading('{}'))).toEqual([]);
  });

  it('인증·라이선스 문구는 판매 포인트에 넣지 않는다', () => {
    // 실측: 종이 태그의 FSC 재생지 인증과 "상표는 EL Acquisition LLC 소유"가
    // 딸려 들어왔다. 둘 다 제품 특징이 아니라 태그 자체에 대한 표시다.
    const r = parseLabelReading(JSON.stringify({
      officialName: { raw: 'VENT AIR SHORT', value: '벤트 에어 쇼트', imageIndex: 0 },
      certifications: [
        { raw: 'FSC C176065', value: 'FSC 인증 재생지', imageIndex: 1 },
        { raw: 'trademarks owned by EL Acquisition LLC', value: '상표는 EL Acquisition LLC 소유', imageIndex: 1 },
      ],
    }));
    const pts = toKeyPointCandidates(r);
    expect(pts).toEqual(['벤트 에어 쇼트']);
    // 버리지는 않는다 — 정품 근거로 쓸 수 있어야 한다
    expect(r.certifications).toHaveLength(2);
  });
});

describe('toNoticeDraft', () => {
  it('고시정보 칸을 라벨 값으로 채운다', () => {
    const n = toNoticeDraft(parseLabelReading(SHORTS));
    expect(n.material).toBe('겉감 폴리에스터 96%, 폴리우레탄 4%');
    expect(n.origin).toBe('방글라데시');
    expect(n.manufacturer).toBe('ENGLISH LAUNDRY / 수입자 (주)코스트코 코리아');
  });

  it('없는 값은 빈 문자열로 둔다 — 자리표시 문구를 넣지 않는다', () => {
    // "제조사 문의" 같은 문구를 넣으면 셀러가 그대로 저장해 잘못된 고시가 등록된다
    const n = toNoticeDraft(parseLabelReading('{}'));
    expect(n.material).toBe('');
    expect(n.origin).toBe('');
    expect(n.manufacturer).toBe('');
  });

  it('수입자만 있으면 브랜드 없이 구성한다', () => {
    const n = toNoticeDraft(parseLabelReading(JSON.stringify({
      importer: { raw: '(주)코스트코 코리아', value: '(주)코스트코 코리아', imageIndex: 0 },
    })));
    expect(n.manufacturer).toBe('수입자 (주)코스트코 코리아');
  });
});

describe('countRead', () => {
  it('읽어낸 항목 수를 센다', () => {
    // 단일 6개(material·origin·importer·brand·officialName·care) + features 3
    expect(countRead(parseLabelReading(SHORTS))).toBe(9);
    expect(countRead(parseLabelReading('{}'))).toBe(0);
  });
});

describe('항목명 제거 — 실측에서 나온 결함', () => {
  it('값 앞에 붙은 라벨 항목명을 떼어낸다', () => {
    // 2026-08-03 실제 판독 결과에서 나온 형태들
    const r = parseLabelReading(JSON.stringify({
      origin: { raw: '제조국명: 방글라데시', value: '제조국 방글라데시', imageIndex: 0 },
      importer: { raw: '수입자명', value: '수입자 (주)코스트코 코리아', imageIndex: 0 },
      itemCode: { raw: '#1956428', value: '품번 1956428', imageIndex: 0 },
    }));
    expect(r.origin?.value).toBe('방글라데시');
    expect(r.importer?.value).toBe('(주)코스트코 코리아');
    expect(r.itemCode?.value).toBe('1956428');
  });

  it('raw는 건드리지 않는다 — 라벨에 그렇게 적혀 있는 것이 사실이다', () => {
    const r = parseLabelReading(JSON.stringify({
      origin: { raw: '제조국명: 방글라데시', value: '제조국 방글라데시', imageIndex: 0 },
    }));
    expect(r.origin?.raw).toBe('제조국명: 방글라데시');
  });

  it('항목명만 있고 값이 없으면 원문을 남긴다', () => {
    const r = parseLabelReading(JSON.stringify({
      origin: { raw: '제조국', value: '제조국', imageIndex: 0 },
    }));
    // 빈 문자열로 만들어 버리면 "읽었는데 사라진" 상태가 된다
    expect(r.origin?.value).toBe('제조국');
  });

  it('"수입자명"처럼 접미가 붙어도 항목명만 정확히 떼어낸다', () => {
    // "수입자"만 떼면 "명 (주)…"이 남는다 — 선택적 '명'을 함께 흡수해야 한다
    const n = toNoticeDraft(parseLabelReading(JSON.stringify({
      brand: { raw: 'ENGLISH LAUNDRY', value: '잉글리쉬 런더리', imageIndex: 1 },
      importer: { raw: '수입자명', value: '수입자명 (주)코스트코 코리아', imageIndex: 0 },
    })));
    expect(n.manufacturer).toBe('잉글리쉬 런더리 / 수입자 (주)코스트코 코리아');
    expect(n.manufacturer).not.toContain('수입자 수입자');
    expect(n.manufacturer).not.toContain('명 (주)');
  });

  it('항목명이 값의 일부인 단어는 건드리지 않는다', () => {
    // "소재지"는 "소재"로 시작하지만 뒤에 구분자가 없어 항목명이 아니다
    const r = parseLabelReading(JSON.stringify({
      origin: { raw: '소재지 불명', value: '소재지 불명', imageIndex: 0 },
    }));
    expect(r.origin?.value).toBe('소재지 불명');
  });
});
