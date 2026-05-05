'use client';

import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  fields: QualityFields;
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  lineHeight: 1.5,
};

const LABEL_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontWeight: 600,
  width: 48,
};

export default function LabelTextCell({ fields }: Props) {
  const rows: { label: string; value: string }[] = [
    { label: '품  명', value: fields.productName },
    { label: '소  재', value: fields.material },
    { label: '크  기', value: fields.size },
    { label: '제조국', value: fields.country },
    { label: '수입원', value: fields.importer },
    { label: '주  소', value: fields.address },
    { label: '전  화', value: fields.phone },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '6px 8px',
        boxSizing: 'border-box',
        fontSize: 8,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={ROW_STYLE}>
          <span style={LABEL_STYLE}>{row.label}:</span>
          <span>{row.value}</span>
        </div>
      ))}
      {fields.extra && (
        <div style={ROW_STYLE}>
          <span style={LABEL_STYLE}>기  타:</span>
          <span>{fields.extra}</span>
        </div>
      )}
    </div>
  );
}
