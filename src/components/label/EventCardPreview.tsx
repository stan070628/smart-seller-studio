'use client';

import { forwardRef } from 'react';

interface Props {
  companyName: string;
  phone: string;
  prizeText: string;
  thanksMsg: string;
}

const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 92;
const GAP_H_MM = 0.9;
const GAP_V_MM = 1.3;

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${CELL_WIDTH_MM}mm ${CELL_WIDTH_MM}mm`,
  gridTemplateRows: `repeat(3, ${CELL_HEIGHT_MM}mm)`,
  columnGap: `${GAP_H_MM}mm`,
  rowGap: `${GAP_V_MM}mm`,
  padding: '7mm 5mm',
  width: '210mm',
  boxSizing: 'border-box' as const,
  background: '#fff',
};

// 섹션별 고정 높이 (합계 = CELL_HEIGHT_MM = 92mm)
const H_HEADER  = 26; // mm
const H_THANKS  = 26; // mm
const H_FOOTER  =  9; // mm
const H_STEPS   = CELL_HEIGHT_MM - H_HEADER - H_THANKS - H_FOOTER; // 31mm

/**
 * 카드 전체를 단일 <table>로 구성.
 * 핵심: 모든 <tr>에 명시적 height 지정 + <td>에 verticalAlign:middle.
 * - <table> 의 height 만으로는 td 가 늘어나지 않으므로 <tr> 에 직접 height 지정 필수
 * - 이게 html2canvas/PDF 렌더러가 vertical centering 을 100% 보장하는 유일한 방법
 */
function EventCard({ companyName, phone, prizeText, thanksMsg }: Props) {
  const steps = [
    '구매하신 쇼핑몰에 사진 리뷰 남기기 📸',
    `${companyName}으로 구매 인증 문자 보내기`,
    '스타벅스 아메리카노 기프트콘 수령 🎁',
  ];

  return (
    <table style={{
      width: `${CELL_WIDTH_MM}mm`,
      height: `${CELL_HEIGHT_MM}mm`,
      borderCollapse: 'collapse',
      tableLayout: 'fixed',
      border: '0.5px solid #ccc',
      boxSizing: 'border-box',
    }}>
      <tbody>
        {/* 헤더 — 명시적 row height + verticalAlign:middle */}
        <tr style={{ height: `${H_HEADER}mm` }}>
          <td style={{
            height: `${H_HEADER}mm`,
            background: 'linear-gradient(135deg, #00704A 0%, #1E3932 100%)',
            color: '#fff',
            textAlign: 'center',
            verticalAlign: 'middle',
            padding: '0 3mm',
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9, letterSpacing: 1, marginBottom: 3 }}>
              ☕ REVIEW EVENT
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>
              리뷰 이벤트
            </div>
            <div style={{
              marginTop: 4, fontSize: 10, fontWeight: 600,
              background: 'rgba(255,255,255,0.22)',
              borderRadius: 20, padding: '3px 10px', display: 'inline-block',
            }}>
              {prizeText}
            </div>
          </td>
        </tr>

        {/* 감사 메시지 */}
        <tr style={{ height: `${H_THANKS}mm` }}>
          <td style={{
            height: `${H_THANKS}mm`,
            background: '#f9f6f0',
            textAlign: 'center',
            verticalAlign: 'middle',
            padding: '0 4mm',
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: 18, marginBottom: 3 }}>🙏</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e1e1e', lineHeight: 1.5 }}>
              {thanksMsg}
            </div>
            <div style={{ fontSize: 10, color: '#6b6b6b', marginTop: 3, lineHeight: 1.4 }}>
              소중한 리뷰 한 줄이 저희에게 큰 힘이 됩니다 ☕
            </div>
          </td>
        </tr>

        {/* 참여 방법 — 핵심: tr+td 양쪽에 height 명시 */}
        <tr style={{ height: `${H_STEPS}mm` }}>
          <td style={{
            height: `${H_STEPS}mm`,
            background: '#fff',
            verticalAlign: 'middle',
            padding: '0 4mm',
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#00704A', letterSpacing: 0.5, borderBottom: '1px solid #e5e5e5', paddingBottom: '1.5mm', marginBottom: '2mm' }}>
              ✦ 참여 방법
            </div>
            {steps.map((text, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: '#2d2d2d', lineHeight: 1.35, marginBottom: idx < 2 ? '2mm' : 0 }}>
                <div style={{
                  width: 18, height: 18, flexShrink: 0, marginRight: 6,
                  background: '#00704A', color: '#fff',
                  borderRadius: '50%',
                  textAlign: 'center', lineHeight: '18px',
                  fontSize: 10, fontWeight: 700,
                }}>
                  {idx + 1}
                </div>
                {text}
              </div>
            ))}
          </td>
        </tr>

        {/* 푸터 */}
        <tr style={{ height: `${H_FOOTER}mm` }}>
          <td style={{
            height: `${H_FOOTER}mm`,
            background: '#1E3932',
            color: 'rgba(255,255,255,0.8)',
            textAlign: 'center',
            verticalAlign: 'middle',
            padding: '0 2mm',
            fontSize: 10,
            overflow: 'hidden',
          }}>
            문자 발송 <span style={{ color: '#fff', fontWeight: 700 }}>{companyName}</span>
            {phone && <> &nbsp;|&nbsp; <span style={{ color: '#fff', fontWeight: 700 }}>{phone}</span></>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_WIDTH_MM}mm`,
  height: `${CELL_HEIGHT_MM}mm`,
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const EventCardPreview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="event-card-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2].map((i) => {
        const rowExtra: React.CSSProperties = i === 2 ? { marginTop: '3mm' } : {};
        return (
          <>
            <div key={`a-${i}`} style={{ ...CELL_STYLE, ...rowExtra }}>
              <EventCard {...props} />
            </div>
            <div key={`b-${i}`} style={{ ...CELL_STYLE, ...rowExtra }}>
              <EventCard {...props} />
            </div>
          </>
        );
      })}
    </div>
  );
});

EventCardPreview.displayName = 'EventCardPreview';
export default EventCardPreview;
