'use client';

import { useState, useRef, useEffect } from 'react';
import QualityLabel2x3Preview from './QualityLabel2x3Preview';
import QualityFieldsForm from './QualityFieldsForm';
import LabelSaveLoad from './LabelSaveLoad';
import type { QualityFields } from '@/lib/label/label-templates';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';
// 계산기(src/components/calculator/persist.ts)의 검증된 SSR-safe localStorage 헬퍼를 재사용한다.
import { loadCalcState as loadPersistedState, saveCalcState as savePersistedState, CALC_SAVE_DEBOUNCE_MS } from '@/components/calculator/persist';

const STORAGE_KEY = 'sss_label_quality2x3';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#374151',
};
const SECTION: React.CSSProperties = { marginBottom: 16 };

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff',
};

const EMPTY_FIELDS: QualityFields = {
  productName: '', material: '', size: '',
  country: '', importer: '', address: '', phone: '', extra: '',
};

export default function QualityLabel2x3Editor() {
  const [fields, setFields] = useState<QualityFields>(EMPTY_FIELDS);
  const previewRef = useRef<HTMLDivElement>(null);

  // 마운트 후 1회 복원. 저장된 값이 없으면 EMPTY_FIELDS 기본값을 그대로 쓴다.
  useEffect(() => {
    const saved = loadPersistedState<Partial<QualityFields>>(STORAGE_KEY);
    if (Object.keys(saved).length > 0) setFields((prev) => ({ ...prev, ...saved }));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => savePersistedState(STORAGE_KEY, fields), CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fields]);

  const handlePdf = async () => { if (previewRef.current) await generatePdf(previewRef.current); };
  const handlePrint = () => { if (previewRef.current) printLabel(previewRef.current); };

  return (
    <>
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          body * { visibility: hidden; }
          #quality-label-2x3-preview, #quality-label-2x3-preview * { visibility: visible; }
          #quality-label-2x3-preview { position: fixed; top: 0; left: 0; margin: 0; }
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
              labelType="quality2x3"
              currentData={fields as unknown as Record<string, unknown>}
              onLoad={(data) => setFields({ ...EMPTY_FIELDS, ...(data as Partial<QualityFields>) })}
            />
          </div>

          {/* 품질 표시 항목 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>제품 품질 표시</div>
            <QualityFieldsForm fields={fields} onChange={setFields} />
          </div>
        </div>

        {/* 우측 미리보기 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            background: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 2×3 (품질표시 라벨)
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>⬇ PDF 저장</button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>🖨 바로 인쇄</button>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 20,
            background: '#e5e7eb', display: 'flex', justifyContent: 'center',
          }}>
            <QualityLabel2x3Preview ref={previewRef} fields={fields} />
          </div>
        </div>
      </div>
    </>
  );
}
