'use client';

import { forwardRef } from 'react';
import type { NutritionRow } from './nutrition-types';

interface Props {
  productName: string;
  itemInfo: string;
  foodType: string;
  importer: string;
  manufacturer: string;
  contentAmount: string;
  expiryDate: string;
  originCountry: string;
  storageMethod: string;
  ingredients: string;
  servingSize: string;
  calories: string;
  rows: NutritionRow[];
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

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_WIDTH_MM}mm`,
  height: `${CELL_HEIGHT_MM}mm`,
  overflow: 'hidden',
  boxSizing: 'border-box' as const,
  border: '1.5px solid #111',
  display: 'flex',
  flexDirection: 'column',
  background: 'white',
  fontSize: '6.5px',
};

const TD_LABEL: React.CSSProperties = {
  padding: '0.6mm 1.2mm',
  border: '0.5px solid #ccc',
  fontWeight: 700,
  color: '#333',
  whiteSpace: 'nowrap',
  verticalAlign: 'top',
  width: '22%',
  fontSize: '5.8px',
};

const TD_VALUE: React.CSSProperties = {
  padding: '0.6mm 1.2mm',
  border: '0.5px solid #ccc',
  color: '#111',
  verticalAlign: 'top',
  fontSize: '5.8px',
  lineHeight: 1.35,
  wordBreak: 'break-all' as const,
};

function NutritionCell({
  productName, itemInfo, foodType, importer, manufacturer,
  contentAmount, expiryDate, originCountry, storageMethod, ingredients,
  servingSize, calories, rows,
}: Props) {
  return (
    <>
      {/* 제품명 헤더 */}
      <div style={{
        background: '#111', color: 'white',
        textAlign: 'center', padding: '1.2mm 2mm',
        fontSize: '7.5px', fontWeight: 700,
        letterSpacing: '-0.02em', lineHeight: 1.3,
        flexShrink: 0,
      }}>
        {productName || '제품명'}
        {itemInfo && (
          <div style={{ fontSize: '5.2px', fontWeight: 400, opacity: 0.85, marginTop: '0.4mm' }}>{itemInfo}</div>
        )}
      </div>

      {/* 한글 표시 사항 */}
      <div style={{ padding: '0.5mm 1mm', flexShrink: 0 }}>
        <div style={{ fontSize: '5.5px', fontWeight: 700, color: '#111', marginBottom: '0.5mm', letterSpacing: '0.04em' }}>
          한글 표시 사항
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '5.8px' }}>
          <tbody>
            <tr>
              <td style={TD_LABEL}>제품명</td>
              <td style={TD_VALUE}>{productName || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>식품유형</td>
              <td style={TD_VALUE}>{foodType || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>수입/판매원</td>
              <td style={TD_VALUE}>{importer || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>제조원</td>
              <td style={TD_VALUE}>{manufacturer || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>내용량</td>
              <td style={TD_VALUE}>{contentAmount || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>소비기한</td>
              <td style={TD_VALUE}>{expiryDate || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>원산지</td>
              <td style={TD_VALUE}>{originCountry || '-'}</td>
            </tr>
            <tr>
              <td style={TD_LABEL}>보관방법</td>
              <td style={TD_VALUE}>{storageMethod || '-'}</td>
            </tr>
            <tr>
              <td style={{ ...TD_LABEL, verticalAlign: 'top' }}>원재료명</td>
              <td style={{ ...TD_VALUE, maxHeight: '8mm', overflow: 'hidden' }}>{ingredients || '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 영양정보 타이틀 */}
      <div style={{
        background: '#111', color: 'white',
        textAlign: 'center', padding: '0.8mm 2mm',
        fontSize: '7px', fontWeight: 900,
        letterSpacing: '0.15em', flexShrink: 0,
      }}>
        영 양 정 보
      </div>

      {/* 1회 제공량 */}
      <div style={{
        padding: '0.7mm 1.5mm',
        borderBottom: '2px solid #111',
        fontSize: '5.8px', color: '#222',
        lineHeight: 1.4, flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span>{servingSize || '1회 제공량'}당</span>
        <span>
          <span style={{ fontSize: '9px', fontWeight: 900, color: '#111' }}>{calories || '0'}</span>
          <span style={{ fontSize: '5.5px', fontWeight: 600 }}> kcal</span>
        </span>
      </div>

      {/* 영양소 테이블 */}
      <table style={{
        flex: 1,
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '6px',
        tableLayout: 'fixed',
        minHeight: 0,
      }}>
        <thead>
          <tr style={{ background: '#111', color: 'white' }}>
            <th style={{ padding: '0.7mm 1.2mm', fontWeight: 700, fontSize: '5px', textAlign: 'left', border: '0.5px solid #555', width: '44%' }}>영양성분</th>
            <th style={{ padding: '0.7mm 1.2mm', fontWeight: 700, fontSize: '5px', textAlign: 'right', border: '0.5px solid #555' }}>1회제공량당</th>
            <th style={{ padding: '0.7mm 1.2mm', fontWeight: 700, fontSize: '5px', textAlign: 'right', border: '0.5px solid #555', whiteSpace: 'nowrap' }}>%기준치</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id} style={{ background: idx % 2 === 0 ? '#f7f7f7' : 'white' }}>
              <td style={{
                padding: '0.5mm 1.2mm',
                paddingLeft: row.isSubItem ? '3mm' : '1.2mm',
                border: '0.5px solid #ccc',
                color: row.isSubItem ? '#444' : '#222',
                fontWeight: row.isSubItem ? 400 : 700,
                fontSize: row.isSubItem ? '5.5px' : '6px',
              }}>
                {row.name}
              </td>
              <td style={{ padding: '0.5mm 1.2mm', border: '0.5px solid #ccc', textAlign: 'right', fontWeight: 700, color: '#222', whiteSpace: 'nowrap', fontSize: '6px' }}>
                {row.amount}{row.unit}
              </td>
              <td style={{ padding: '0.5mm 1.2mm', border: '0.5px solid #ccc', textAlign: 'right', color: '#444', whiteSpace: 'nowrap', fontSize: '6px' }}>
                {row.percent !== '' ? `${row.percent}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 각주 */}
      <div style={{
        padding: '0.7mm 1.5mm',
        fontSize: '4.5px', color: '#666',
        borderTop: '1px solid #ccc',
        lineHeight: 1.35, flexShrink: 0,
      }}>
        %영양성분 기준치는 2,000kcal 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다.
      </div>
    </>
  );
}

const NutritionLabel2x3Preview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="nutrition-label-2x3-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2].map((i) => {
        const rowExtra: React.CSSProperties = i === 2 ? { marginTop: '3mm' } : {};
        return (
          <>
            <div key={`a-${i}`} style={{ ...CELL_STYLE, ...rowExtra }}>
              <NutritionCell {...props} />
            </div>
            <div key={`b-${i}`} style={{ ...CELL_STYLE, ...rowExtra }}>
              <NutritionCell {...props} />
            </div>
          </>
        );
      })}
    </div>
  );
});

NutritionLabel2x3Preview.displayName = 'NutritionLabel2x3Preview';
export default NutritionLabel2x3Preview;
