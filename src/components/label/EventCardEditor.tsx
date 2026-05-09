'use client';

import { useState, useRef } from 'react';
import EventCardPreview from './EventCardPreview';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';
import LabelSaveLoad from './LabelSaveLoad';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#374151',
};
const SECTION: React.CSSProperties = { marginBottom: 16 };

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '6px 8px',
  border: '1px solid #d1d5db', borderRadius: 4,
  fontSize: 12, boxSizing: 'border-box' as const,
  background: '#fff', color: '#111',
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff',
};

export default function EventCardEditor() {
  const [companyName, setCompanyName] = useState('청연코퍼레이션');
  const [phone, setPhone] = useState('');
  const [prizeText, setPrizeText] = useState('100% 전원 스타벅스 아메리카노 기프트콘 증정');
  const [thanksMsg, setThanksMsg] = useState('구매해 주셔서 진심으로 감사드립니다!');
  const previewRef = useRef<HTMLDivElement>(null);

  const handlePdf = async () => {
    if (!previewRef.current) return;
    await generatePdf(previewRef.current);
  };

  const handlePrint = () => {
    if (!previewRef.current) return;
    printLabel(previewRef.current);
  };

  return (
    <>
      <style>{`
        @media print {
          /* 배경색·그라디언트 강제 인쇄 (브라우저 기본은 잉크 절약 위해 미인쇄) */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          body * { visibility: hidden; }
          #event-card-preview, #event-card-preview * { visibility: visible; }
          #event-card-preview { position: fixed; top: 0; left: 0; margin: 0; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: '100%', background: C.bg }}>

        {/* 좌측 폼 */}
        <div style={{
          width: 300, flexShrink: 0,
          background: '#fff', color: '#111', colorScheme: 'light',
          borderRight: `1px solid ${C.border}`,
          padding: 16, overflowY: 'auto',
        }}>
          {/* 저장 / 불러오기 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>저장 / 불러오기</div>
            <LabelSaveLoad
              labelType="event"
              currentData={{ companyName, phone, prizeText, thanksMsg }}
              onLoad={(data) => {
                const d = data as { companyName?: string; phone?: string; prizeText?: string; thanksMsg?: string };
                if (d.companyName !== undefined) setCompanyName(d.companyName);
                if (d.phone !== undefined) setPhone(d.phone);
                if (d.prizeText !== undefined) setPrizeText(d.prizeText);
                if (d.thanksMsg !== undefined) setThanksMsg(d.thanksMsg);
              }}
            />
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>회사 / 연락처</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input style={INPUT_STYLE} placeholder="회사명" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              <input style={INPUT_STYLE} placeholder="전화번호 (선택)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>이벤트 내용</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input style={INPUT_STYLE} placeholder="경품 문구" value={prizeText} onChange={(e) => setPrizeText(e.target.value)} />
              <input style={INPUT_STYLE} placeholder="감사 인사" value={thanksMsg} onChange={(e) => setThanksMsg(e.target.value)} />
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
            <b style={{ color: '#374151' }}>참여 방법</b>은 고정 텍스트입니다.<br />
            ① 사진 리뷰 남기기<br />
            ② 회사명으로 문자 보내기<br />
            ③ 기프트콘 수령
          </div>
        </div>

        {/* 우측 미리보기 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            background: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 99.1×92mm × 6칸 (리뷰 이벤트 카드)
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>⬇ PDF 저장</button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>🖨 바로 인쇄</button>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 20,
            background: '#e5e7eb', display: 'flex', justifyContent: 'center',
          }}>
            <EventCardPreview
              ref={previewRef}
              companyName={companyName}
              phone={phone}
              prizeText={prizeText}
              thanksMsg={thanksMsg}
            />
          </div>
        </div>
      </div>
    </>
  );
}
