/**
 * Sharp + Pretendard를 사용해 둥근 모서리 텍스트 뱃지를 이미지에 합성하는 공통 유틸리티.
 * 볼드 텍스트 + 드롭 섀도우로 시각적 가시성 확보.
 */

import path from 'path'
import sharp from 'sharp'

export type BadgePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

export interface TextBadgeOptions {
  text: string
  position?: BadgePosition
}

const BADGE_FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'PretendardVariable.ttf')
const BADGE_DPI = 290          // 선명도 향상
const BADGE_PADDING_X = 30
const BADGE_PADDING_Y = 20
const BADGE_BORDER_RADIUS = 18
const BADGE_MARGIN = 64
const BADGE_STROKE = 2

// 드롭 섀도우: 별도 rect를 오른쪽·아래로 offset해 뒤에 깔기
const SHADOW_DX = 3
const SHADOW_DY = 4
const SHADOW_ALPHA = 0.28      // 0–1

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 이미지 버퍼에 볼드 텍스트 뱃지(+ 드롭 섀도우)를 합성해 JPEG 버퍼를 반환한다.
 * 실패 시 원본 버퍼를 반환 (뱃지 없이도 동작).
 */
export async function addTextBadge(
  inputBuffer: Buffer,
  text: string,
  position: BadgePosition = 'top-right',
): Promise<Buffer> {
  try {
    const meta = await sharp(inputBuffer).metadata()
    const imgW = meta.width ?? 1200
    const imgH = meta.height ?? 1200

    // 볼드 텍스트 — Pango markup <b> 태그
    const textImg = await sharp({
      text: {
        text: `<b>${escapeXml(text)}</b>`,
        fontfile: BADGE_FONT_PATH,
        dpi: BADGE_DPI,
        rgba: true,
      },
    })
      .png()
      .toBuffer()

    const textMeta = await sharp(textImg).metadata()
    const textW = textMeta.width ?? 80
    const textH = textMeta.height ?? 32

    const badgeW = textW + BADGE_PADDING_X * 2
    const badgeH = textH + BADGE_PADDING_Y * 2

    // 배경 SVG: 섀도우 rect(offset) + 메인 rect 순서로 레이어
    const shadowAlphaHex = Math.round(SHADOW_ALPHA * 255).toString(16).padStart(2, '0')
    const svgW = badgeW + SHADOW_DX
    const svgH = badgeH + SHADOW_DY

    const bgSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
        <!-- 드롭 섀도우 -->
        <rect
          x="${SHADOW_DX}" y="${SHADOW_DY}"
          width="${badgeW - BADGE_STROKE}" height="${badgeH - BADGE_STROKE}"
          rx="${BADGE_BORDER_RADIUS}" ry="${BADGE_BORDER_RADIUS}"
          fill="#000000${shadowAlphaHex}"
        />
        <!-- 메인 흰 박스 -->
        <rect
          x="${BADGE_STROKE / 2}" y="${BADGE_STROKE / 2}"
          width="${badgeW - BADGE_STROKE}" height="${badgeH - BADGE_STROKE}"
          rx="${BADGE_BORDER_RADIUS}" ry="${BADGE_BORDER_RADIUS}"
          fill="white" stroke="#1a1a1a" stroke-width="${BADGE_STROKE}"
        />
      </svg>`,
    )

    // 배경 위에 텍스트 합성
    const badge = await sharp(bgSvg)
      .composite([{ input: textImg, left: BADGE_PADDING_X, top: BADGE_PADDING_Y }])
      .png()
      .toBuffer()

    // 이미지에 뱃지 배치 (섀도우 dx/dy 고려해 흰 박스 기준으로 위치 계산)
    const left = position.includes('left')
      ? BADGE_MARGIN
      : imgW - svgW - BADGE_MARGIN
    const top = position.includes('top')
      ? BADGE_MARGIN
      : imgH - svgH - BADGE_MARGIN

    return sharp(inputBuffer)
      .composite([{ input: badge, left, top }])
      .jpeg({ quality: 92, progressive: true })
      .toBuffer()
  } catch (err) {
    console.warn(
      '[text-badge] addTextBadge 실패, 원본 반환:',
      err instanceof Error ? err.message : err,
    )
    return inputBuffer
  }
}
