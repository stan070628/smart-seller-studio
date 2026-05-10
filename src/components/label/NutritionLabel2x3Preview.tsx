'use client';

import { forwardRef, useState, useEffect, useRef } from 'react';
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
  highlights?: string;
  footerText?: string;
}

const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 92;
/* 한글 표시사항 2/3, 영양정보 1/3 — 합산이 CELL_HEIGHT_MM이 되도록 고정 */
const KOREAN_HEIGHT_MM = 59;
const NUTRITION_HEIGHT_MM = CELL_HEIGHT_MM - KOREAN_HEIGHT_MM; // 33mm

const DEFAULT_FOOTER = '1일 영양성분 기준치에 대한 비율(%)은 2,000kcal 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다.';

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
  background: 'white',
};

const TH: React.CSSProperties = {
  padding: '0.35mm 0.8mm',
  border: '0.4px solid #bbb',
  fontWeight: 700,
  background: '#efefef',
  color: '#222',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap' as const,
  fontSize: '7px',
  textAlign: 'left' as const,
  width: '28%',
};
const TD: React.CSSProperties = {
  padding: '0.35mm 0.8mm',
  border: '0.4px solid #bbb',
  color: '#111',
  verticalAlign: 'middle',
  fontSize: '7px',
  lineHeight: 1.2,
  wordBreak: 'break-all' as const,
  whiteSpace: 'pre-wrap' as const,
};

/* 영양소를 3개씩 묶어 한 행에 배치 */
function chunkRows(rows: NutritionRow[]): NutritionRow[][] {
  const result: NutritionRow[][] = [];
  for (let i = 0; i < rows.length; i += 3) {
    result.push(rows.slice(i, i + 3));
  }
  return result;
}

function renderHighlighted(text: string, keywords: string[]): React.ReactNode {
  if (!text) return '-';
  if (keywords.length === 0) return text;
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        keywords.some(k => k.toLowerCase() === part.toLowerCase()) ? (
          <span key={i} style={{ background: '#ffeb3b', fontWeight: 700, padding: '0 0.2mm' }}>{part}</span>
        ) : part
      )}
    </>
  );
}

/* 셀 전체 높이 초과 시 CSS scale로 자동 축소 (안전망) */
function AutoScaleCell({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const compute = () => {
      const outerH = outer.clientHeight;
      const innerH = inner.scrollHeight;
      setScale(innerH > outerH && outerH > 0 ? Math.max(0.65, outerH / innerH) : 1);
    };
    const timer = setTimeout(compute, 10);
    const mo = new MutationObserver(compute);
    mo.observe(inner, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); mo.disconnect(); };
  }, []);

  return (
    <div ref={outerRef} style={{ ...style, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
          width: scale < 1 ? `${(1 / scale) * 100}%` : '100%',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function NutritionCell({
  productName, foodType, importer, manufacturer,
  originCountry, contentAmount, expiryDate, storageMethod, ingredients,
  returnAddress, caution,
  servingSize, calories, rows, highlights, footerText,
}: Props) {
  const highlightWords = highlights
    ? highlights.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const footnote = footerText || DEFAULT_FOOTER;
  const chunked = chunkRows(rows);

  return (
    <>
      {/* ── 한글 표시사항: 고정 59mm, 초과 시 clipping ── */}
      <div style={{
        height: `${KOREAN_HEIGHT_MM}mm`,
        overflow: 'hidden',
        borderBottom: '1px solid #111',
        flexShrink: 0,
      }}>
        <div style={{
          background: '#ddd', textAlign: 'center',
          fontSize: '8.5px', fontWeight: 700, color: '#111',
          padding: '0.6mm', letterSpacing: '0.06em',
        }}>
          한 글 표 시 사 항
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
          <tbody>
            <tr><td style={TH}>제품명</td><td style={TD}>{productName || '-'}</td></tr>
            <tr><td style={TH}>식품유형</td><td style={TD}>{foodType || '-'}</td></tr>
            <tr><td style={TH}>수입/판매업소</td><td style={{ ...TD, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{importer || '-'}</td></tr>
            <tr><td style={TH}>제조업소</td><td style={{ ...TD, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{manufacturer || '-'}</td></tr>
            <tr><td style={TH}>원산지</td><td style={TD}>{originCountry || '-'}</td></tr>
            <tr><td style={TH}>내용량</td><td style={TD}>{contentAmount || '-'}</td></tr>
            <tr><td style={TH}>소비기한</td><td style={TD}>{expiryDate || '-'}</td></tr>
            <tr><td style={TH}>보관방법</td><td style={TD}>{storageMethod || '-'}</td></tr>
            <tr><td style={TH}>원재료명</td><td style={TD}>{renderHighlighted(ingredients, highlightWords)}</td></tr>
            <tr><td style={TH}>반품·교환장소</td><td style={TD}>{returnAddress || '-'}</td></tr>
            <tr><td style={TH}>기타 주의사항</td><td style={TD}>{caution || '-'}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── 영양정보: 고정 33mm ── */}
      <div style={{
        height: `${NUTRITION_HEIGHT_MM}mm`,
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {/* 제목 */}
        <div style={{
          background: '#111', color: '#fff',
          textAlign: 'center', padding: '0.4mm 1mm',
          fontSize: '7.5px', fontWeight: 900, letterSpacing: '0.15em',
        }}>
          영 양 정 보
        </div>

        {/* 1회 제공량 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.35mm 1.5mm', borderBottom: '1.2px solid #111',
          fontSize: '6px', color: '#111', fontWeight: 600,
        }}>
          <span>{servingSize || '1회 제공량'}당</span>
          <span>
            <span style={{ fontSize: '10px', fontWeight: 900 }}>{calories || '0'}</span>
            <span style={{ fontSize: '5px', fontWeight: 600, marginLeft: '0.4mm' }}>kcal</span>
          </span>
        </div>

        {/* 영양소 3열 그리드 — 헤더 없음 */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
          <tbody>
            {chunked.map((group, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? '#f7f7f7' : '#fff' }}>
                {group.map((row) => (
                  <td key={row.id} style={{
                    border: '0.4px solid #ccc',
                    padding: '0.4mm 0.8mm',
                    verticalAlign: 'middle',
                    width: '33.33%',
                    background: row.isSubItem
                      ? (idx % 2 === 0 ? '#e8e8e8' : '#f0f0f0')
                      : (row.isHighlight ? '#fff3cd' : undefined),
                  }}>
                    <div style={{ fontSize: '6.5px', fontWeight: 700, color: '#111', marginBottom: '0.1mm' }}>
                      {row.name}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6px', color: '#444' }}>
                      <span>{row.amount}{row.unit}</span>
                      <span style={{ fontWeight: 600, color: '#333' }}>
                        {row.percent !== '' ? `${row.percent}%` : '—'}
                      </span>
                    </div>
                  </td>
                ))}
                {/* 빈 셀로 3열 맞춤 */}
                {Array.from({ length: 3 - group.length }, (_, i) => (
                  <td key={`empty-${i}`} style={{ border: '0.4px solid #ccc', width: '33.33%' }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 각주 */}
        <div style={{
          padding: '0.4mm 0.8mm',
          fontSize: '5px', color: '#444',
          borderTop: '0.4px solid #ccc',
          lineHeight: 1.3,
        }}>
          {footnote}
        </div>
      </div>
    </>
  );
}

const NutritionLabel2x3Preview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="nutrition-label-2x3-preview" ref={ref} style={GRID_STYLE}>
      {Array.from({ length: 6 }, (_, i) => (
        <AutoScaleCell
          key={i}
          style={i % 2 === 1 ? { ...CELL_STYLE, transform: 'translateX(2mm)' } : CELL_STYLE}
        >
          <NutritionCell {...props} />
        </AutoScaleCell>
      ))}
    </div>
  );
});

NutritionLabel2x3Preview.displayName = 'NutritionLabel2x3Preview';
export default NutritionLabel2x3Preview;
