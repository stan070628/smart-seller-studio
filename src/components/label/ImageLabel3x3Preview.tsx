'use client';

import { forwardRef } from 'react';

interface Props {
  imageUrl: string;
  imagePosition?: { x: number; y: number };
  imageZoom?: number;
}

const CELL_W_MM = 98;
const CELL_H_MM = 93;
const GAP_MM = 3;
const PAD_TOP_MM = 8;
const PAD_BOTTOM_MM = 10;
const PAD_LR_MM = 5;

const PAGE_STYLE: React.CSSProperties = {
  width: '210mm',
  height: '297mm',
  boxSizing: 'border-box',
  background: '#fff',
  paddingTop: `${PAD_TOP_MM}mm`,
  paddingBottom: `${PAD_BOTTOM_MM}mm`,
  paddingLeft: `${PAD_LR_MM}mm`,
  paddingRight: `${PAD_LR_MM}mm`,
  overflow: 'hidden',
};

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(3, ${CELL_W_MM}mm)`,
  gridTemplateRows: `repeat(3, ${CELL_H_MM}mm)`,
  columnGap: `${GAP_MM}mm`,
  rowGap: `${GAP_MM}mm`,
};

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_W_MM}mm`,
  height: `${CELL_H_MM}mm`,
  overflow: 'hidden',
  position: 'relative',
  boxSizing: 'border-box',
  background: '#fafafa',
};

function ImageCell({ imageUrl, imagePosition, imageZoom }: Props) {
  const x = imagePosition?.x ?? 50;
  const y = imagePosition?.y ?? 50;
  const zoom = imageZoom ?? 1.0;

  return imageUrl ? (
    <img
      src={imageUrl}
      alt="제품 이미지"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        objectPosition: `${x}% ${y}%`,
        transform: `scale(${zoom})`,
        transformOrigin: `${x}% ${y}%`,
        display: 'block',
      }}
    />
  ) : (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 6, color: '#aaa', fontSize: 10,
    }}>
      <span style={{ fontSize: 36, opacity: 0.4 }}>🖼️</span>
      제품 이미지를<br />여기에 삽입
    </div>
  );
}

const ImageLabel3x3Preview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="image-label-3x3-preview" ref={ref} style={PAGE_STYLE}>
      <div style={GRID_STYLE}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={CELL_STYLE}>
            <ImageCell {...props} />
          </div>
        ))}
      </div>
    </div>
  );
});

ImageLabel3x3Preview.displayName = 'ImageLabel3x3Preview';
export default ImageLabel3x3Preview;
