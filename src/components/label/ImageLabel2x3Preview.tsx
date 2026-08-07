'use client';

import { forwardRef } from 'react';

interface Props {
  imageUrl: string;
  imagePosition?: { x: number; y: number };
  imageZoom?: number;
}

const CELL_WIDTH_MM = 105;
const CELL_HEIGHT_MM = 97;

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(2, ${CELL_WIDTH_MM}mm)`,
  gridTemplateRows: `repeat(3, ${CELL_HEIGHT_MM}mm)`,
  columnGap: 0,
  rowGap: 0,
  padding: '3mm 0',
  width: '210mm',
  height: '297mm',
  overflow: 'visible',
  boxSizing: 'border-box' as const,
  background: '#fff',
};

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_WIDTH_MM}mm`,
  height: `${CELL_HEIGHT_MM}mm`,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
  boxSizing: 'border-box' as const,
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

const ImageLabel2x3Preview = forwardRef<HTMLDivElement, Props>((props, ref) => {
  return (
    <div id="image-label-2x3-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={CELL_STYLE}>
          <ImageCell {...props} />
        </div>
      ))}
    </div>
  );
});

ImageLabel2x3Preview.displayName = 'ImageLabel2x3Preview';
export default ImageLabel2x3Preview;
