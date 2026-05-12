// src/lib/detail-page/section-renderer.ts
// 각 SectionType을 받아서 인라인 스타일 HTML 문자열을 반환하는 순수 렌더링 함수
// 쿠팡 상세페이지 제약: 인라인 스타일만 허용

import type {
  DetailSection,
  DetailPageTheme,
  ImageLayout,
  HeroContent,
  SellingPointsContent,
  FeaturesContent,
  StatsContent,
  SpecTableContent,
  UsageStepsContent,
  WarningContent,
  CtaContent,
} from '@/types/detail-page';
import type { PaletteColors } from '@/lib/detail-page/palette-config';
import { PALETTES } from '@/lib/detail-page/palette-config';

// ─────────────────────────────────────────
// 보안 헬퍼
// ─────────────────────────────────────────

// HTML 특수문자를 이스케이프하여 XSS/인젝션 방지
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 이미지 URL 검증: http:// 또는 https://로 시작하지 않으면 빈 문자열 반환
function sanitizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return '';
}

function editableText(path: string, value: string): string {
  return `<span data-edit-path="${escapeHtml(path)}">${escapeHtml(value)}</span>`;
}

const SECTION_LABELS: Record<DetailSection['type'], string> = {
  hero: '히어로',
  selling_points: '셀링 포인트',
  features: '특징',
  stats: '통계',
  spec_table: '사양 테이블',
  usage_steps: '사용법',
  warning: '주의사항',
  cta: '구매 유도',
};

function sectionAttrs(section: DetailSection): string {
  return `data-section-id="${escapeHtml(section.id)}" data-section-type="${escapeHtml(section.type)}" data-section-label="${escapeHtml(SECTION_LABELS[section.type])}"`;
}

// fontStyle에 따른 제목 font-family 인라인 스타일 조각 (sans는 빈 문자열)
function headingFontStyle(fontStyle: string): string {
  return fontStyle !== 'sans' ? ";font-family:'Batang','HY신명조',Georgia,serif" : '';
}

// ─────────────────────────────────────────
// 첨부 이미지 렌더러
// ─────────────────────────────────────────

// 레이아웃별 단일 이미지 스타일 (모듈 레벨 상수)
const IMAGE_SINGLE_STYLE: Record<ImageLayout, string> = {
  fullbleed: 'width:100%;display:block;max-width:100%;height:auto;margin-bottom:24px;',
  composed:  'width:88%;max-width:560px;display:block;margin:0 auto 24px;height:auto;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.12);',
  split:     'width:100%;display:block;max-width:100%;height:auto;margin-bottom:24px;border-radius:6px;',
};

// 첨부 이미지가 없으면 빈 문자열, 2장 이상이면 flex 컨테이너로 나란히, 1장이면 단일 이미지 반환
function renderAttachedImage(section: DetailSection, imageLayout: ImageLayout): string {
  if (section.attachedImages.length === 0) return '';

  if (section.attachedImages.length >= 2) {
    const img1 = section.attachedImages[0];
    const img2 = section.attachedImages[1];
    const safeUrl1 = sanitizeUrl(img1.url);
    const safeUrl2 = sanitizeUrl(img2.url);
    if (!safeUrl1 && !safeUrl2) return '';
    const isComposed = imageLayout === 'composed';
    const itemStyle = isComposed
      ? 'flex:1;min-width:0;width:50%;display:block;height:auto;border-radius:8px;'
      : 'flex:1;min-width:0;width:50%;display:block;height:auto;';
    const imgTag = (url: string) =>
      url
        ? `<img src="${escapeHtml(url)}" alt="" style="${itemStyle}" />`
        : `<div style="flex:1;min-width:0;width:50%;"></div>`;
    const gap = isComposed ? '16px' : '8px';
    return `<div style="display:flex;gap:${gap};width:100%;box-sizing:border-box;margin-bottom:24px;">${imgTag(safeUrl1)}${imgTag(safeUrl2)}</div>`;
  }

  const img = section.attachedImages[0];
  const safeUrl = sanitizeUrl(img.url);
  if (!safeUrl) return '';
  return `<img src="${escapeHtml(safeUrl)}" alt="" style="${IMAGE_SINGLE_STYLE[imageLayout]}" />`;
}

// ─────────────────────────────────────────
// 섹션 렌더러
// ─────────────────────────────────────────

// hero 섹션: fullbleed 레이아웃, headline h2(32px bold) + subheadline p(18px)
function renderHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};color:${colors.text};padding:60px 40px;text-align:center;width:100%;box-sizing:border-box;">
  ${imageHtml}
  <h2 style="font-size:32px;font-weight:700;color:${colors.text};margin:0 0 16px 0;line-height:1.3${headingFont};">${editableText('content.headline', content.headline)}</h2>
  <p style="font-size:18px;color:${colors.textSub};margin:0;line-height:1.6;">${editableText('content.subheadline', content.subheadline)}</p>
</div>`;
}

// selling_points 섹션: 최대 2컬럼 그리드, icon + title + description, cardBg 배경
function renderSellingPoints(content: SellingPointsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  const pointsHtml = content.points
    .map(
      (point, index) => `<div style="flex:1;min-width:calc(50% - 12px);background-color:${colors.cardBg};border:1px solid ${colors.border};border-radius:8px;padding:24px;box-sizing:border-box;">
      <div style="font-size:28px;margin-bottom:12px;line-height:1;">${editableText(`content.points.${index}.icon`, point.icon)}</div>
      <div style="font-size:16px;font-weight:700;color:${colors.text};margin-bottom:8px${headingFont};">${editableText(`content.points.${index}.title`, point.title)}</div>
      <div style="font-size:14px;color:${colors.textSub};line-height:1.6;">${editableText(`content.points.${index}.description`, point.description)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;gap:24px;">
    ${pointsHtml}
  </div>
</div>`;
}

// features 섹션: title + description 쌍, bgAlt 배경, 각 아이템 border-bottom
function renderFeatures(content: FeaturesContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  const itemsHtml = content.items
    .map(
      (item, index) => `<div style="padding:24px 0;border-bottom:${index < content.items.length - 1 ? `1px solid ${colors.border}` : 'none'};">
      <div style="font-size:18px;font-weight:700;color:${colors.text};margin-bottom:8px${headingFont};">${editableText(`content.items.${index}.title`, item.title)}</div>
      <div style="font-size:15px;color:${colors.textSub};line-height:1.7;">${editableText(`content.items.${index}.description`, item.description)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

// stats 섹션: 숫자 48px bold accent색, 레이블 16px textSub, 수평 배치
function renderStats(content: StatsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  const statsHtml = content.stats
    .map(
      (stat, index) => `<div style="text-align:center;flex:1;min-width:120px;padding:16px;">
      <div style="font-size:48px;font-weight:700;color:${colors.accent};line-height:1.1;margin-bottom:8px${headingFont};">${editableText(`content.stats.${index}.value`, stat.value)}</div>
      <div style="font-size:16px;color:${colors.textSub};">${editableText(`content.stats.${index}.label`, stat.label)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0;">
    ${statsHtml}
  </div>
</div>`;
}

// spec_table 섹션: 2컬럼 테이블, label=bgAlt, value=cardBg, border=colors.border
function renderSpecTable(content: SpecTableContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  const rowsHtml = content.specs
    .map(
      (spec, index) => `<tr>
      <td style="padding:12px 16px;background-color:${colors.bgAlt};color:${colors.text};font-weight:600;font-size:14px;border:1px solid ${colors.border};width:35%;vertical-align:top;word-break:break-word${headingFont};">${editableText(`content.specs.${index}.label`, spec.label)}</td>
      <td style="padding:12px 16px;background-color:${colors.cardBg};color:${colors.textSub};font-size:14px;border:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.value`, spec.value)}</td>
    </tr>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    ${rowsHtml}
  </table>
</div>`;
}

// usage_steps 섹션: 번호 뱃지(원형, accent 배경, accentTextColor 텍스트) + 단계 설명, 수직 스택
function renderUsageSteps(content: UsageStepsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  const stepsHtml = content.steps
    .map(
      (step, index) => `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:24px;">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background-color:${colors.accent};color:${colors.accentTextColor};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;line-height:36px;text-align:center;min-width:36px${headingFont};">${index + 1}</div>
      <div style="font-size:16px;color:${colors.text};line-height:1.7;padding-top:6px;">${editableText(`content.steps.${index}`, step)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${stepsHtml}
</div>`;
}

// warning 섹션: 배경 #FFF3CD, border-left 4px solid #FFC107, 각 항목 앞에 ⚠️ 접두
// 경고 섹션은 WCAG 가시성 보장을 위해 고정 색상 사용 (palette 색상 미적용)
function renderWarning(content: WarningContent, section: DetailSection, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const itemsHtml = content.warnings
    .map(
      (warning, index) => `<div style="margin-bottom:12px;font-size:15px;color:#6B4F00;line-height:1.6;">⚠️ ${editableText(`content.warnings.${index}`, warning)}</div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:#FFF3CD;border-left:4px solid #FFC107;padding:32px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

// cta 섹션: fullbleed, accent 배경, 중앙 정렬, 32px 이상 폰트
function renderCta(content: CtaContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);

  return `<div ${sectionAttrs(section)} style="background-color:${colors.accent};padding:60px 40px;text-align:center;box-sizing:border-box;">
  ${imageHtml}
  <p style="font-size:36px;font-weight:700;color:${colors.accentTextColor};margin:0;line-height:1.4${headingFont};">${editableText('content.text', content.text)}</p>
</div>`;
}

// 단일 섹션 렌더링 — section.type 기반 discriminated union으로 타입 안전성 보장
export function renderSection(section: DetailSection, theme: DetailPageTheme): string {
  const colors = PALETTES[theme.palette];
  switch (section.type) {
    case 'hero':
      return renderHero(section.content as HeroContent, section, colors, theme);
    case 'selling_points':
      return renderSellingPoints(section.content as SellingPointsContent, section, colors, theme);
    case 'features':
      return renderFeatures(section.content as FeaturesContent, section, colors, theme);
    case 'stats':
      return renderStats(section.content as StatsContent, section, colors, theme);
    case 'spec_table':
      return renderSpecTable(section.content as SpecTableContent, section, colors, theme);
    case 'usage_steps':
      return renderUsageSteps(section.content as UsageStepsContent, section, colors, theme);
    case 'warning':
      return renderWarning(section.content as WarningContent, section, theme);
    case 'cta':
      return renderCta(section.content as CtaContent, section, colors, theme);
  }
}

// 전체 섹션 배열을 order 기준으로 정렬 후 HTML 문자열로 합산
export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme): string {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => renderSection(s, theme))
    .join('\n');
}
