'use client';

import { useState, useRef } from 'react';
import NutritionLabel2x3Preview from './NutritionLabel2x3Preview';
import type { NutritionRow } from './nutrition-types';
import LabelSaveLoad from './LabelSaveLoad';
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

const TEXTAREA_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  resize: 'vertical' as const,
  minHeight: 52,
  lineHeight: 1.5,
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff',
};

const DEFAULT_ROWS: NutritionRow[] = [
  { id: '1', name: '나트륨',     amount: '840', unit: 'mg', percent: '42',  isSubItem: false, isHighlight: true  },
  { id: '2', name: '탄수화물',   amount: '45',  unit: 'g',  percent: '14',  isSubItem: false, isHighlight: false },
  { id: '3', name: '당류',       amount: '1',   unit: 'g',  percent: '1',   isSubItem: true,  isHighlight: false },
  { id: '4', name: '지방',       amount: '32',  unit: 'g',  percent: '59',  isSubItem: false, isHighlight: true  },
  { id: '5', name: '트랜스지방', amount: '0',   unit: 'g',  percent: '—',   isSubItem: true,  isHighlight: false },
  { id: '6', name: '포화지방',   amount: '16',  unit: 'g',  percent: '107', isSubItem: true,  isHighlight: false },
  { id: '7', name: '콜레스테롤', amount: '0',   unit: 'mg', percent: '0',   isSubItem: false, isHighlight: false },
  { id: '8', name: '단백질',     amount: '6',   unit: 'g',  percent: '11',  isSubItem: false, isHighlight: true  },
];

let nextId = 100;

export default function NutritionLabel2x3Editor() {
  /* 한글 표시사항 */
  const [productName, setProductName] = useState('');
  const [itemInfo, setItemInfo] = useState('');
  const [foodType, setFoodType] = useState('');
  const [importer, setImporter] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [contentAmount, setContentAmount] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [storageMethod, setStorageMethod] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [returnAddress, setReturnAddress] = useState('');
  const [caution, setCaution] = useState('');

  /* 소분 계산기 */
  const [unitCount, setUnitCount] = useState('');
  const [unitWeight, setUnitWeight] = useState('');
  const [unitUnit, setUnitUnit] = useState('봉');

  /* 영양정보 */
  const [servingSize, setServingSize] = useState('');
  const [calories, setCalories] = useState('');
  const [rows, setRows] = useState<NutritionRow[]>(DEFAULT_ROWS);

  const previewRef = useRef<HTMLDivElement>(null);

  const applySubdivision = () => {
    const count = parseInt(unitCount, 10);
    const weight = parseFloat(unitWeight);
    const kcal = parseFloat(calories);
    if (!count || !weight) return;
    const totalWeight = (count * weight).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
    const totalKcal = kcal ? (count * kcal).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '';
    const kcalStr = totalKcal ? ` / 총열량 ${totalKcal}kcal` : '';
    setContentAmount(`${totalWeight}g (${weight}g × ${count}${unitUnit})${kcalStr}`);
    if (!servingSize) setServingSize(`1${unitUnit}(${weight}g)`);
  };

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
          width: 340, flexShrink: 0,
          background: '#fff', color: '#111', colorScheme: 'light',
          borderRight: `1px solid ${C.border}`,
          padding: 16, overflowY: 'auto',
        }}>

          {/* 1. 저장 / 불러오기 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>저장 / 불러오기</div>
            <LabelSaveLoad
              labelType="nutrition2x3"
              currentData={{
                productName, itemInfo, foodType, importer, manufacturer,
                originCountry, contentAmount, expiryDate, storageMethod, ingredients,
                returnAddress, caution,
                unitCount, unitWeight, unitUnit,
                servingSize, calories, rows,
              }}
              onLoad={(data) => {
                const d = data as {
                  productName?: string; itemInfo?: string; foodType?: string;
                  importer?: string; manufacturer?: string; originCountry?: string;
                  contentAmount?: string; expiryDate?: string; storageMethod?: string;
                  ingredients?: string; returnAddress?: string; caution?: string;
                  unitCount?: string; unitWeight?: string; unitUnit?: string;
                  servingSize?: string; calories?: string; rows?: NutritionRow[];
                };
                if (d.productName !== undefined) setProductName(d.productName);
                if (d.itemInfo !== undefined) setItemInfo(d.itemInfo);
                if (d.foodType !== undefined) setFoodType(d.foodType);
                if (d.importer !== undefined) setImporter(d.importer);
                if (d.manufacturer !== undefined) setManufacturer(d.manufacturer);
                if (d.originCountry !== undefined) setOriginCountry(d.originCountry);
                if (d.contentAmount !== undefined) setContentAmount(d.contentAmount);
                if (d.expiryDate !== undefined) setExpiryDate(d.expiryDate);
                if (d.storageMethod !== undefined) setStorageMethod(d.storageMethod);
                if (d.ingredients !== undefined) setIngredients(d.ingredients);
                if (d.returnAddress !== undefined) setReturnAddress(d.returnAddress);
                if (d.caution !== undefined) setCaution(d.caution);
                if (d.unitCount !== undefined) setUnitCount(d.unitCount);
                if (d.unitWeight !== undefined) setUnitWeight(d.unitWeight);
                if (d.unitUnit !== undefined) setUnitUnit(d.unitUnit);
                if (d.servingSize !== undefined) setServingSize(d.servingSize);
                if (d.calories !== undefined) setCalories(d.calories);
                if (d.rows) setRows(d.rows);
              }}
            />
          </div>

          {/* 2. 한글 표시사항 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>한글 표시사항</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="제품명"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="헤더 부제 (예: ITEM #1234 · 4.1kg × 44봉)"
                value={itemInfo}
                onChange={(e) => setItemInfo(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="식품유형 (예: 팝콘)"
                value={foodType}
                onChange={(e) => setFoodType(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="수입/판매업소 (예: (주)코스트코 코리아 T.1899-9900)"
                value={importer}
                onChange={(e) => setImporter(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="제조업소 (예: Weaver Popcorn Manufacturing, Inc.)"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="원산지 (예: 미국)"
                value={originCountry}
                onChange={(e) => setOriginCountry(e.target.value)}
              />

              {/* 내용량 + 소분 계산기 */}
              <div style={{
                border: '1px solid #e0e7ff', borderRadius: 6,
                background: '#f5f3ff', padding: '8px 10px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#6d28d9', marginBottom: 6 }}>
                  소분 계산기 — 판매 단위 입력 시 내용량 자동 생성
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  <input
                    style={{ ...INPUT_STYLE, width: 52, fontSize: 11 }}
                    placeholder="수량"
                    value={unitCount}
                    onChange={(e) => setUnitCount(e.target.value)}
                  />
                  <select
                    style={{ ...INPUT_STYLE, fontSize: 11, padding: '5px 4px' }}
                    value={unitUnit}
                    onChange={(e) => setUnitUnit(e.target.value)}
                  >
                    <option value="봉">봉</option>
                    <option value="개">개</option>
                    <option value="팩">팩</option>
                    <option value="캔">캔</option>
                  </select>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>× 1개당</span>
                  <input
                    style={{ ...INPUT_STYLE, width: 56, fontSize: 11 }}
                    placeholder="중량(g)"
                    value={unitWeight}
                    onChange={(e) => setUnitWeight(e.target.value)}
                  />
                  <span style={{ fontSize: 11, color: '#6b7280' }}>g</span>
                  <button
                    onClick={applySubdivision}
                    style={{
                      padding: '5px 10px', borderRadius: 4, border: 'none',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: '#6d28d9', color: '#fff',
                    }}
                  >
                    적용
                  </button>
                </div>
              </div>
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="내용량 (소분 계산기로 자동 생성 또는 직접 입력)"
                value={contentAmount}
                onChange={(e) => setContentAmount(e.target.value)}
              />

              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="소비기한 (예: 제품 표면 표기일까지)"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="보관방법 (예: 직사광선을 피하고 실온에서 보관하십시오)"
                value={storageMethod}
                onChange={(e) => setStorageMethod(e.target.value)}
              />
              <textarea
                style={{ ...TEXTAREA_STYLE, width: '100%' }}
                placeholder="원재료명 (예: 옥수수(미국), 정제소금, 버터향, 비타민C)"
                value={ingredients}
                onChange={(e) => setIngredients(e.target.value)}
              />
              <input
                style={{ ...INPUT_STYLE, width: '100%' }}
                placeholder="반품 및 교환 장소 (예: 구매처)"
                value={returnAddress}
                onChange={(e) => setReturnAddress(e.target.value)}
              />
              <textarea
                style={{ ...TEXTAREA_STYLE, width: '100%', minHeight: 40 }}
                placeholder="기타 주의사항 (예: 개봉 후 빨리 드세요)"
                value={caution}
                onChange={(e) => setCaution(e.target.value)}
              />
            </div>
          </div>

          {/* 3. 영양정보 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>영양정보</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
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

            {/* 영양소 목록 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ ...SECTION_TITLE, marginBottom: 0, fontSize: 11, flex: 1 }}>영양소 목록</span>
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
              미리보기 — A4 · 2×3 (한글표시사항 + 영양정보 라벨)
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>PDF 저장</button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>바로 인쇄</button>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 20,
            background: '#e5e7eb', display: 'flex', justifyContent: 'center',
          }}>
            <NutritionLabel2x3Preview
              ref={previewRef}
              productName={productName}
              itemInfo={itemInfo}
              foodType={foodType}
              importer={importer}
              manufacturer={manufacturer}
              originCountry={originCountry}
              contentAmount={contentAmount}
              expiryDate={expiryDate}
              storageMethod={storageMethod}
              ingredients={ingredients}
              returnAddress={returnAddress}
              caution={caution}
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
