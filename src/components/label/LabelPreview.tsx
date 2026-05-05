'use client';

import { forwardRef } from 'react';
import LabelImageCell from './LabelImageCell';
import LabelTextCell from './LabelTextCell';
import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  imageUrl: string;
  fields: QualityFields;
}

const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 92;   // 93mm 규격에서 1mm 여유 → 총 높이 292.6mm < 297mm (1페이지 보장)
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
  boxSizing: 'border-box',
  background: '#fff',
};

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_WIDTH_MM}mm`,
  height: `${CELL_HEIGHT_MM}mm`,
  overflow: 'hidden',
  boxSizing: 'border-box',
  border: '0.2px solid #ccc',
};

const LabelPreview = forwardRef<HTMLDivElement, Props>(({ imageUrl, fields }, ref) => {
  return (
    <div id="label-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2].map((i) => {
        // 실물 라벨지: 3번째 행이 위 행보다 3mm 아래에 위치
        const rowExtra: React.CSSProperties = i === 2 ? { marginTop: '3mm' } : {};
        return (
          <>
            <div key={`img-${i}`} style={{ ...CELL_STYLE, ...rowExtra }}>
              <LabelImageCell imageUrl={imageUrl} />
            </div>
            <div key={`text-${i}`} style={{ ...CELL_STYLE, ...rowExtra }}>
              <LabelTextCell fields={fields} />
            </div>
          </>
        );
      })}
    </div>
  );
});

LabelPreview.displayName = 'LabelPreview';
export default LabelPreview;
