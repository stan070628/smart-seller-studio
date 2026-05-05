'use client';

import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  fields: QualityFields;
}

export default function LabelTextCell({ fields }: Props) {
  const rows: { label: string; value: string }[] = [
    { label: '품  명', value: fields.productName },
    { label: '소  재', value: fields.material },
    { label: '크  기', value: fields.size },
    { label: '제조국', value: fields.country },
    { label: '수입원', value: fields.importer },
    { label: '주  소', value: fields.address },
    { label: '전  화', value: fields.phone },
    ...(fields.extra ? [{ label: '기  타', value: fields.extra }] : []),
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        color: '#000',
      }}
    >
      <table
        style={{
          width: '100%',
          height: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          color: '#000',
          tableLayout: 'fixed',
        }}
      >
        <thead>
          <tr style={{ height: 1 }}>
            <th
              colSpan={2}
              style={{
                border: '1px solid #000',
                padding: '3px 4px',
                textAlign: 'center',
                verticalAlign: 'middle',
                fontWeight: 700,
                fontSize: 13,
                backgroundColor: '#e8e8e8',
                color: '#000',
                letterSpacing: '0.05em',
              }}
            >
              제품 품질 표시
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} style={{ height: 1 }}>
              <td
                style={{
                  border: '1px solid #000',
                  padding: '2px 4px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  width: '34%',
                  textAlign: 'center',
                  backgroundColor: '#f5f5f5',
                  verticalAlign: 'middle',
                  color: '#000',
                }}
              >
                {row.label}
              </td>
              <td
                style={{
                  border: '1px solid #000',
                  padding: '2px 4px',
                  wordBreak: 'break-all',
                  verticalAlign: 'middle',
                  textAlign: 'center',
                  color: '#000',
                }}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
