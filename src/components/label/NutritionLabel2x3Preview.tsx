'use client';

import { forwardRef } from 'react';
import type { NutritionRow } from './nutrition-types';

interface Props {
  // 한글 표시사항
  productName: string;
  itemInfo: string;        // 헤더 부제 (ITEM# 등)
  foodType: string;        // 식품유형
  importer: string;        // 수입/판매업소
  manufacturer: string;    // 제조업소
  originCountry: string;   // 원산지
  contentAmount: string;   // 내용량
  expiryDate: string;      // 소비기한
  storageMethod: string;   // 보관방법
  ingredients: string;     // 원재료명
  returnAddress: string;   // 반품 및 교환 장소
  caution: string;         // 기타 주의사항
  // 영양정보
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
  fontSize: '5px',
};

// 한글 표시사항 테이블 셀 스타일
const TD_LABEL: React.CSSProperties = {
  padding: '0.5mm 1mm',
  border: '0.5px solid #ccc',
  fontWeight: 700,
  background: '#f5f5f5',
  color: '#333',
  verticalAlign: 'top',
  width: '35%',
  fontSize: '5px',
  wordBreak: 'keep-all' as const,
};

const TD_VALUE: React.CSSProperties = {
  padding: '0.5mm 1mm',
  border: '0.5px solid #ccc',
  color: '#111',
  verticalAlign: 'top',
  fontSize: '5px',
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
      {/* 상단 헤더: 검정 배경, 제품명 + itemInfo */}
      <div style={{
        background: '#111', color: 'white',
        textAlign: 'center', padding: '1mm 2mm',
        fontSize: '7px', fontWeight: 700,
        letterSpacing: '-0.02em', lineHeight: 1.3,
        flexShrink: 0,
      }}>
        {productName || '제품명'}
        {itemInfo && (
          <div style={{ fontSize: '4.5px', fontWeight: 400, opacity: 0.85, marginTop: '0.3mm' }}>{itemInfo}</div>
        )}
      </div>

      {/* 본문: 좌우 2열 분할 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* 왼쪽 50%: 한글 표시사항 */}
        <div style={{
          width: '50%', flexShrink: 0,
          borderRight: '0.5px solid #ccc',
          padding: '0.5mm 0.5mm',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ fontSize: '5.5px', fontWeight: 700, color: '#111', marginBottom: '0.5mm', letterSpacing: '0.04em', flexShrink: 0 }}>
            한글 표시사항
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '5px', tableLayout: 'fixed' as const }}>
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
                <td style={TD_LABEL}>수입/판매업소</td>
                <td style={TD_VALUE}>{importer || '-'}</td>
              </tr>
              <tr>
                <td style={TD_LABEL}>제조업소</td>
                <td style={TD_VALUE}>{manufacturer || '-'}</td>
              </tr>
              <tr>
                <td style={TD_LABEL}>원산지</td>
                <td style={TD_VALUE}>{originCountry || '-'}</td>
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
                <td style={TD_LABEL}>보관방법</td>
                <td style={TD_VALUE}>{storageMethod || '-'}</td>
              </tr>
              <tr>
                <td style={{ ...TD_LABEL, verticalAlign: 'top' }}>원재료명</td>
                <td style={{ ...TD_VALUE }}>{ingredients || '-'}</td>
              </tr>
              <tr>
                <td style={TD_LABEL}>반품 및 교환 장소</td>
                <td style={TD_VALUE}>{returnAddress || '-'}</td>
              </tr>
              <tr>
                <td style={TD_LABEL}>기타 주의사항</td>
                <td style={TD_VALUE}>{caution || '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 오른쪽 50%: 영양정보 */}
        <div style={{
          width: '50%', flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* 영양정보 타이틀 */}
          <div style={{
            background: '#111', color: 'white',
            textAlign: 'center', padding: '0.8mm 1mm',
            fontSize: '6px', fontWeight: 900,
            letterSpacing: '0.1em', flexShrink: 0,
          }}>
            영 양 정 보
          </div>

          {/* 1회 제공량 + kcal */}
          <div style={{
            padding: '0.5mm 1mm',
            borderBottom: '1.5px solid #111',
            fontSize: '5px', color: '#222',
            lineHeight: 1.4, flexShrink: 0,
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          }}>
            <span>{servingSize || '1회 제공량'}당</span>
            <span>
              <span style={{ fontSize: '8px', fontWeight: 900, color: '#111' }}>{calories || '0'}</span>
              <span style={{ fontSize: '4.5px', fontWeight: 600 }}> kcal</span>
            </span>
          </div>

          {/* 영양소 테이블 */}
          <table style={{
            flex: 1,
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '5px',
            tableLayout: 'fixed' as const,
          }}>
            <thead>
              <tr style={{ background: '#111', color: 'white' }}>
                <th style={{ padding: '0.5mm 0.8mm', fontWeight: 700, fontSize: '4.5px', textAlign: 'left', border: '0.5px solid #555', width: '42%' }}>영양성분</th>
                <th style={{ padding: '0.5mm 0.8mm', fontWeight: 700, fontSize: '4.5px', textAlign: 'right', border: '0.5px solid #555' }}>1회제공량당</th>
                <th style={{ padding: '0.5mm 0.8mm', fontWeight: 700, fontSize: '4.5px', textAlign: 'right', border: '0.5px solid #555', whiteSpace: 'nowrap' }}>%기준치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} style={{ background: idx % 2 === 0 ? '#f7f7f7' : 'white' }}>
                  <td style={{
                    padding: '0.4mm 0.8mm',
                    paddingLeft: row.isSubItem ? '2.5mm' : '0.8mm',
                    border: '0.5px solid #ccc',
                    color: row.isSubItem ? '#444' : '#222',
                    fontWeight: row.isSubItem ? 400 : 700,
                    fontSize: row.isSubItem ? '4.5px' : '5px',
                  }}>
                    {row.name}
                  </td>
                  <td style={{ padding: '0.4mm 0.8mm', border: '0.5px solid #ccc', textAlign: 'right', fontWeight: 700, color: '#222', whiteSpace: 'nowrap', fontSize: '5px' }}>
                    {row.amount}{row.unit}
                  </td>
                  <td style={{ padding: '0.4mm 0.8mm', border: '0.5px solid #ccc', textAlign: 'right', color: '#444', whiteSpace: 'nowrap', fontSize: '5px' }}>
                    {row.percent !== '' ? `${row.percent}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 각주 */}
          <div style={{
            padding: '0.5mm 0.8mm',
            fontSize: '4px', color: '#666',
            borderTop: '0.5px solid #ccc',
            lineHeight: 1.3, flexShrink: 0,
          }}>
            %영양성분 기준치는 2,000kcal 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다.
          </div>
        </div>
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
