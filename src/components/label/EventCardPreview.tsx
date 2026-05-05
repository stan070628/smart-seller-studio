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
// flex/table 없이 block 레이아웃 + 명시적 height → html2canvas PDF 완전 호환
const H_HEADER  = 24; // mm
const H_THANKS  = 22; // mm
const H_FOOTER  =  8; // mm
const H_STEPS   = CELL_HEIGHT_MM - H_HEADER - H_THANKS - H_FOOTER; // 38mm

function EventCard({ companyName, phone, prizeText, thanksMsg }: Props) {
  const steps = [
    '구매하신 쇼핑몰에 사진 리뷰 남기기 📸',
    `${companyName}으로 구매 인증 문자 보내기`,
    '스타벅스 아메리카노 기프트콘 수령 🎁',
  ];

  return (
    <div style={{
      width: `${CELL_WIDTH_MM}mm`,
      height: `${CELL_HEIGHT_MM}mm`,
      overflow: 'hidden',
      border: '0.5px solid #ccc',
      boxSizing: 'border-box',
    }}>
      {/* 헤더 — 고정 높이 */}
      <div style={{
        height: `${H_HEADER}mm`,
        overflow: 'hidden',
        boxSizing: 'border-box',
        background: 'linear-gradient(135deg, #00704A 0%, #1E3932 100%)',
        color: '#fff',
        textAlign: 'center',
        padding: '4mm 3mm 2mm',
      }}>
        <div style={{ fontSize: 8, fontWeight: 500, opacity: 0.85, letterSpacing: 1, marginBottom: 2 }}>
          ☕ REVIEW EVENT
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.3 }}>
          리뷰 이벤트
        </div>
        <div style={{
          marginTop: 3, fontSize: 8, fontWeight: 600,
          background: 'rgba(255,255,255,0.18)',
          borderRadius: 20, padding: '2px 8px', display: 'inline-block',
        }}>
          {prizeText}
        </div>
      </div>

      {/* 감사 메시지 — 고정 높이 */}
      <div style={{
        height: `${H_THANKS}mm`,
        overflow: 'hidden',
        boxSizing: 'border-box',
        background: '#f9f6f0',
        textAlign: 'center',
        padding: '3mm 4mm 2mm',
      }}>
        <div style={{ fontSize: 14, marginBottom: 2 }}>🙏</div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: '#1e1e1e', lineHeight: 1.5 }}>
          {thanksMsg}
        </div>
        <div style={{ fontSize: 8, color: '#6b6b6b', marginTop: 2, lineHeight: 1.4 }}>
          소중한 리뷰 한 줄이 저희에게 큰 힘이 됩니다 ☕
        </div>
      </div>

      {/* 참여 방법 — 고정 높이, paddingTop으로 세로 중앙 근사 */}
      <div style={{
        height: `${H_STEPS}mm`,
        overflow: 'hidden',
        boxSizing: 'border-box',
        background: '#fff',
        padding: '6mm 4mm 2mm',
      }}>
        <div style={{ fontSize: 7.5, fontWeight: 700, color: '#00704A', letterSpacing: 0.5, borderBottom: '1px solid #e5e5e5', paddingBottom: '1.5mm', marginBottom: '2mm' }}>
          ✦ 참여 방법
        </div>
        {steps.map((text, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: 8.5, color: '#2d2d2d', lineHeight: 1.4, marginBottom: idx < 2 ? '2mm' : 0 }}>
            <div style={{
              width: 15, height: 15, flexShrink: 0, marginRight: 5,
              background: '#00704A', color: '#fff',
              borderRadius: '50%',
              textAlign: 'center', lineHeight: '15px',
              fontSize: 8, fontWeight: 700,
            }}>
              {idx + 1}
            </div>
            {text}
          </div>
        ))}
      </div>

      {/* 푸터 — 고정 높이 */}
      <div style={{
        height: `${H_FOOTER}mm`,
        overflow: 'hidden',
        boxSizing: 'border-box',
        background: '#1E3932',
        color: 'rgba(255,255,255,0.75)',
        textAlign: 'center',
        padding: '2mm 2mm',
        fontSize: 7.5,
      }}>
        문자 발송 <span style={{ color: '#fff', fontWeight: 700 }}>{companyName}</span>
        {phone && <> &nbsp;|&nbsp; <span style={{ color: '#fff', fontWeight: 700 }}>{phone}</span></>}
      </div>
    </div>
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
