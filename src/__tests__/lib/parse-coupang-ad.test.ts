/**
 * 쿠팡 광고관리 표 붙여넣기 파서 테스트
 *
 * 쿠팡 광고 화면의 표를 드래그 복사하면 text/plain으로 들어오는데,
 * 상품명 셀 안에 썸네일·상품명·"ID: xxx"가 줄바꿈으로 섞여 들어온다.
 * 열 위치만 믿고 자를 수 없어 "ID:" 를 행 앵커로 삼는다.
 */
import { describe, it, expect } from 'vitest';
import { parseCoupangAdTable } from '@/lib/cost-management/parse-coupang-ad';

/** 헤더 포함 · 한 캠페인 3행 (스크린샷 열 구성 기준) */
const WITH_HEADER = [
  'ON/OFF\t상품명\t상태\t판매 방식\t키워드\t노출수\t클릭수\t클릭률\t광고 전환 판매수\t중요 결과\n광고 전환 매출\t전환율\t집행 광고비\t광고비 효율성\n광고수익률',
  'ON\t코스트코 커클랜드 다용도 극세사 타월 10장 세차 청소',
  'ID: 95373359497\t● 운영 중\t로켓그로스\t키워드 보기\t4,673 회\t47 회\t1.01 %\t3 회\t38,400원\t6.38 %\t5,016원\t765.55 %',
  'ON\t오스트레일리안 보태니컬 핸드워시',
  'ID: 95604134107\t● 중지\t로켓그로스\t키워드 보기\t793 회\t77 회\t9.71 %\t2 회\t20,160원\t2.6 %\t9,564원\t210.79 %',
  'OFF\t풍실풍실 아기 고양이 리본 파우치 필통, 1개, 핑크',
  'ID: 95661320049\t● 중지\t로켓그로스\t키워드 보기\t0 회\t0 회\t0 %\t0 회\t0원\t0 %\t0원\t0 %',
].join('\n');

/** 헤더 없이 데이터 행만 드래그한 경우 */
const WITHOUT_HEADER = [
  'ON\t밀레 하이크업 트레킹화 등산화 워킹화, 270, 블랙',
  'ID: 95841404577\t● 운영 중\t판매자배송\t키워드 보기\t521 회\t5 회\t0.96 %\t0 회\t0원\t0 %\t504원\t0 %',
].join('\n');

describe('parseCoupangAdTable', () => {
  it('헤더가 있으면 집행 광고비 열을 찾아 읽는다', () => {
    const { rows } = parseCoupangAdTable(WITH_HEADER);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ externalId: '95373359497', adSpend: 5016 });
    expect(rows[1]).toMatchObject({ externalId: '95604134107', adSpend: 9564 });
    expect(rows[2]).toMatchObject({ externalId: '95661320049', adSpend: 0 });
  });

  it('광고 전환 매출(첫 금액 열)을 광고비로 착각하지 않는다', () => {
    const { rows } = parseCoupangAdTable(WITH_HEADER);
    // 38,400원은 전환 매출이고 광고비는 5,016원이다
    expect(rows[0].adSpend).not.toBe(38400);
  });

  it('헤더 셀이 잘려 "광고 전환 매출"이 빠져도 매출을 광고비로 읽지 않는다', () => {
    // 2026-08-09 실사고: "중요 결과 / 광고 전환 매출" 두 줄 헤더 셀에서 아랫줄이
    // 복사되지 않아, 첫 금액(매출 20,160원)이 광고비로 저장됐다.
    const clippedHeader = [
      'ON/OFF\t상품명\t상태\t판매 방식\t키워드\t노출수\t클릭수\t클릭률\t광고 전환 판매수\t중요 결과\t전환율\t집행 광고비\t광고비 효율성',
      'OFF\t오스트레일리안 보태니컬 핸드워시',
      'ID: 95604134107\t● 중지\t로켓그로스\t키워드 보기\t793 회\t77 회\t9.71 %\t2 회\t20,160원\t2.6 %\t9,564원\t210.79 %',
    ].join('\n');
    const { rows } = parseCoupangAdTable(clippedHeader);
    expect(rows[0].adSpend).toBe(9564);
  });

  it('2단 헤더가 뒤집혀 복사돼도 전환 매출을 광고비로 읽지 않는다', () => {
    // 2026-08-09 실사고 2차: 쿠팡 헤더는 「중요 결과」 아래 「광고 전환 매출」,
    // 「광고비 효율성」 아래 「광고수익률」이 붙은 2단 구조다. 복사하면 아랫줄이
    // 통째로 뒤로 밀려, 텍스트상 「집행 광고비」가 「광고 전환 매출」보다 앞에 온다.
    const twoRowHeader = [
      'ON/OFF\t상품명\t상태\t판매 방식\t키워드\t노출수\t클릭수\t클릭률\t광고 전환 판매수\t중요 결과\t전환율\t집행 광고비\t광고비 효율성',
      '광고 전환 매출\t광고수익률',
      'ON\t코스트코 커클랜드 다용도 극세사 타월 10장',
      'ID: 95373359497\t● 운영 중\t로켓그로스\t키워드 보기\t4,673 회\t47 회\t1.01 %\t3 회\t38,400원\t6.38 %\t5,016원\t765.55 %',
    ].join('\n');
    const { rows } = parseCoupangAdTable(twoRowHeader);
    expect(rows[0].adSpend).toBe(5016);
    expect(rows[0].adRevenue).toBe(38400);
    // 광고비와 전환매출이 같은 값이면 열을 잘못 집었다는 신호다
    expect(rows[0].adSpend).not.toBe(rows[0].adRevenue);
  });

  it('헤더가 통째로 없어도 단위 순서로 집행 광고비를 집는다', () => {
    // 앞이 %인 금액이 집행 광고비, 앞이 회인 금액이 전환 매출이다
    const noHeader = 'ON\t타월\nID: 95373359497\t● 운영 중\t로켓그로스\t4,673 회\t47 회\t1.01 %\t3 회\t38,400원\t6.38 %\t5,016원\t765.55 %';
    const { rows, headerDetected } = parseCoupangAdTable(noHeader);
    expect(headerDetected).toBe(false);
    expect(rows[0].adSpend).toBe(5016);
  });

  it('헤더가 없어도 기본 열 순서로 읽는다', () => {
    const { rows, headerDetected } = parseCoupangAdTable(WITHOUT_HEADER);
    expect(headerDetected).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: '95841404577', adSpend: 504 });
  });

  it('상품명을 ID 앞에서 뽑아낸다', () => {
    const { rows } = parseCoupangAdTable(WITH_HEADER);
    expect(rows[0].productName).toContain('극세사 타월');
    expect(rows[0].productName).not.toMatch(/^(ON|OFF)$/);
  });

  it('노출·클릭·전환 지표를 함께 수집한다', () => {
    const { rows } = parseCoupangAdTable(WITH_HEADER);
    expect(rows[0]).toMatchObject({
      impressions: 4673,
      clicks: 47,
      adOrders: 3,
      adRevenue: 38400,
      adSpend: 5016,
    });
  });

  it('지표 열 구성이 다르면 잘못된 숫자를 넣지 않고 미수집(null)으로 둔다', () => {
    // 노출수·클릭수·클릭률이 빠지고 전환 판매수부터 시작하는 구성
    const trimmed = 'ON\t상품\nID: 95000000004\t로켓그로스\t2 회\t20,160원\t2.6 %\t9,564원';
    const { rows } = parseCoupangAdTable(trimmed);
    expect(rows[0].adSpend).toBe(9564);
    expect(rows[0].adOrders).toBe(2);
    expect(rows[0].impressions).toBeNull();
    expect(rows[0].clicks).toBeNull();
  });

  it('같은 상품을 두 번 붙여넣으면 지표도 합산한다', () => {
    const { rows } = parseCoupangAdTable([WITH_HEADER, WITH_HEADER].join('\n'));
    expect(rows[0]).toMatchObject({ impressions: 9346, clicks: 94, adSpend: 10032 });
  });

  it('판매 방식 열에서 채널 종류를 읽는다', () => {
    const { rows } = parseCoupangAdTable(WITH_HEADER);
    expect(rows[0].channelType).toBe('coupang_rg');
    const wing = parseCoupangAdTable(WITHOUT_HEADER);
    expect(wing.rows[0].channelType).toBe('coupang_wing');
  });

  it('판매 방식이 없으면 채널은 null이다', () => {
    const noMethod = 'ON\t상품\nID: 95000000003\t1,000원\t2,000원';
    const { rows } = parseCoupangAdTable(noMethod);
    expect(rows[0].channelType).toBeNull();
  });

  it('같은 ID가 여러 캠페인에 나오면 합산한다', () => {
    const twice = [WITHOUT_HEADER, WITHOUT_HEADER].join('\n');
    const { rows } = parseCoupangAdTable(twice);
    expect(rows).toHaveLength(1);
    expect(rows[0].adSpend).toBe(1008);
  });

  it('ID가 하나도 없으면 빈 결과와 경고를 낸다', () => {
    const { rows, warnings } = parseCoupangAdTable('아무 관계 없는 텍스트');
    expect(rows).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('금액 열이 모자라면 그 행을 0원으로 두고 경고한다', () => {
    const broken = 'ON\t뭔가 상품\nID: 95000000001\t● 운영 중\t로켓그로스';
    const { rows, warnings } = parseCoupangAdTable(broken);
    expect(rows[0]).toMatchObject({ externalId: '95000000001', adSpend: 0 });
    expect(warnings.some((w) => w.includes('95000000001'))).toBe(true);
  });

  it('공백·빈 줄이 섞여 있어도 견딘다', () => {
    const messy = WITH_HEADER.replace(/\n/g, '\n\n  ');
    const { rows } = parseCoupangAdTable(messy);
    expect(rows).toHaveLength(3);
    expect(rows[0].adSpend).toBe(5016);
  });

  it('집행 광고비가 전환 매출보다 앞에 오는 열 순서도 헤더대로 읽는다', () => {
    const swapped = [
      'ON/OFF\t상품명\t집행 광고비\t광고 전환 매출',
      'ON\t스왑 상품',
      'ID: 95000000002\t1,000원\t9,000원',
    ].join('\n');
    const { rows } = parseCoupangAdTable(swapped);
    expect(rows[0].adSpend).toBe(1000);
  });
});
