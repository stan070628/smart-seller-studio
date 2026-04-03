/**
 * FloralBackground.tsx
 * 파스텔 수채화 꽃 배경 공통 컴포넌트 (Notice 시리즈 템플릿 공유)
 */
import React from 'react';

/* ── 체리블라썸 SVG ── */
export const Blossom: React.FC<{ size?: number; color?: string; rotate?: number }> = ({
  size = 36, color = '#f9a8c9', rotate = 0,
}) => (
  <svg
    width={size} height={size} viewBox="0 0 36 36" fill="none"
    style={{ transform: `rotate(${rotate}deg)`, display: 'block' }}
  >
    {[0, 72, 144, 216, 288].map((deg, i) => (
      <ellipse
        key={i}
        cx="18" cy="18" rx="5.5" ry="10"
        fill={color}
        opacity="0.85"
        transform={`rotate(${deg} 18 18) translate(0 -8)`}
      />
    ))}
    <circle cx="18" cy="18" r="4.5" fill="#fff9c4" opacity="0.95" />
  </svg>
);

/* ── 골드 나뭇가지 SVG ── */
export const GoldBranch: React.FC<{ flip?: boolean }> = ({ flip = false }) => (
  <svg
    width="160" height="120" viewBox="0 0 160 120" fill="none"
    style={{ transform: flip ? 'scaleX(-1)' : undefined, display: 'block' }}
  >
    <path d="M10 110 Q50 60 120 20" stroke="#c9a84c" strokeWidth="1.5" fill="none" opacity="0.6" />
    <path d="M40 85 Q60 50 90 40" stroke="#c9a84c" strokeWidth="1" fill="none" opacity="0.5" />
    <path d="M70 65 Q80 40 110 30" stroke="#c9a84c" strokeWidth="1" fill="none" opacity="0.4" />
    {[[55, 50], [90, 35], [115, 22], [38, 82], [75, 62]].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="3.5" fill="#f9a8c9" opacity="0.7" />
    ))}
    {[[55, 50], [90, 35], [115, 22]].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="1.5" fill="#fff" opacity="0.9" />
    ))}
  </svg>
);

/* ── 전체 배경 레이어 (absolute, zIndex=0) ── */
export const FloralBg: React.FC = () => (
  <>
    {/* 수채화 블롭 */}
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-100px', left: '-100px', width: '360px', height: '360px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,180,195,0.55) 0%, transparent 68%)' }} />
      <div style={{ position: 'absolute', bottom: '-80px', left: '-80px', width: '300px', height: '300px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(150,220,180,0.4) 0%, transparent 68%)' }} />
      <div style={{ position: 'absolute', top: '-60px', right: '-100px', width: '340px', height: '340px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(195,170,235,0.4) 0%, transparent 68%)' }} />
      <div style={{ position: 'absolute', bottom: '-80px', right: '-80px', width: '300px', height: '300px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(160,210,235,0.45) 0%, transparent 68%)' }} />
      <div style={{ position: 'absolute', top: '38%', left: '-50px', width: '200px', height: '200px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,220,170,0.35) 0%, transparent 68%)' }} />
      <div style={{ position: 'absolute', top: '42%', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,180,195,0.3) 0%, transparent 68%)' }} />
    </div>

    {/* 나뭇가지 */}
    <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }}><GoldBranch /></div>
    <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}><GoldBranch flip /></div>

    {/* 꽃 클러스터 - 좌상단 */}
    <div style={{ position: 'absolute', top: '60px', left: '20px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Blossom size={28} color="#f9a8c9" rotate={15} />
        <Blossom size={22} color="#fbc4d4" rotate={-10} />
      </div>
      <div style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
        <Blossom size={18} color="#f0c0d0" rotate={30} />
        <Blossom size={24} color="#f9a8c9" rotate={5} />
      </div>
    </div>

    {/* 꽃 클러스터 - 우상단 */}
    <div style={{ position: 'absolute', top: '60px', right: '20px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Blossom size={22} color="#fbc4d4" rotate={10} />
        <Blossom size={28} color="#f9a8c9" rotate={-20} />
      </div>
      <div style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
        <Blossom size={24} color="#f9a8c9" rotate={-5} />
        <Blossom size={18} color="#d4c5f5" rotate={20} />
      </div>
    </div>

    {/* 꽃 - 좌하단 */}
    <div style={{ position: 'absolute', bottom: '80px', left: '18px', zIndex: 2, display: 'flex', gap: '5px' }}>
      <Blossom size={22} color="#a8d8a8" rotate={-15} />
      <Blossom size={26} color="#f9a8c9" rotate={10} />
    </div>

    {/* 꽃 - 우하단 */}
    <div style={{ position: 'absolute', bottom: '80px', right: '18px', zIndex: 2, display: 'flex', gap: '5px' }}>
      <Blossom size={26} color="#f9a8c9" rotate={-10} />
      <Blossom size={22} color="#b8d8f8" rotate={15} />
    </div>

    {/* 중간 좌우 포인트 */}
    <div style={{ position: 'absolute', top: '48%', left: '8px', zIndex: 2 }}>
      <Blossom size={20} color="#fbc4d4" rotate={0} />
    </div>
    <div style={{ position: 'absolute', top: '48%', right: '8px', zIndex: 2 }}>
      <Blossom size={20} color="#d4c5f5" rotate={0} />
    </div>

    {/* 선물상자 */}
    <div style={{ position: 'absolute', top: '42%', right: '38px', zIndex: 3, fontSize: '30px', opacity: 0.8, transform: 'rotate(8deg)' }}>
      🎁
    </div>
  </>
);
