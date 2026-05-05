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
const CELL_HEIGHT_MM = 93;
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
  height: '297mm',      // minHeight 대신 고정 → 정확히 A4 한 장
  boxSizing: 'border-box', // 패딩 포함 계산: 컨텐츠 = 297-14=283mm (그리드 필요량 281.6mm ✓)
  overflow: 'hidden',
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
      {[0, 1, 2].map((i) => (
        <>
          <div key={`img-${i}`} style={CELL_STYLE}>
            <LabelImageCell imageUrl={imageUrl} />
          </div>
          <div key={`text-${i}`} style={CELL_STYLE}>
            <LabelTextCell fields={fields} />
          </div>
        </>
      ))}
    </div>
  );
});

LabelPreview.displayName = 'LabelPreview';
export default LabelPreview;
