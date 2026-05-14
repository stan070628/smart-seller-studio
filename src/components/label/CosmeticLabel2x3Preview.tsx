'use client';

import { forwardRef } from 'react';
import type { CosmeticFields } from '@/lib/label/label-templates';

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

function LabelCell({ fields }: { fields: CosmeticFields }) {
  const theme = fields.collection === 'floral' ? FLORAL : CREAMY;
  const collectionLabel =
    fields.collection === 'floral'
      ? '플로럴 컬렉션 Variety Pack 4종'
      : '크리미 컬렉션 Variety Pack 4종';
  const optionLabel =
    fields.collection === 'floral' ? 'Option 01 · Floral' : 'Option 02 · Creamy';

  const soaps = [
    { en: fields.soap1En, ko: fields.soap1Ko, ing: fields.soap1Ingredients },
    { en: fields.soap2En, ko: fields.soap2Ko, ing: fields.soap2Ingredients },
    { en: fields.soap3En, ko: fields.soap3Ko, ing: fields.soap3Ingredients },
    { en: fields.soap4En, ko: fields.soap4Ko, ing: fields.soap4Ingredients },
  ];

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
      gridTemplateColumns: 'repeat(4, 1fr)',
      gridTemplateRows: '1mm auto auto auto 1fr',
      flex: 1,
      overflow: 'hidden',
    },
    fl: {
      fontSize: '5pt',
      fontWeight: 700,
      color: theme.accent,
      borderBottom: '0.2pt solid #e5e1d8',
      paddingBottom: '0.3mm',
      marginTop: '1mm',
      marginBottom: '0.3mm',
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

  return (
    <div style={s.cell}>
      {/* 헤더 */}
      <div style={s.header}>
        <span style={{ fontSize: '5pt', letterSpacing: '0.6pt', fontWeight: 300 }}>
          Australian Botanical
        </span>
        <span style={{ fontSize: '5pt', color: theme.bars[0], fontWeight: 700 }}>
          {optionLabel}
        </span>
      </div>
      <div style={s.subhd}>{collectionLabel}</div>

      {/* 4칸 — 행 단위 그리드: 각 행이 4열에서 동일 높이 공유 */}
      <div style={s.cols}>
        {/* 행1: 색상 바 */}
        {soaps.map((_, i) => (
          <div key={`bar-${i}`} style={{
            background: theme.bars[i],
            borderRight: i < 3 ? '0.3pt solid #ddd9d0' : undefined,
          }} />
        ))}
        {/* 행2: 영문명 */}
        {soaps.map((soap, i) => (
          <div key={`en-${i}`} style={{
            padding: '1mm 1mm 0',
            borderRight: i < 3 ? '0.3pt solid #ddd9d0' : undefined,
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: '4.8pt', color: '#bbb', lineHeight: 1.3 }}>{soap.en}</div>
          </div>
        ))}
        {/* 행3: 한국명 */}
        {soaps.map((soap, i) => (
          <div key={`ko-${i}`} style={{
            padding: '0.3mm 1mm 0.5mm',
            borderRight: i < 3 ? '0.3pt solid #ddd9d0' : undefined,
            overflow: 'hidden',
          }}>
            <div style={{ fontSize: '6pt', fontWeight: 700, color: '#2a3a22', lineHeight: 1.2 }}>{soap.ko}</div>
          </div>
        ))}
        {/* 행4: 전성분 라벨 */}
        {soaps.map((_, i) => (
          <div key={`fl-${i}`} style={{
            padding: '0.5mm 1mm 0.2mm',
            borderRight: i < 3 ? '0.3pt solid #ddd9d0' : undefined,
          }}>
            <div style={{
              fontSize: '5pt', fontWeight: 700, color: theme.accent,
              borderBottom: '0.2pt solid #e5e1d8', paddingBottom: '0.2mm',
            }}>전성분</div>
          </div>
        ))}
        {/* 행5: 전성분 값 (남은 공간 모두) */}
        {soaps.map((soap, i) => (
          <div key={`fv-${i}`} style={{
            padding: '0 1mm 1mm',
            overflow: 'hidden',
            borderRight: i < 3 ? '0.3pt solid #ddd9d0' : undefined,
          }}>
            <div style={s.fv}>{soap.ing}</div>
          </div>
        ))}
      </div>

      {/* 공통 정보 (내용량·제조번호·사용기한·제조국) */}
      <div style={s.sharedRow}>
        {[
          { label: '내용량', value: fields.weight },
          { label: '제조번호', value: fields.lotNumber || '—' },
          { label: '사용기한', value: (fields.expiryDate || '—') + ' 또는 개봉 후 24개월' },
          { label: '제조국', value: '호주 (Australia)' },
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
          <div style={s.cv}>
            물에 적셔 거품을 낸 후 세정 부위에 고르게 펴 바르고 깨끗한 물로 헹구어 냅니다. 사용 후 건조한 곳에 보관하세요.
          </div>
        </div>
        <div>
          <div style={s.cl}>사용 시 주의사항</div>
          <div style={s.cv}>
            1. 눈에 들어갔을 때는 즉시 씻어내십시오. 2. 어린이 손이 닿지 않는 곳에 보관하십시오. 3. 직사광선을 피해 보관하십시오. 4. 이상이 나타나면 사용을 중단하고 전문의와 상담하십시오. 5. 상처가 있는 부위에는 사용을 자제하십시오.
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <div style={s.ft}>
        <div style={{ fontSize: '3.8pt', color: '#888', lineHeight: 1.55 }}>
          <strong>책임판매업자:</strong> {fields.importer || '—'}{fields.importerAddress ? ` · ${fields.importerAddress}` : ''} · ☎ {fields.phone || '—'}<br />
          제조원: Australian Botanical Soap · 143 Scanlon Drive, Epping VIC 3076, Australia
        </div>
        <div style={{ fontSize: '3.8pt', fontWeight: 700, color: '#555', textAlign: 'right', whiteSpace: 'nowrap' }}>
          ♻종이/PE<br />Made in Australia
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
