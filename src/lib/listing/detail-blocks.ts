/**
 * detail-blocks.ts
 *
 * 쿠팡/네이버 상품상세 HTML 말미에 삽입하는 커스텀 블록 3종.
 * - 모든 CSS는 inline style (마켓은 외부 CSS/class 무시)
 * - 최대 너비 860px, 흰 배경, 회색 테두리
 *
 * 서버 전용 — 변수 주입을 받아 HTML 문자열을 반환합니다.
 */

// ─────────────────────────────────────────
// 공통 스타일 상수
// ─────────────────────────────────────────

const WRAP = `max-width:860px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;color:#333;line-height:1.7;`;
const BOX = `background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:24px 28px;margin:8px 0;`;
const H2 = `font-size:16px;font-weight:700;color:#222;margin:0 0 16px;padding-bottom:10px;border-bottom:2px solid #ddd;`;
const TBL = `width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;`;
const TH = `background:#f0f0f0;border:1px solid #ddd;padding:8px 12px;text-align:center;font-weight:600;`;
const TD = `border:1px solid #ddd;padding:8px 12px;vertical-align:top;`;
const DIVIDER = `<hr style="border:none;border-top:2px solid #eee;margin:32px 0;">`;
const STEP_BOX = `display:inline-block;background:#4a90e2;color:#fff;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;text-align:center;min-width:80px;`;
const ARROW = `display:inline-block;color:#999;font-size:18px;margin:0 8px;vertical-align:middle;`;
const HIGHLIGHT = `background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:10px 14px;margin:10px 0;font-size:13px;`;

// ─────────────────────────────────────────
// 블록 A: 공지안내 + 배송흐름도
// ─────────────────────────────────────────

export interface ShippingNoticeBlockVars {
  sellerName: string;      // "OO스토어" (내 스토어명)
  supplierName?: string;   // 도매꾹 판매자명 (위탁배송 발송자)
  shippingDays?: number;   // 배송 소요일 (기본 3)
}

export function renderShippingNoticeBlock(vars: ShippingNoticeBlockVars): string {
  const { supplierName, shippingDays = 3 } = vars;

  return `
<div style="${WRAP}">
  <div style="${BOX}">
    <h2 style="${H2}">📦 배송 안내</h2>

    <p style="margin:0 0 16px;font-size:14px;">
      본 상품은 <strong>${supplierName ?? '협력 업체'}</strong>에서 직접 발송합니다.
    </p>

    <!-- 배송 흐름도 -->
    <div style="text-align:center;padding:16px 0;overflow-x:auto;white-space:nowrap;">
      <span style="${STEP_BOX}">주문 접수</span>
      <span style="${ARROW}">▶</span>
      <span style="${STEP_BOX}">결제 확인</span>
      <span style="${ARROW}">▶</span>
      <span style="${STEP_BOX}">상품 준비</span>
      <span style="${ARROW}">▶</span>
      <span style="${STEP_BOX}">발송 완료</span>
      <span style="${ARROW}">▶</span>
      <span style="${STEP_BOX}">배송 완료</span>
    </div>

    <table style="${TBL}">
      <colgroup>
        <col style="width:30%">
        <col style="width:70%">
      </colgroup>
      <tr>
        <th style="${TH}">배송 방법</th>
        <td style="${TD}">택배 (CJ대한통운 / 로젠택배)</td>
      </tr>
      <tr>
        <th style="${TH}">배송 기간</th>
        <td style="${TD}">결제 확인 후 <strong>${shippingDays}일 이내</strong> 출고 (영업일 기준, 주말·공휴일 제외)</td>
      </tr>
      <tr>
        <th style="${TH}">도서산간 안내</th>
        <td style="${TD}">제주도 및 도서산간 지역은 추가 배송비가 발생할 수 있으며, 배송 기간이 2~3일 추가될 수 있습니다.</td>
      </tr>
    </table>

    <div style="${HIGHLIGHT}">
      ⚠️ 재고 상황에 따라 발송이 지연될 수 있습니다. 지연 시 별도 안내 드립니다.
    </div>
  </div>
</div>
${DIVIDER}`;
}

// ─────────────────────────────────────────
// 블록 B: 반품/교환 + CS 운영시간
// ─────────────────────────────────────────

export interface ReturnCsBlockVars {
  sellerName: string;
  csPhone: string;           // "070-1234-5678"
  csHours: string;           // "평일 10:00~17:00 (점심 12:00~13:00)"
  returnAddress?: string;    // 미입력 시 "판매자에게 문의해주세요"
}

export function renderReturnCsBlock(vars: ReturnCsBlockVars): string {
  const {
    sellerName,
    csPhone,
    csHours,
    returnAddress = '고객센터 문의 후 안내드립니다.',
  } = vars;

  return `
<div style="${WRAP}">
  <div style="${BOX}">
    <h2 style="${H2}">🔄 교환 / 반품 안내</h2>

    <table style="${TBL}">
      <colgroup>
        <col style="width:25%">
        <col style="width:35%">
        <col style="width:40%">
      </colgroup>
      <thead>
        <tr>
          <th style="${TH}">구분</th>
          <th style="${TH}">사유</th>
          <th style="${TH}">택배비 부담</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${TD};text-align:center;font-weight:600;">교환 / 반품<br>가능</td>
          <td style="${TD}">단순 변심 (수령 후 7일 이내)<br>상품 불량·오배송</td>
          <td style="${TD}">단순 변심: 구매자 부담 (왕복)<br>불량·오배송: 판매자 부담</td>
        </tr>
        <tr>
          <td style="${TD};text-align:center;font-weight:600;color:#e53935;">교환 / 반품<br>불가</td>
          <td style="${TD}">개봉·사용·세탁 후<br>상품 훼손·분실<br>포장 파손 시<br>수령 후 7일 초과</td>
          <td style="${TD}">—</td>
        </tr>
      </tbody>
    </table>

    <p style="margin:12px 0 4px;font-size:13px;color:#555;">
      반품 주소: <strong>${returnAddress}</strong>
    </p>

    <div style="${HIGHLIGHT}">
      ⚠️ 교환·반품 전 반드시 고객센터에 먼저 연락해 주세요. 사전 연락 없이 임의 반송 시 처리가 지연될 수 있습니다.
    </div>
  </div>

  <!-- CS 운영시간 -->
  <div style="${BOX};margin-top:12px;border-left:4px solid #4a90e2;">
    <h2 style="${H2}">📞 고객센터</h2>
    <table style="${TBL}">
      <colgroup>
        <col style="width:30%">
        <col style="width:70%">
      </colgroup>
      <tr>
        <th style="${TH}">판매자</th>
        <td style="${TD}">${sellerName}</td>
      </tr>
      <tr>
        <th style="${TH}">연락처</th>
        <td style="${TD}"><strong style="font-size:15px;">${csPhone}</strong></td>
      </tr>
      <tr>
        <th style="${TH}">운영시간</th>
        <td style="${TD}">${csHours}</td>
      </tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#888;">
      * 운영시간 외 문의는 게시판을 이용해 주세요. 빠른 시일 내 답변드리겠습니다.
    </p>
  </div>
</div>
${DIVIDER}`;
}

// ─────────────────────────────────────────
// 블록 C: 개인정보 수집 동의 안내
// ─────────────────────────────────────────

export interface PrivacyBlockVars {
  sellerName: string;
}

export function renderPrivacyBlock(vars: PrivacyBlockVars): string {
  const { sellerName } = vars;

  return `
<div style="${WRAP}">
  <div style="${BOX};font-size:12px;color:#666;">
    <h2 style="${H2};font-size:13px;">🔒 개인정보 수집·이용 안내</h2>

    <table style="${TBL}">
      <colgroup>
        <col style="width:30%">
        <col style="width:35%">
        <col style="width:35%">
      </colgroup>
      <thead>
        <tr>
          <th style="${TH};font-size:12px;">수집 항목</th>
          <th style="${TH};font-size:12px;">수집 목적</th>
          <th style="${TH};font-size:12px;">보유 기간</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${TD}">성명, 연락처, 주소</td>
          <td style="${TD}">주문·배송·CS 처리</td>
          <td style="${TD}">거래 종료 후 5년 (전자상거래법)</td>
        </tr>
      </tbody>
    </table>

    <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#888;">
      위 개인정보 수집·이용에 동의하지 않을 권리가 있으나, 거부 시 서비스 이용이 제한될 수 있습니다.<br>
      개인정보 처리에 관한 자세한 사항은 <strong>${sellerName}</strong>의 개인정보 처리방침을 확인해 주세요.
    </p>
  </div>
</div>`;
}

// ─────────────────────────────────────────
// 통합: 3개 블록 모두 합치기
// ─────────────────────────────────────────

export interface AllBlockVars extends ShippingNoticeBlockVars, ReturnCsBlockVars, PrivacyBlockVars {}

export function renderAllCustomBlocks(vars: AllBlockVars): string {
  return [
    renderShippingNoticeBlock(vars),
    renderReturnCsBlock(vars),
    renderPrivacyBlock(vars),
  ].join('\n');
}
