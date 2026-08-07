'use client';

import { forwardRef } from 'react';
import type { CosmeticFields } from '@/lib/label/cosmetic-fields';

interface Props {
  fields: CosmeticFields;
}

const CELL_W = 99.1;
const CELL_H = 92;

const FLORAL = {
  header: '#2a3a22',
  sub: '#7a9a6a',
  accent: '#7a9a6a',
  bars: ['#a8d4a0', '#c8a8d4', '#f0d898', '#f4b4a0'],
};
const CREAMY = {
  header: '#3e2e12',
  sub: '#c8a878',
  accent: '#c8a878',
  bars: ['#ede8d8', '#f8c898', '#d4c4a8', '#f8d870'],
};
// 비누 컬렉션이 아닌 임의 화장품용 중립 테마
const CUSTOM = {
  header: '#2f2f33',
  sub: '#8a8a92',
  accent: '#8a8a92',
  bars: ['#d8d8de', '#c8c8d0', '#e0e0e6', '#cfcfd6'],
};

const THEMES = { floral: FLORAL, creamy: CREAMY, custom: CUSTOM } as const;

function LabelCell({ fields }: { fields: CosmeticFields }) {
  const theme = THEMES[fields.collection] ?? FLORAL;
  const items = fields.items;
  const cols = Math.max(items.length, 1);

  const s: Record<string, React.CSSProperties> = {
    cell: {
      width: `${CELL_W}mm`,
      height: `${CELL_H}mm`,
      display: 'flex',
      flexDirection: 'column',
      border: '0.4pt solid #b0a88a',
      overflow: 'hidden',
      boxSizing: 'border-box',
      background: '#fff',
    },
    header: {
      background: theme.header,
      color: '#fff',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.8mm 2mm',
      flexShrink: 0,
    },
    subhd: {
      background: theme.sub,
      color: '#fff',
      padding: '0.4mm 2mm',
      fontSize: '5pt',
      fontWeight: 700,
      letterSpacing: '0.6pt',
      textTransform: 'uppercase' as const,
      flexShrink: 0,
    },
    cols: {
      display: 'grid',
      // 품목 수에 따라 열이 바뀐다. 1종이면 전성분이 셀 폭 전체를 쓴다.
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: '1mm auto auto auto 1fr',
      flex: 1,
      overflow: 'hidden',
    },
    fv: { fontSize: '4.8pt', color: '#444', lineHeight: 1.5 },
    sharedRow: {
      borderTop: '0.3pt solid #e0dbd0',
      padding: '1mm 2mm',
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1.6fr 1fr',
      gap: '2mm',
      flexShrink: 0,
      background: '#faf9f6',
    },
    cautionRow: {
      borderTop: '0.3pt solid #e0dbd0',
      padding: '0.8mm 2mm',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2mm',
      flexShrink: 0,
    },
    cl: { fontSize: '4pt', fontWeight: 700, color: theme.accent, marginBottom: '0.3mm' },
    cv: { fontSize: '3.8pt', color: '#555', lineHeight: 1.5 },
    ft: {
      borderTop: '0.3pt solid #e0dbd0',
      background: '#f7f5f1',
      padding: '0.8mm 2mm',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: 0,
    },
  };

  const divider = (i: number) =>
    i < items.length - 1 ? '0.3pt solid #ddd9d0' : undefined;

  const expiry = fields.expiryDate || '—';
  const expiryText = fields.expiryNote ? `${expiry} ${fields.expiryNote}` : expiry;

  return (
    <div style={s.cell}>
      {/* 헤더 */}
      <div style={s.header}>
        <span style={{ fontSize: '5pt', letterSpacing: '0.6pt', fontWeight: 300 }}>
          {fields.brandHeader}
        </span>
        <span style={{ fontSize: '5pt', color: theme.bars[0], fontWeight: 700 }}>
          {fields.optionLabel}
        </span>
      </div>
      <div style={s.subhd}>{fields.collectionLabel}</div>

      {/* 품목 칸 — 행 단위 그리드: 각 행이 모든 열에서 동일 높이 공유 */}
      <div style={s.cols}>
        {/* 행1: 색상 바 */}
        {items.map((_, i) => (
          <div key={`bar-${i}`} style={{
            background: theme.bars[i % theme.bars.length],
            borderRight: divider(i),
          }} />
        ))}
        {/* 행2: 영문명 */}
        {items.map((item, i) => (
          <div key={`en-${i}`} style={{
            padding: '1mm 1mm 0',
            borderRight: divider(i),
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: '4.8pt', color: '#bbb', lineHeight: 1.3 }}>{item.en}</div>
          </div>
        ))}
        {/* 행3: 한국명 */}
        {items.map((item, i) => (
          <div key={`ko-${i}`} style={{
            padding: '0.3mm 1mm 0.5mm',
            borderRight: divider(i),
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: '6pt', fontWeight: 700, color: '#2a3a22', lineHeight: 1.2 }}>{item.ko}</div>
          </div>
        ))}
        {/* 행4: 전성분 라벨 */}
        {items.map((_, i) => (
          <div key={`fl-${i}`} style={{
            padding: '0.5mm 1mm 0.2mm',
            borderRight: divider(i),
          }}>
            <div style={{
              fontSize: '5pt', fontWeight: 700, color: theme.accent,
              borderBottom: '0.2pt solid #e5e1d8', paddingBottom: '0.2mm',
            }}>전성분</div>
          </div>
        ))}
        {/* 행5: 전성분 값 (남은 공간 모두) */}
        {items.map((item, i) => (
          <div key={`fv-${i}`} style={{
            padding: '0 1mm 1mm',
            overflow: 'hidden',
            borderRight: divider(i),
          }}>
            <div style={s.fv}>{item.ingredients}</div>
          </div>
        ))}
      </div>

      {/* 공통 정보 (내용량·제조번호·사용기한·제조국) */}
      <div style={s.sharedRow}>
        {[
          { label: '내용량', value: fields.weight },
          { label: '제조번호', value: fields.lotNumber || '—' },
          { label: '사용기한', value: expiryText },
          { label: '제조국', value: fields.countryOfOrigin },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={s.cl}>{label}</div>
            <div style={s.cv}>{value}</div>
          </div>
        ))}
      </div>

      {/* 주의사항 */}
      <div style={s.cautionRow}>
        <div>
          <div style={s.cl}>사용방법</div>
          <div style={s.cv}>{fields.usage}</div>
        </div>
        <div>
          <div style={s.cl}>사용 시 주의사항</div>
          <div style={s.cv}>{fields.caution}</div>
        </div>
      </div>

      {/* 푸터 */}
      <div style={s.ft}>
        <div style={{ fontSize: '3.8pt', color: '#888', lineHeight: 1.55 }}>
          <strong>책임판매업자:</strong> {fields.importer || '—'}{fields.importerAddress ? ` · ${fields.importerAddress}` : ''} · ☎ {fields.phone || '—'}<br />
          제조원: {fields.manufacturer}
        </div>
        <div style={{ fontSize: '3.8pt', fontWeight: 700, color: '#555', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {fields.recycleMark}<br />{fields.footerNote}
        </div>
      </div>
    </div>
  );
}

const CosmeticLabel2x3Preview = forwardRef<HTMLDivElement, Props>(({ fields }, ref) => {
  return (
    <div
      id="cosmetic-label-2x3-preview"
      ref={ref}
      style={{
        display: 'grid',
        gridTemplateColumns: `${CELL_W}mm ${CELL_W}mm`,
        gridTemplateRows: `repeat(3, ${CELL_H}mm)`,
        columnGap: '0.9mm',
        rowGap: '1.3mm',
        padding: '7mm 5mm',
        width: '210mm',
        boxSizing: 'border-box',
        background: '#fff',
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <LabelCell key={i} fields={fields} />
      ))}
    </div>
  );
});

CosmeticLabel2x3Preview.displayName = 'CosmeticLabel2x3Preview';
export default CosmeticLabel2x3Preview;
