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
  BrandHeaderContent,
  PointContent,
  ImageGridContent,
  PointSectionContent,
  StatCalloutContent,
  BarChartContent,
  WhyIconsContent,
  CertificationsContent,
  InfographicStepsContent,
} from '@/types/detail-page';
import type { PaletteColors } from '@/lib/detail-page/palette-config';
import { PALETTES } from '@/lib/detail-page/palette-config';
import { editableMarkupText } from '@/lib/detail-page/inline-markup';

// ─────────────────────────────────────────
// 보안 헬퍼
// ─────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  brand_header: '브랜드 헤더',
  point: '포인트',
  image_grid: '이미지 그리드',
  point_section: 'POINT 섹션',
  stat_callout: '수치 강조',
  bar_chart: '바 차트',
  why_icons: 'WHY 아이콘',
  certifications: '인증 배지',
  infographic_steps: '사용법 인포그래픽',
  claude_layout: 'AI 레이아웃',
};

function sectionAttrs(section: DetailSection): string {
  return `data-section-id="${escapeHtml(section.id)}" data-section-type="${escapeHtml(section.type)}" data-section-label="${escapeHtml(SECTION_LABELS[section.type])}"`;
}

function headingFontStyle(fontStyle: string): string {
  return fontStyle !== 'sans' ? ";font-family:'Batang','HY신명조',Georgia,serif" : '';
}

// eyebrow 레이블 — section.eyebrow가 있을 때만 렌더링
function renderEyebrow(section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (!section.eyebrow) return '';
  const fontFamily =
    theme.fontStyle !== 'sans'
      ? "'Batang','HY신명조',Georgia,serif"
      : 'system-ui,-apple-system,sans-serif';
  return `<div style="font-size:10px;letter-spacing:3px;color:${colors.labelColor};text-transform:uppercase;font-weight:600;margin-bottom:8px;font-family:${fontFamily};">${escapeHtml(section.eyebrow)}</div>`;
}

// ─────────────────────────────────────────
// 첨부 이미지 렌더러
// ─────────────────────────────────────────

const IMAGE_SINGLE_STYLE: Record<ImageLayout, string> = {
  fullbleed: 'width:100%;display:block;max-width:100%;height:auto;margin-bottom:24px;',
  composed:  'width:88%;max-width:560px;display:block;margin:0 auto 24px;height:auto;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.12);',
  split:     'width:100%;display:block;max-width:100%;height:auto;margin-bottom:24px;border-radius:6px;',
};

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

function renderHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (theme.layoutMode === 'mobile') return renderMobileHero(content, section, colors, theme);

  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};color:${colors.text};padding:60px 40px;text-align:center;width:100%;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <h2 style="font-size:clamp(20px,4vw,32px);font-weight:700;color:${colors.text};margin:0 0 16px 0;line-height:1.3${headingFont};">${editableText('content.headline', content.headline)}</h2>
  <p style="font-size:18px;color:${colors.textSub};margin:0;line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>
</div>`;
}

// 모바일 hero — 쿠팡 모바일 스타일: 필기체 eyebrow + 34px 헤드라인 + 해시태그/문단 subheadline
function renderMobileHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = section.eyebrow
    ? `<div style="font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:22px;color:${colors.labelColor};margin-bottom:10px;">${escapeHtml(section.eyebrow)}</div>`
    : '';
  const sub = content.subheadline.trim();
  const subHtml = sub.startsWith('#')
    ? `<div style="text-align:center;"><span data-edit-path="content.subheadline" style="font-size:18px;font-weight:700;color:${colors.text};word-spacing:12px;line-height:1.8;">${escapeHtml(sub)}</span></div>`
    : `<p style="margin:0;font-size:17px;color:${colors.textSub};line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>`;
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:0;box-sizing:border-box;">
  <div style="padding:32px 20px 24px;text-align:center;">
    ${eyebrowHtml}
    <h1 style="margin:0 0 14px;font-size:34px;font-weight:800;color:${colors.text};letter-spacing:-1px;line-height:1.3${headingFont};">${editableText('content.headline', content.headline)}</h1>
    ${subHtml}
  </div>
  ${renderFullBleedImages(section)}
</div>`;
}

function renderSellingPoints(content: SellingPointsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const pointsHtml = content.points
    .map(
      (point, index) => `<div style="flex:1;min-width:calc(50% - 12px);background-color:${colors.cardBg};border:1px solid ${colors.border};border-top:4px solid ${colors.accent};border-radius:8px;padding:24px;box-sizing:border-box;">
      <div style="font-size:16px;font-weight:700;color:${colors.text};margin-bottom:8px${headingFont};">${editableText(`content.points.${index}.title`, point.title)}</div>
      <div style="font-size:14px;color:${colors.textSub};line-height:1.6;">${editableMarkupText(`content.points.${index}.description`, point.description, colors.accent)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;gap:24px;">
    ${pointsHtml}
  </div>
</div>`;
}

function renderFeatures(content: FeaturesContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const itemsHtml = content.items
    .map(
      (item, index) => `<div style="padding:24px 0;border-bottom:${index < content.items.length - 1 ? `1px solid ${colors.border}` : 'none'};">
      <div style="font-size:18px;font-weight:700;color:${colors.text};margin-bottom:8px${headingFont};">${editableText(`content.items.${index}.title`, item.title)}</div>
      <div style="font-size:15px;color:${colors.textSub};line-height:1.7;">${editableMarkupText(`content.items.${index}.description`, item.description, colors.accent)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

function renderStats(content: StatsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const statsHtml = content.stats
    .map(
      (stat, index) => `<div style="text-align:center;flex:1;min-width:120px;padding:16px;">
      <div style="font-size:48px;font-weight:700;color:${colors.accent};line-height:1.1;margin-bottom:8px${headingFont};">${editableText(`content.stats.${index}.value`, stat.value)}</div>
      <div style="font-size:16px;color:${colors.textSub};">${editableText(`content.stats.${index}.label`, stat.label)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0;">
    ${statsHtml}
  </div>
</div>`;
}

function renderSpecTable(content: SpecTableContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (theme.layoutMode === 'mobile') return renderMobileSpecTable(content, section, colors);

  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const rowsHtml = content.specs
    .map(
      (spec, index) => `<tr>
      <td style="padding:12px 16px;background-color:${colors.bgAlt};color:${colors.text};font-weight:600;font-size:14px;border:1px solid ${colors.border};width:35%;vertical-align:top;word-break:break-word${headingFont};">${editableText(`content.specs.${index}.label`, spec.label)}</td>
      <td style="padding:12px 16px;background-color:${colors.cardBg};color:${colors.textSub};font-size:14px;border:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.value`, spec.value)}</td>
    </tr>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    ${rowsHtml}
  </table>
</div>`;
}

// 모바일 spec_table — 쿠팡 모바일 스타일: 팔레트 패널 안에 보더리스 행
function renderMobileSpecTable(content: SpecTableContent, section: DetailSection, colors: PaletteColors): string {
  // 패널은 외곽(cardBg)과 구분되어야 한다 — bg가 cardBg와 같은 팔레트(cool_white 등)는 bgAlt 사용
  const panelBg = colors.bg.toLowerCase() === colors.cardBg.toLowerCase() ? colors.bgAlt : colors.bg;
  const rowsHtml = content.specs
    .map(
      (spec, index) => `<tr>
      <td style="padding:14px 8px;font-size:15px;font-weight:600;color:${colors.textSub};width:32%;border-bottom:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.label`, spec.label)}</td>
      <td style="padding:14px 8px;font-size:15px;color:${colors.text};border-bottom:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.value`, spec.value)}</td>
    </tr>`,
    )
    .join('\n');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:32px 20px;box-sizing:border-box;">
  <div style="background-color:${panelBg};border-radius:8px;padding:8px 16px;">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      ${rowsHtml}
    </table>
  </div>
</div>`;
}

function renderUsageSteps(content: UsageStepsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const stepsHtml = content.steps
    .map(
      (step, index) => `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:24px;">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background-color:${colors.accent};color:${colors.accentTextColor};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;line-height:36px;text-align:center;min-width:36px${headingFont};">${index + 1}</div>
      <div style="font-size:16px;color:${colors.text};line-height:1.7;padding-top:6px;">${editableMarkupText(`content.steps.${index}`, step, colors.accent)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  ${stepsHtml}
</div>`;
}

// warning: 배경·border 고정 색상 유지 (WCAG 가시성), markup은 palette accent 적용
function renderWarning(content: WarningContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const eyebrowHtml = renderEyebrow(section, colors, theme);
  const itemsHtml = content.warnings
    .map(
      (warning, index) => `<div style="margin-bottom:12px;font-size:15px;color:#6B4F00;line-height:1.6;"><span style="font-weight:700;margin-right:6px;">&#9650;</span>${editableMarkupText(`content.warnings.${index}`, warning, colors.accent)}</div>`
    )
    .join('\n');
  const pad = theme.layoutMode === 'mobile' ? '32px 20px' : '32px 40px';

  return `<div ${sectionAttrs(section)} style="background-color:#FFF3CD;border-left:4px solid #FFC107;padding:${pad};box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

function renderCta(content: CtaContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);
  const pad = theme.layoutMode === 'mobile' ? '40px 20px' : '60px 40px';
  const fontSize = theme.layoutMode === 'mobile' ? '24px' : '36px';

  return `<div ${sectionAttrs(section)} style="background-color:${colors.accent};padding:${pad};text-align:center;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <p style="font-size:${fontSize};font-weight:700;color:${colors.accentTextColor};margin:0;line-height:1.4${headingFont};">${editableText('content.text', content.text)}</p>
</div>`;
}

// ─────────────────────────────────────────
// 모바일 섹션 렌더러 (brand_header / point / image_grid)
// ─────────────────────────────────────────

/** attachedImages 전체를 전체폭 이미지로 렌더링 (패딩 0) */
function renderFullBleedImages(section: DetailSection): string {
  return section.attachedImages
    .map((img) => {
      const safe = sanitizeUrl(img.url);
      return safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;" />` : '';
    })
    .join('');
}

/** #RGB/#RGBA/#RRGGBB/#RRGGBBAA hex만 허용, 그 외 기본 회색 (CSS 인젝션 방지) */
function sanitizeSwatchColor(color: string | undefined): string {
  return color && /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color) ? color : '#cccccc';
}

function renderBrandHeader(content: BrandHeaderContent, section: DetailSection, colors: PaletteColors): string {
  return `<div ${sectionAttrs(section)} style="display:flex;justify-content:space-between;align-items:baseline;padding:16px 20px;border-bottom:1px solid ${colors.border};background-color:${colors.cardBg};box-sizing:border-box;">
  <span style="font-size:15px;font-weight:600;color:${colors.text};">${editableText('content.brandName', content.brandName)}</span>
  <span style="font-size:13px;color:${colors.textSub};">${editableText('content.rightLabel', content.rightLabel)}</span>
</div>`;
}

function renderPoint(content: PointContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const headingFont = headingFontStyle(theme.fontStyle);
  const safeUrl = section.attachedImages[0] ? sanitizeUrl(section.attachedImages[0].url) : '';

  if (!safeUrl) {
    // 이미지 없는 경우: 텍스트만 렌더링
    const labelHtml = content.pointLabel
      ? `<div style="margin-bottom:12px;"><span style="display:block;font-size:18px;color:${colors.labelColor};margin-bottom:6px;">&#9745;</span><span style="font-family:Georgia,serif;font-style:italic;font-size:26px;color:${colors.labelColor};">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
      : '';
    return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 20px 28px;text-align:center;box-sizing:border-box;">
  ${labelHtml}
  <h2 style="margin:0 0 10px;font-size:28px;font-weight:800;color:${colors.text};line-height:1.35;letter-spacing:-0.5px${headingFont};">${editableText('content.headline', content.headline)}</h2>
  <p style="margin:0;font-size:17px;color:${colors.textSub};line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>
</div>`;
  }

  // textPosition에 따라 오버레이 위치 결정 (기본값: bottom)
  const tp = content.textPosition ?? 'bottom';
  const overlayStyle =
    tp === 'top'
      ? 'position:absolute;top:0;left:0;right:0;background:linear-gradient(rgba(0,0,0,0.82) 0%,rgba(0,0,0,0.60) 65%,transparent 100%);padding:28px 20px 24px;text-align:center;line-height:1.4;box-sizing:border-box;'
      : tp === 'center'
      ? 'position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);background:rgba(0,0,0,0.70);padding:20px;text-align:center;line-height:1.4;box-sizing:border-box;'
      : 'position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent 0%,rgba(0,0,0,0.60) 35%,rgba(0,0,0,0.82) 100%);padding:24px 20px 28px;text-align:center;line-height:1.4;box-sizing:border-box;';

  const labelHtml = content.pointLabel
    ? `<div style="margin-bottom:8px;"><span style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:rgba(255,255,255,0.92);">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
    : '';
  return `<div ${sectionAttrs(section)} style="position:relative;width:100%;overflow:hidden;line-height:0;box-sizing:border-box;">
  <img src="${escapeHtml(safeUrl)}" alt="" style="width:100%;display:block;" />
  <div style="${overlayStyle}">
    ${labelHtml}
    <h2 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#fff;line-height:1.3;letter-spacing:-0.5px;text-shadow:0 2px 8px rgba(0,0,0,0.8),0 0 20px rgba(0,0,0,0.5)${headingFont};">${editableText('content.headline', content.headline)}</h2>
    <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.88);line-height:1.5;">${editableMarkupText('content.subheadline', content.subheadline, 'rgba(255,255,255,0.7)')}</p>
  </div>
</div>`;
}

function renderImageGrid(content: ImageGridContent, section: DetailSection, colors: PaletteColors): string {
  // points가 있으면 배경 이미지 + Point 스타일 오버레이 렌더링
  if (content.points && content.points.length > 0) {
    const bgUrl = section.attachedImages[0]?.url ?? '';
    const safeUrl = bgUrl ? sanitizeUrl(bgUrl) : '';
    const escapedTitle = escapeHtml(content.title);
    const bulletItems = content.points
      .map(p => `<li style="margin-bottom:6px;font-size:14px;line-height:1.4;">${escapeHtml(p)}</li>`)
      .join('');

    return `<div ${sectionAttrs(section)} style="position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;">
  ${safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />` : ''}
  <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%);padding:24px 20px 20px;color:#fff;">
    ${escapedTitle ? `<p style="margin:0 0 10px;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${escapedTitle}</p>` : ''}
    <ul style="margin:0;padding-left:16px;">${bulletItems}</ul>
  </div>
</div>`;
  }

  // fallback: 기존 그리드 렌더링 (points 없는 경우)
  const titleHtml = content.title
    ? `<h2 style="margin:0 0 24px;font-family:Georgia,serif;font-size:26px;font-weight:400;color:${colors.textSub};text-align:center;">${editableText('content.title', content.title)}</h2>`
    : '';
  const cells = content.items
    .map((item, i) => {
      const img = section.attachedImages[i];
      const safe = img ? sanitizeUrl(img.url) : '';
      const imgHtml = safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;border-radius:8px;" />` : '';
      const swatchHtml = item.swatchColor !== undefined
        ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background-color:${sanitizeSwatchColor(item.swatchColor)};margin-right:6px;vertical-align:-2px;"></span>`
        : '';
      const labelHtml = item.label
        ? `<div style="margin-top:8px;font-size:15px;color:${colors.text};">${swatchHtml}${editableText(`content.items.${i}.label`, item.label)}</div>`
        : '';
      return `<div style="width:50%;padding:8px;box-sizing:border-box;text-align:center;">${imgHtml}${labelHtml}</div>`;
    })
    .join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 12px;box-sizing:border-box;">
  ${titleHtml}
  <div style="display:flex;flex-wrap:wrap;">${cells}</div>
</div>`;
}

// ─────────────────────────────────────────
// Rich 섹션 렌더러 (6종)
// ─────────────────────────────────────────

function renderPointSection(content: PointSectionContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) =>
    `<div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:12px;display:flex;gap:20px;align-items:flex-start;">
      <div style="flex-shrink:0;"><div style="background:#1e293b;color:#ffffff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;letter-spacing:1px;">POINT ${escapeHtml(String(item.number))}</div></div>
      <div>
        <div style="font-size:18px;font-weight:800;color:${colors.text};margin-bottom:6px;">${editableText(`content.items.${i}.title`, item.title)}</div>
        <div style="font-size:13px;color:${colors.textSub};line-height:1.6;">${editableText(`content.items.${i}.description`, item.description)}</div>
      </div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;">${itemsHtml}</div>`;
}

function renderStatCallout(content: StatCalloutContent, section: DetailSection, colors: PaletteColors): string {
  const cols = Math.max(1, Math.min(content.items.length, 3));
  const itemsHtml = content.items.map((item, i) =>
    `<div style="background:linear-gradient(135deg,#1e293b,#334155);border-radius:12px;padding:20px 16px;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#f8fafc;line-height:1.2;">${editableText(`content.items.${i}.value`, item.value)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${editableText(`content.items.${i}.label`, item.label)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;">${editableText(`content.items.${i}.description`, item.description)}</div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${itemsHtml}</div></div>`;
}

function renderBarChart(content: BarChartContent, section: DetailSection, colors: PaletteColors): string {
  const maxPct = Math.max(...content.items.map(i => i.percentage), 1);
  const itemsHtml = content.items.map((item, i) => {
    const barWidth = Math.min(Math.round((item.percentage / maxPct) * 100), 100);
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <span style="font-size:13px;color:${colors.text};width:100px;flex-shrink:0;">${editableText(`content.items.${i}.label`, item.label)}</span>
      <div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${barWidth}%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:4px;"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:#6366f1;width:50px;text-align:right;flex-shrink:0;">${editableText(`content.items.${i}.displayValue`, item.displayValue)}</span>
    </div>`;
  }).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="background:#f8fafc;border-radius:12px;padding:20px;">${itemsHtml}</div></div>`;
}

function renderWhyIcons(content: WhyIconsContent, section: DetailSection, colors: PaletteColors): string {
  const cols = Math.max(1, Math.min(content.items.length, 4));
  const itemsHtml = content.items.map((item, i) =>
    `<div style="text-align:center;padding:16px 8px;">
      <div style="font-size:28px;margin-bottom:8px;">${escapeHtml(item.icon)}</div>
      <div style="font-size:13px;font-weight:700;color:${colors.text};margin-bottom:4px;">${editableText(`content.items.${i}.title`, item.title)}</div>
      <div style="font-size:11px;color:${colors.textSub};line-height:1.4;">${editableText(`content.items.${i}.description`, item.description)}</div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${itemsHtml}</div></div>`;
}

function renderCertifications(content: CertificationsContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) =>
    `<div style="border:2px solid #e2e8f0;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
      <div style="font-size:24px;">✅</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:${colors.text};">${editableText(`content.items.${i}.name`, item.name)}</div>
        <div style="font-size:11px;color:${colors.textSub};margin-top:2px;">${editableText(`content.items.${i}.description`, item.description)}</div>
      </div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:flex;gap:12px;flex-wrap:wrap;">${itemsHtml}</div></div>`;
}

function renderInfographicSteps(content: InfographicStepsContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) => {
    const isLast = i === content.items.length - 1;
    const arrow = isLast ? '' : `<div style="position:absolute;right:-10px;top:18px;color:#94a3b8;font-size:18px;z-index:1;">→</div>`;
    return `<div style="flex:1;text-align:center;position:relative;">
      ${arrow}
      <div style="width:36px;height:36px;background:#6366f1;color:#ffffff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;margin:0 auto 8px;">${escapeHtml(String(item.step))}</div>
      <div style="font-size:24px;margin-bottom:6px;">${escapeHtml(item.icon)}</div>
      <div style="font-size:12px;font-weight:700;color:${colors.text};margin-bottom:3px;">${editableText(`content.items.${i}.title`, item.title)}</div>
      <div style="font-size:11px;color:${colors.textSub};">${editableText(`content.items.${i}.description`, item.description)}</div>
    </div>`;
  }).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:flex;align-items:flex-start;gap:0;">${itemsHtml}</div></div>`;
}

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
      return renderWarning(section.content as WarningContent, section, colors, theme);
    case 'cta':
      return renderCta(section.content as CtaContent, section, colors, theme);
    case 'brand_header':
      return renderBrandHeader(section.content as BrandHeaderContent, section, colors);
    case 'point':
      return renderPoint(section.content as PointContent, section, colors, theme);
    case 'image_grid':
      return renderImageGrid(section.content as ImageGridContent, section, colors);
    case 'point_section':
      return renderPointSection(section.content as PointSectionContent, section, colors);
    case 'stat_callout':
      return renderStatCallout(section.content as StatCalloutContent, section, colors);
    case 'bar_chart':
      return renderBarChart(section.content as BarChartContent, section, colors);
    case 'why_icons':
      return renderWhyIcons(section.content as WhyIconsContent, section, colors);
    case 'certifications':
      return renderCertifications(section.content as CertificationsContent, section, colors);
    case 'infographic_steps':
      return renderInfographicSteps(section.content as InfographicStepsContent, section, colors);
    case 'claude_layout':
      // claude_layout 섹션은 클라이언트 렌더러에서 처리 — 서버사이드 HTML 미지원
      return `<div ${sectionAttrs(section)} style="padding:24px;text-align:center;color:#999;">[AI 레이아웃 섹션]</div>`;
  }
}

export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme): string {
  return [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => renderSection(s, theme))
    .join('\n');
}
