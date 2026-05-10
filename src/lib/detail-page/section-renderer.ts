// src/lib/detail-page/section-renderer.ts
// 각 SectionType을 받아서 인라인 스타일 HTML 문자열을 반환하는 순수 렌더링 함수
// 쿠팡 상세페이지 제약: 인라인 스타일만 허용

import type { DetailSection, DetailPageTheme, PaletteName } from '@/types/detail-page';
import type { PaletteColors } from '@/lib/detail-page/palette-config';
import { PALETTES } from '@/lib/detail-page/palette-config';

// accent 색상을 배경으로 사용할 때 텍스트 색상 결정 (WCAG AA 기준)
// deep_dark / tech_navy 팔레트의 accent는 밝은 색상이므로 어두운 텍스트 사용
function getAccentTextColor(palette: PaletteName): string {
  // deep_dark accent: #FFC107 (밝은 노랑) → 어두운 텍스트
  // tech_navy accent: #38BDF8 (밝은 파랑) → 어두운 텍스트
  if (palette === 'deep_dark' || palette === 'tech_navy') {
    return '#111111';
  }
  // warm_cream accent: #7A5C10 (어두운 갈색) → 흰색 텍스트
  // cool_white accent: #2563EB (어두운 파랑) → 흰색 텍스트
  // nature_green accent: #2D6A2D (어두운 녹색) → 흰색 텍스트
  return '#FFFFFF';
}

// 첨부 이미지가 있으면 첫 번째 이미지를 반환, 없으면 빈 문자열
function renderAttachedImage(section: DetailSection): string {
  if (section.attachedImages.length === 0) return '';
  const img = section.attachedImages[0];
  return `<img src="${img.url}" alt="" style="width:100%;display:block;max-width:100%;height:auto;" />`;
}

// hero 섹션: fullbleed 레이아웃, headline h2(32px bold) + subheadline p(18px)
function renderHero(section: DetailSection, colors: PaletteColors): string {
  const content = section.content;
  if (content.type !== 'hero') return '';

  const imageHtml = renderAttachedImage(section);

  return `<div data-section-id="${section.id}" style="background-color:${colors.bg};color:${colors.text};padding:60px 40px;text-align:center;width:100%;box-sizing:border-box;">
  ${imageHtml}
  <h2 style="font-size:32px;font-weight:700;color:${colors.text};margin:0 0 16px 0;line-height:1.3;">${content.headline}</h2>
  <p style="font-size:18px;color:${colors.textSub};margin:0;line-height:1.6;">${content.subheadline}</p>
</div>`;
}

// selling_points 섹션: 최대 2컬럼 그리드, icon + title + description, cardBg 배경
function renderSellingPoints(section: DetailSection, colors: PaletteColors): string {
  const content = section.content;
  if (content.type !== 'selling_points') return '';

  const imageHtml = renderAttachedImage(section);

  const pointsHtml = content.points
    .map(
      (point) => `<div style="flex:1;min-width:calc(50% - 12px);background-color:${colors.cardBg};border:1px solid ${colors.border};border-radius:8px;padding:24px;box-sizing:border-box;">
      <div style="font-size:28px;margin-bottom:12px;line-height:1;">${point.icon}</div>
      <div style="font-size:16px;font-weight:700;color:${colors.text};margin-bottom:8px;">${point.title}</div>
      <div style="font-size:14px;color:${colors.textSub};line-height:1.6;">${point.description}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${section.id}" style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;gap:24px;">
    ${pointsHtml}
  </div>
</div>`;
}

// features 섹션: title + description 쌍, bgAlt 배경, 각 아이템 border-bottom
function renderFeatures(section: DetailSection, colors: PaletteColors): string {
  const content = section.content;
  if (content.type !== 'features') return '';

  const imageHtml = renderAttachedImage(section);

  const itemsHtml = content.items
    .map(
      (item, index) => `<div style="padding:24px 0;border-bottom:${index < content.items.length - 1 ? `1px solid ${colors.border}` : 'none'};">
      <div style="font-size:18px;font-weight:700;color:${colors.text};margin-bottom:8px;">${item.title}</div>
      <div style="font-size:15px;color:${colors.textSub};line-height:1.7;">${item.description}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${section.id}" style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

// stats 섹션: 숫자 48px bold accent색, 레이블 16px textSub, 수평 배치
function renderStats(section: DetailSection, colors: PaletteColors, palette: PaletteName): string {
  const content = section.content;
  if (content.type !== 'stats') return '';

  const imageHtml = renderAttachedImage(section);

  const statsHtml = content.stats
    .map(
      (stat) => `<div style="text-align:center;flex:1;min-width:120px;padding:16px;">
      <div style="font-size:48px;font-weight:700;color:${colors.accent};line-height:1.1;margin-bottom:8px;">${stat.value}</div>
      <div style="font-size:16px;color:${colors.textSub};">${stat.label}</div>
    </div>`
    )
    .join('\n');

  void palette; // WCAG 참고용 파라미터, 현재 accent 숫자 표시에는 배경 없음

  return `<div data-section-id="${section.id}" style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0;">
    ${statsHtml}
  </div>
</div>`;
}

// spec_table 섹션: 2컬럼 테이블, label=bgAlt, value=cardBg, border=colors.border
function renderSpecTable(section: DetailSection, colors: PaletteColors): string {
  const content = section.content;
  if (content.type !== 'spec_table') return '';

  const imageHtml = renderAttachedImage(section);

  const rowsHtml = content.specs
    .map(
      (spec) => `<tr>
      <td style="padding:12px 16px;background-color:${colors.bgAlt};color:${colors.text};font-weight:600;font-size:14px;border:1px solid ${colors.border};width:35%;vertical-align:top;">${spec.label}</td>
      <td style="padding:12px 16px;background-color:${colors.cardBg};color:${colors.textSub};font-size:14px;border:1px solid ${colors.border};vertical-align:top;">${spec.value}</td>
    </tr>`
    )
    .join('\n');

  return `<div data-section-id="${section.id}" style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    ${rowsHtml}
  </table>
</div>`;
}

// usage_steps 섹션: 번호 뱃지(원형, accent 배경, white 텍스트) + 단계 설명, 수직 스택
function renderUsageSteps(section: DetailSection, colors: PaletteColors, palette: PaletteName): string {
  const content = section.content;
  if (content.type !== 'usage_steps') return '';

  const imageHtml = renderAttachedImage(section);
  const badgeTextColor = getAccentTextColor(palette);

  const stepsHtml = content.steps
    .map(
      (step, index) => `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:24px;">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background-color:${colors.accent};color:${badgeTextColor};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;line-height:36px;text-align:center;min-width:36px;">${index + 1}</div>
      <div style="font-size:16px;color:${colors.text};line-height:1.7;padding-top:6px;">${step}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${section.id}" style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${stepsHtml}
</div>`;
}

// warning 섹션: 배경 #FFF3CD, border-left 4px solid #FFC107, 각 항목 앞에 ⚠️ 접두
function renderWarning(section: DetailSection, colors: PaletteColors): string {
  const content = section.content;
  if (content.type !== 'warning') return '';

  void colors; // 경고 섹션은 고정 색상 사용 (WCAG 가시성 보장)

  const itemsHtml = content.warnings
    .map(
      (warning) => `<div style="margin-bottom:12px;font-size:15px;color:#6B4F00;line-height:1.6;">⚠️ ${warning}</div>`
    )
    .join('\n');

  return `<div data-section-id="${section.id}" style="background-color:#FFF3CD;border-left:4px solid #FFC107;padding:32px 40px;box-sizing:border-box;">
  ${itemsHtml}
</div>`;
}

// cta 섹션: fullbleed, accent 배경, 중앙 정렬, 32px 이상 폰트
function renderCta(section: DetailSection, colors: PaletteColors, palette: PaletteName): string {
  const content = section.content;
  if (content.type !== 'cta') return '';

  const imageHtml = renderAttachedImage(section);
  const textColor = getAccentTextColor(palette);

  return `<div data-section-id="${section.id}" style="background-color:${colors.accent};padding:60px 40px;text-align:center;box-sizing:border-box;">
  ${imageHtml}
  <p style="font-size:36px;font-weight:700;color:${textColor};margin:0;line-height:1.4;">${content.text}</p>
</div>`;
}

// 단일 섹션 렌더링 — section.type 기반 discriminated union으로 타입 안전성 보장
export function renderSection(section: DetailSection, theme: DetailPageTheme): string {
  const colors = PALETTES[theme.palette];
  switch (section.type) {
    case 'hero':
      return renderHero(section, colors);
    case 'selling_points':
      return renderSellingPoints(section, colors);
    case 'features':
      return renderFeatures(section, colors);
    case 'stats':
      return renderStats(section, colors, theme.palette);
    case 'spec_table':
      return renderSpecTable(section, colors);
    case 'usage_steps':
      return renderUsageSteps(section, colors, theme.palette);
    case 'warning':
      return renderWarning(section, colors);
    case 'cta':
      return renderCta(section, colors, theme.palette);
  }
}

// 전체 섹션 배열을 order 기준으로 정렬 후 HTML 문자열로 합산
export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme): string {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => renderSection(s, theme))
    .join('\n');
}
