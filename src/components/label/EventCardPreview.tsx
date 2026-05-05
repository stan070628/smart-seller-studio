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

function EventCard({ companyName, phone, prizeText, thanksMsg }: Props) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      border: '0.5px solid #ccc',
    }}>
      {/* 상단 헤더 - 스타벅스 그린 */}
      <div style={{
        background: 'linear-gradient(135deg, #00704A 0%, #1E3932 100%)',
        color: '#fff',
        textAlign: 'center',
        padding: '4mm 3mm 3mm',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 8, fontWeight: 500, opacity: 0.85, letterSpacing: 1, marginBottom: 2 }}>
          ☕ REVIEW EVENT
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.3 }}>
          리뷰 이벤트
        </div>
        <div style={{
          marginTop: 3,
          fontSize: 8,
          fontWeight: 600,
          background: 'rgba(255,255,255,0.18)',
          borderRadius: 20,
          padding: '2px 8px',
          display: 'inline-block',
        }}>
          {prizeText}
        </div>
      </div>

      {/* 중단 감사 메시지 */}
      <div style={{
        background: '#f9f6f0',
        padding: '3mm 4mm',
        textAlign: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 14, marginBottom: 2 }}>🙏</div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: '#1e1e1e', lineHeight: 1.5 }}>
          {thanksMsg}
        </div>
        <div style={{ fontSize: 8, color: '#6b6b6b', marginTop: 2, lineHeight: 1.4 }}>
          소중한 리뷰 한 줄이 저희에게 큰 힘이 됩니다 ☕
        </div>
      </div>

      {/* 하단 참여 방법 - 내부 div로 묶어 세로 중앙 정렬 (gap 미지원 PDF 대응) */}
      <div style={{
        flex: 1,
        padding: '0 4mm',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}>
        <div>
          <div style={{ fontSize: 7.5, fontWeight: 700, color: '#00704A', letterSpacing: 0.5, borderBottom: '1px solid #e5e5e5', paddingBottom: '1.5mm', marginBottom: '2mm' }}>
            ✦ 참여 방법
          </div>
          {[
            '구매하신 쇼핑몰에 사진 리뷰 남기기 📸',
            `${companyName}으로 구매 인증 문자 보내기`,
            '스타벅스 아메리카노 기프트콘 수령 🎁',
          ].map((text, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: 8.5, color: '#2d2d2d', lineHeight: 1.4, marginBottom: idx < 2 ? '2mm' : 0 }}>
              <div style={{
                width: 15, height: 15,
                background: '#00704A', color: '#fff',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, flexShrink: 0,
                marginRight: 5,
              }}>
                {idx + 1}
              </div>
              {text}
            </div>
          ))}
        </div>
      </div>

      {/* 푸터 */}
      <div style={{
        background: '#1E3932',
        color: 'rgba(255,255,255,0.75)',
        textAlign: 'center',
        padding: '1.5mm 2mm',
        fontSize: 7.5,
        flexShrink: 0,
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
