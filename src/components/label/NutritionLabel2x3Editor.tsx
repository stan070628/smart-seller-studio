'use client';

import { useState, useRef } from 'react';
import NutritionLabel2x3Preview from './NutritionLabel2x3Preview';
import type { NutritionRow } from './nutrition-types';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#374151',
};
const SECTION: React.CSSProperties = { marginBottom: 16 };

const INPUT_STYLE: React.CSSProperties = {
  padding: '5px 8px',
  border: '1px solid #d1d5db', borderRadius: 4,
  fontSize: 12, background: '#fff', color: '#111',
  boxSizing: 'border-box' as const,
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff',
};

const DEFAULT_ROWS: NutritionRow[] = [
  { id: '1', name: '나트륨',    amount: '840', unit: 'mg', percent: '42',  isSubItem: false, isHighlight: true  },
  { id: '2', name: '탄수화물',  amount: '45',  unit: 'g',  percent: '14',  isSubItem: false, isHighlight: false },
  { id: '3', name: '당류',      amount: '1',   unit: 'g',  percent: '1',   isSubItem: true,  isHighlight: false },
  { id: '4', name: '지방',      amount: '32',  unit: 'g',  percent: '59',  isSubItem: false, isHighlight: true  },
  { id: '5', name: '트랜스지방',amount: '0',   unit: 'g',  percent: '—',   isSubItem: true,  isHighlight: false },
  { id: '6', name: '포화지방',  amount: '16',  unit: 'g',  percent: '107', isSubItem: true,  isHighlight: false },
  { id: '7', name: '콜레스테롤',amount: '0',   unit: 'mg', percent: '0',   isSubItem: false, isHighlight: false },
  { id: '8', name: '단백질',    amount: '6',   unit: 'g',  percent: '11',  isSubItem: false, isHighlight: true  },
];

let nextId = 100;

export default function NutritionLabel2x3Editor() {
  const [productName, setProductName] = useState('');
  const [itemInfo, setItemInfo] = useState('');
  const [servingSize, setServingSize] = useState('');
  const [calories, setCalories] = useState('');
  const [rows, setRows] = useState<NutritionRow[]>(DEFAULT_ROWS);
  const previewRef = useRef<HTMLDivElement>(null);

  const updateRow = (id: string, patch: Partial<NutritionRow>) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: String(nextId++), name: '', amount: '', unit: 'g', percent: '', isSubItem: false, isHighlight: false },
    ]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handlePdf = async () => { if (previewRef.current) await generatePdf(previewRef.current); };
  const handlePrint = () => { if (previewRef.current) printLabel(previewRef.current); };

  return (
    <>
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          body * { visibility: hidden; }
          #nutrition-label-2x3-preview, #nutrition-label-2x3-preview * { visibility: visible; }
          #nutrition-label-2x3-preview { position: fixed; top: 0; left: 0; margin: 0; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: '100%', background: C.bg }}>
        {/* 좌측 폼 */}
        <div style={{
          width: 320, flexShrink: 0,
          background: '#fff', color: '#111', colorScheme: 'light',
          borderRight: `1px solid ${C.border}`,
          padding: 16, overflowY: 'auto',
        }}>
          {/* 제품 기본 정보 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>제품 정보</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="제품명"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="아이템 정보 (예: ITEM #1234 · 4.1kg × 44봉)"
                value={itemInfo}
                onChange={(e) => setItemInfo(e.target.value)}
              />
            </div>
          </div>

          {/* 1회 제공량 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>1회 제공량 / 칼로리</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{ ...INPUT_STYLE, flex: 2 }}
                placeholder="1회 제공량 (예: 1봉(93.5g))"
                value={servingSize}
                onChange={(e) => setServingSize(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, flex: 1 }}
                placeholder="kcal"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
              />
            </div>
          </div>

          {/* 영양소 목록 */}
          <div style={SECTION}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ ...SECTION_TITLE, marginBottom: 0, flex: 1 }}>영양소</span>
              <button
                onClick={addRow}
                style={{
                  padding: '3px 10px', borderRadius: 4,
                  border: '1px solid #d1d5db', fontSize: 11,
                  cursor: 'pointer', background: '#f9fafb', color: '#374151',
                }}
              >
                + 추가
              </button>
            </div>

            {/* 헤더 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '80px 50px 36px 40px 28px 28px 24px',
              gap: 3, marginBottom: 4,
              fontSize: 10, color: '#9ca3af', fontWeight: 600,
            }}>
              <span>영양소명</span>
              <span>함량</span>
              <span>단위</span>
              <span>%</span>
              <span>들여<br />쓰기</span>
              <span>강조</span>
              <span></span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {rows.map((row) => (
                <div key={row.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 50px 36px 40px 28px 28px 24px',
                  gap: 3, alignItems: 'center',
                }}>
                  <input
                    style={{ ...INPUT_STYLE, width: '100%', fontSize: 11 }}
                    placeholder="이름"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  />
                  <input
                    style={{ ...INPUT_STYLE, width: '100%', fontSize: 11 }}
                    placeholder="량"
                    value={row.amount}
                    onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                  />
                  <select
                    style={{ ...INPUT_STYLE, width: '100%', fontSize: 11 }}
                    value={row.unit}
                    onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                  >
                    <option value="g">g</option>
                    <option value="mg">mg</option>
                    <option value="μg">μg</option>
                    <option value="kcal">kcal</option>
                    <option value="">-</option>
                  </select>
                  <input
                    style={{ ...INPUT_STYLE, width: '100%', fontSize: 11 }}
                    placeholder="% or —"
                    value={row.percent}
                    onChange={(e) => updateRow(row.id, { percent: e.target.value })}
                  />
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={row.isSubItem}
                      onChange={(e) => updateRow(row.id, { isSubItem: e.target.checked })}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={row.isHighlight}
                      onChange={(e) => updateRow(row.id, { isHighlight: e.target.checked })}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>
                  <button
                    onClick={() => removeRow(row.id)}
                    style={{
                      padding: '2px 4px', border: 'none',
                      borderRadius: 3, cursor: 'pointer',
                      background: 'transparent', color: '#9ca3af',
                      fontSize: 12, lineHeight: 1,
                    }}
                    title="삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 우측 미리보기 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            background: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 2×3 (영양정보 라벨)
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>⬇ PDF 저장</button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>🖨 바로 인쇄</button>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 20,
            background: '#e5e7eb', display: 'flex', justifyContent: 'center',
          }}>
            <NutritionLabel2x3Preview
              ref={previewRef}
              productName={productName}
              itemInfo={itemInfo}
              servingSize={servingSize}
              calories={calories}
              rows={rows}
            />
          </div>
        </div>
      </div>
    </>
  );
}
