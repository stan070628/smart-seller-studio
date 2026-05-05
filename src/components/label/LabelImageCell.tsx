'use client';

interface Props {
  imageUrl: string;
}

export default function LabelImageCell({ imageUrl }: Props) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="상표 이미지"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : (
        <span style={{ color: '#9ca3af', fontSize: 11 }}>이미지 없음</span>
      )}
    </div>
  );
}
