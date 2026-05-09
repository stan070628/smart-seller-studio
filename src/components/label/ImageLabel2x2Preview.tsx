'use client';

import { forwardRef } from 'react';

interface Props {
  imageUrl: string;
  footerText: string;
}

const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 135;
const GAP_H_MM = 0.9;
const GAP_V_MM = 4;

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${CELL_WIDTH_MM}mm ${CELL_WIDTH_MM}mm`,
  gridTemplateRows: `repeat(2, ${CELL_HEIGHT_MM}mm)`,
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
  border: '1.5px solid #333',
  borderRadius: '2mm',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '3mm',
  background: 'white',
};

function ImageCell({ imageUrl, footerText }: Props) {
  return (
    <>
      <div style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        border: '1.5px dashed #bbb',
        borderRadius: '1mm',
        overflow: 'hidden',
      }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="제품 이미지"
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div style={{ textAlign: 'center', color: '#aaa', fontSize: 10, padding: 8 }}>
            <span style={{ fontSize: 36, display: 'block', marginBottom: 6, opacity: 0.4 }}>🖼️</span>
            제품 이미지를<br />여기에 삽입
          </div>
        )}
      </div>
      <div style={{
        width: '100%',
        paddingTop: '2mm',
        textAlign: 'center',
        fontSize: 8,
        color: '#555',
        borderTop: '0.5px solid #eee',
        marginTop: '2mm',
      }}>
        {footerText || '제품명 / 바코드'}
      </div>
    </>
  );
}

const ImageLabel2x2Preview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="image-label-2x2-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={CELL_STYLE}>
          <ImageCell {...props} />
        </div>
      ))}
    </div>
  );
});

ImageLabel2x2Preview.displayName = 'ImageLabel2x2Preview';
export default ImageLabel2x2Preview;
