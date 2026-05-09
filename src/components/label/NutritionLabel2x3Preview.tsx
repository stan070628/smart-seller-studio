'use client';

import { forwardRef } from 'react';
import type { NutritionRow } from './nutrition-types';

interface Props {
  productName: string;
  itemInfo: string;
  foodType: string;
  importer: string;
  manufacturer: string;
  originCountry: string;
  contentAmount: string;
  expiryDate: string;
  storageMethod: string;
  ingredients: string;
  returnAddress: string;
  caution: string;
  servingSize: string;
  calories: string;
  rows: NutritionRow[];
}

const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 92;

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${CELL_WIDTH_MM}mm ${CELL_WIDTH_MM}mm`,
  gridTemplateRows: `repeat(3, ${CELL_HEIGHT_MM}mm)`,
  columnGap: '0.9mm',
  rowGap: '1.3mm',
  padding: '7mm 5mm',
  width: '210mm',
  boxSizing: 'border-box' as const,
  background: '#fff',
};

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_WIDTH_MM}mm`,
  height: `${CELL_HEIGHT_MM}mm`,
  overflow: 'hidden',
  boxSizing: 'border-box' as const,
  border: '1px solid #111',
  display: 'flex',
  flexDirection: 'column',
  background: 'white',
};

/* 공통 테이블 셀 */
const TH: React.CSSProperties = {
  padding: '0.55mm 1mm',
  border: '0.4px solid #bbb',
  fontWeight: 700,
  background: '#efefef',
  color: '#222',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap' as const,
  fontSize: '5.2px',
  textAlign: 'left' as const,
  width: '30%',
};
const TD: React.CSSProperties = {
  padding: '0.55mm 1mm',
  border: '0.4px solid #bbb',
  color: '#111',
  verticalAlign: 'middle',
  fontSize: '5.2px',
  lineHeight: 1.3,
  wordBreak: 'break-all' as const,
};

function NutritionCell({
  productName, itemInfo, foodType, importer, manufacturer,
  originCountry, contentAmount, expiryDate, storageMethod, ingredients,
  returnAddress, caution,
  servingSize, calories, rows,
}: Props) {
  return (
    <>
      {/* ── 한글 표시사항 ── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #111' }}>
        <div style={{
          background: '#ddd', textAlign: 'center',
          fontSize: '5.5px', fontWeight: 700, color: '#111',
          padding: '0.5mm', letterSpacing: '0.06em',
        }}>
          한 글 표 시 사 항
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
          <tbody>
            {[
              ['제품명', productName],
              ['식품유형', foodType],
              ['수입/판매업소', importer],
              ['제조업소', manufacturer],
              ['원산지', originCountry],
              ['내용량', contentAmount],
              ['소비기한', expiryDate],
              ['보관방법', storageMethod],
              ['원재료명', ingredients],
              ['반품·교환장소', returnAddress],
              ['기타 주의사항', caution],
            ].map(([label, value]) => (
              <tr key={label}>
                <td style={TH}>{label}</td>
                <td style={TD}>{value || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 영양정보 ── */}
      <div style={{ flexShrink: 0 }}>
        {/* 영양정보 타이틀 */}
        <div style={{
          background: '#111', color: '#fff',
          textAlign: 'center', padding: '0.6mm 1mm',
          fontSize: '5.5px', fontWeight: 900,
          letterSpacing: '0.12em',
        }}>
          영 양 정 보
        </div>

        {/* 1회 제공량 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '0.5mm 1.5mm',
          borderBottom: '1.2px solid #111',
          fontSize: '5px', color: '#222',
        }}>
          <span>{servingSize || '1회 제공량'}당</span>
          <span>
            <span style={{ fontSize: '9px', fontWeight: 900, color: '#111' }}>{calories || '0'}</span>
            <span style={{ fontSize: '4.5px', fontWeight: 600 }}> kcal</span>
          </span>
        </div>

        {/* 영양소 테이블 */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
          <thead>
            <tr style={{ background: '#111', color: '#fff' }}>
              <th style={{ padding: '0.5mm 1mm', fontSize: '4.5px', fontWeight: 700, textAlign: 'left', border: '0.4px solid #555', width: '42%' }}>영양성분</th>
              <th style={{ padding: '0.5mm 1mm', fontSize: '4.5px', fontWeight: 700, textAlign: 'right', border: '0.4px solid #555' }}>1회제공량당</th>
              <th style={{ padding: '0.5mm 1mm', fontSize: '4.5px', fontWeight: 700, textAlign: 'right', border: '0.4px solid #555', whiteSpace: 'nowrap' }}>%기준치</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} style={{ background: idx % 2 === 0 ? '#f5f5f5' : '#fff' }}>
                <td style={{
                  padding: '0.45mm 1mm',
                  paddingLeft: row.isSubItem ? '2.5mm' : '1mm',
                  border: '0.4px solid #ccc',
                  color: row.isSubItem ? '#555' : '#111',
                  fontWeight: row.isSubItem ? 400 : 700,
                  fontSize: row.isSubItem ? '4.5px' : '5px',
                }}>
                  {row.name}
                </td>
                <td style={{ padding: '0.45mm 1mm', border: '0.4px solid #ccc', textAlign: 'right', fontWeight: 700, fontSize: '5px', whiteSpace: 'nowrap' }}>
                  {row.amount}{row.unit}
                </td>
                <td style={{ padding: '0.45mm 1mm', border: '0.4px solid #ccc', textAlign: 'right', color: '#444', fontSize: '5px', whiteSpace: 'nowrap' }}>
                  {row.percent !== '' ? `${row.percent}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 각주 */}
        <div style={{
          padding: '0.5mm 1mm',
          fontSize: '4px', color: '#666',
          borderTop: '0.4px solid #ccc',
          lineHeight: 1.3,
        }}>
          %영양성분 기준치는 2,000kcal 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다.
        </div>
      </div>
    </>
  );
}

const NutritionLabel2x3Preview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="nutrition-label-2x3-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2].map((i) => (
        <>
          <div key={`a-${i}`} style={CELL_STYLE}>
            <NutritionCell {...props} />
          </div>
          <div key={`b-${i}`} style={CELL_STYLE}>
            <NutritionCell {...props} />
          </div>
        </>
      ))}
    </div>
  );
});

NutritionLabel2x3Preview.displayName = 'NutritionLabel2x3Preview';
export default NutritionLabel2x3Preview;
