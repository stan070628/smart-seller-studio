'use client';

import { forwardRef } from 'react';
import LabelTextCell from './LabelTextCell';
import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  fields: QualityFields;
}

const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 92;

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
};

const QualityLabel2x3Preview = forwardRef<HTMLDivElement, Props>(({ fields }, ref) => {
  return (
    <div id="quality-label-2x3-preview" ref={ref} style={GRID_STYLE}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={CELL_STYLE}>
          <LabelTextCell fields={fields} />
        </div>
      ))}
    </div>
  );
});

QualityLabel2x3Preview.displayName = 'QualityLabel2x3Preview';
export default QualityLabel2x3Preview;
