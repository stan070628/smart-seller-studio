'use client';

import { forwardRef } from 'react';
import type { NutritionRow } from './nutrition-types';

interface Props {
  productName: string;
  itemInfo: string;
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
  borderRadius: '1.5mm',
  display: 'flex',
  flexDirection: 'column',
  background: 'white',
  fontSize: '6.5px',
};

function NutritionCell({ productName, itemInfo, servingSize, calories, rows }: Props) {
  return (
    <>
      {/* 제품명 헤더 */}
      <div style={{
        background: '#111', color: 'white',
        textAlign: 'center', padding: '1.5mm 2mm',
        fontSize: '7.5px', fontWeight: 700,
        letterSpacing: '-0.02em', lineHeight: 1.3,
        flexShrink: 0,
      }}>
        {productName || '제품명'}
        {itemInfo && (
          <div style={{ fontSize: '6px', fontWeight: 400, opacity: 0.8 }}>{itemInfo}</div>
        )}
      </div>

      {/* 영양정보 섹션 타이틀 */}
      <div style={{
        background: '#333', color: 'white',
        textAlign: 'center', padding: '1mm 2mm',
        fontSize: '7px', fontWeight: 700,
        letterSpacing: '0.05em', flexShrink: 0,
      }}>
        영 양 정 보
      </div>

      {/* 1회 제공량 */}
      <div style={{
        padding: '1.5mm 2mm 1mm',
        borderBottom: '2px solid #111',
        fontSize: '6px', color: '#333',
        lineHeight: 1.5, flexShrink: 0,
      }}>
        {servingSize || '1회 제공량'}당&nbsp;&nbsp;
        <span style={{ fontSize: '9px', fontWeight: 900, color: '#111' }}>
          {calories || '0'} kcal
        </span>
      </div>

      {/* 영양소 목록 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-evenly',
        minHeight: 0,
      }}>
        {rows.map((row) => (
          <div
            key={row.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingLeft: row.isSubItem ? '4mm' : '2mm',
              paddingRight: '2mm',
              borderBottom: '0.5px solid #e8e8e8',
              flex: 1,
              minHeight: 0,
              background: row.isHighlight ? '#f5f5f5' : 'transparent',
            }}
          >
            <span style={{
              color: row.isSubItem ? '#555' : '#222',
              fontWeight: row.isSubItem ? 400 : 600,
              fontSize: row.isSubItem ? '6px' : undefined,
            }}>
              {row.name}
            </span>
            <span style={{ textAlign: 'right', color: '#222' }}>
              <span style={{ fontWeight: 700 }}>{row.amount}{row.unit}</span>
              <span style={{ color: '#555', marginLeft: '2mm' }}>{row.percent !== '' ? `${row.percent}%` : '—'}</span>
            </span>
          </div>
        ))}
      </div>

      {/* 각주 */}
      <div style={{
        padding: '1mm 2mm',
        fontSize: '5px', color: '#777',
        borderTop: '1px solid #ddd',
        lineHeight: 1.4, flexShrink: 0,
      }}>
        %는 1일 영양성분 기준치(2,000kcal) 대비 비율. 개인 필요 열량에 따라 다를 수 있습니다.
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
