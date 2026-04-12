/**
 * POST /api/ai/generate-slot-captions
 *
 * 슬롯별 이미지(Base64)를 Claude Vision으로 분석하여
 * frameType에 따른 캡션/메타데이터를 반환합니다.
 *
 * - custom_3col: 각 컬럼에 대해 { title, tag, name, hashtags } 생성
 * - custom_gallery: 각 슬롯에 대해 캡션(15자 이내) 생성
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { jsonrepair } from 'jsonrepair';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 허용 MIME 타입 */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Base64 최대 크기 제한: 약 10MB 원본 기준 (Base64는 원본의 약 1.33배) */
const MAX_BASE64_LENGTH = 14 * 1024 * 1024;

/** custom_3col 슬롯 키 */
const COL_KEYS = ['col1', 'col2', 'col3'] as const;
type ColKey = (typeof COL_KEYS)[number];

/** custom_gallery 슬롯 키 */
const SLOT_KEYS = ['slot1', 'slot2', 'slot3', 'slot4'] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

/** Rate limit: 분당 5회 */
const SLOT_CAPTION_RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 } as const;

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

interface SlotImage {
  imageBase64: string; // 순수 base64 (data URL prefix 제거 후)
  mimeType: AllowedMimeType;
}

type FrameType = 'custom_3col' | 'custom_gallery';

interface ValidatedInput {
  frameType: FrameType;
  slots: Record<string, SlotImage>;
}

/** custom_3col 단일 컬럼 메타데이터 */
interface Col3Data {
  title: string;
  tag: string;
  name: string;
  hashtags: string[];
}

/** custom_3col 응답 metadata */
type Metadata3Col = Partial<Record<ColKey, Col3Data>>;

/** custom_gallery 응답 metadata */
interface MetadataGallery {
  caption1?: string;
  caption2?: string;
  caption3?: string;
  caption4?: string;
}

interface ApiSuccessResponse {
  success: true;
  data: { metadata: Metadata3Col | MetadataGallery };
}

interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
}

// ─────────────────────────────────────────
// 헬퍼: data URL prefix 제거
// ─────────────────────────────────────────

function stripDataUrlPrefix(imageBase64: string): string {
  if (!imageBase64.startsWith('data:')) {
    return imageBase64;
  }
  const commaIndex = imageBase64.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('data URL 형식이 올바르지 않습니다.');
  }
  return imageBase64.slice(commaIndex + 1);
}

// ─────────────────────────────────────────
// 입력 검증
// ─────────────────────────────────────────

function validateRequestBody(body: unknown): ValidatedInput {
  if (!body || typeof body !== 'object') {
    throw new Error('요청 바디가 유효한 JSON 객체가 아닙니다.');
  }

  const raw = body as Record<string, unknown>;

  // frameType 검증
  const { frameType, slots } = raw;
  if (frameType !== 'custom_3col' && frameType !== 'custom_gallery') {
    throw new Error("frameType은 'custom_3col' 또는 'custom_gallery' 이어야 합니다.");
  }

  // slots 객체 검증
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new Error('slots 필드는 비어있지 않은 객체여야 합니다.');
  }

  const slotsRaw = slots as Record<string, unknown>;
  const slotEntries = Object.entries(slotsRaw);

  if (slotEntries.length === 0) {
    throw new Error('slots에 이미지가 최소 1개 이상 있어야 합니다.');
  }

  // frameType별 허용 슬롯 키 검증
  const allowedKeys: readonly string[] =
    frameType === 'custom_3col' ? COL_KEYS : SLOT_KEYS;

  const validatedSlots: Record<string, SlotImage> = {};

  for (const [key, value] of slotEntries) {
    if (!allowedKeys.includes(key)) {
      throw new Error(
        `slots.${key}는 허용되지 않는 슬롯 키입니다. 허용 키: ${allowedKeys.join(', ')}`,
      );
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`slots.${key}는 유효한 객체여야 합니다.`);
    }

    const slotRaw = value as Record<string, unknown>;
    const { imageBase64, mimeType } = slotRaw;

    // imageBase64 검증
    if (typeof imageBase64 !== 'string' || imageBase64.trim().length === 0) {
      throw new Error(`slots.${key}.imageBase64는 비어있지 않은 문자열이어야 합니다.`);
    }

    const cleanedBase64 = stripDataUrlPrefix(imageBase64);

    if (cleanedBase64.length > MAX_BASE64_LENGTH) {
      throw new Error(`slots.${key} 이미지 크기가 너무 큽니다. 10MB 이하의 이미지만 허용됩니다.`);
    }

    // mimeType 검증
    if (
      typeof mimeType !== 'string' ||
      !ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)
    ) {
      throw new Error(
        `slots.${key}.mimeType이 올바르지 않습니다. 허용 타입: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    validatedSlots[key] = { imageBase64: cleanedBase64, mimeType: mimeType as AllowedMimeType };
  }

  return { frameType, slots: validatedSlots };
}

// ─────────────────────────────────────────
// 프롬프트 빌더
// ─────────────────────────────────────────

function build3ColPrompt(slotKeys: string[]): string {
  const keyList = slotKeys.join(', ');
  return `위 상품 이미지들을 분석하여 3컬럼 비교 카드에 들어갈 텍스트를 생성해줘.
각 이미지(컬럼)마다 아래 JSON 구조로 작성해. 반드시 이미지에 보이는 실제 상품 기반으로 작성.

출력 형식 (슬롯 키가 있는 것만 포함, 현재 슬롯: ${keyList}):
{
  "col1": { "title": "특징 제목 (10자 이내)", "tag": "카테고리 태그 (5자 이내)", "name": "상품명 또는 모델명 (15자 이내)", "hashtags": ["해시태그1", "해시태그2", "해시태그3"] },
  "col2": { ... },
  "col3": { ... }
}
JSON만 출력, 설명 없음.`;
}

function buildGalleryPrompt(slotKeys: string[]): string {
  const keyList = slotKeys.join(', ');
  return `위 상품 이미지들을 분석하여 갤러리 카드의 캡션을 생성해줘.
각 이미지마다 짧고 임팩트 있는 한국어 캡션(15자 이내)을 작성해. 상품의 핵심 특징이나 감성적 표현 사용.

출력 형식 (슬롯 키가 있는 것만 포함, 현재 슬롯: ${keyList}):
{
  "slot1": "캡션1",
  "slot2": "캡션2",
  "slot3": "캡션3",
  "slot4": "캡션4"
}
JSON만 출력, 설명 없음.`;
}

// ─────────────────────────────────────────
// custom_gallery 응답 변환: slot1 → caption1
// ─────────────────────────────────────────

function transformGallerySlotsToCaptions(
  parsed: Record<string, unknown>,
): MetadataGallery {
  const result: MetadataGallery = {};
  const slotToCaptionMap: Record<SlotKey, keyof MetadataGallery> = {
    slot1: 'caption1',
    slot2: 'caption2',
    slot3: 'caption3',
    slot4: 'caption4',
  };

  for (const [slotKey, captionKey] of Object.entries(slotToCaptionMap) as [
    SlotKey,
    keyof MetadataGallery,
  ][]) {
    if (typeof parsed[slotKey] === 'string') {
      (result as Record<string, string>)[captionKey] = parsed[slotKey] as string;
    }
  }

  return result;
}

// ─────────────────────────────────────────
// custom_3col 응답 검증 및 정규화
// ─────────────────────────────────────────

function normalize3ColMetadata(parsed: Record<string, unknown>): Metadata3Col {
  const result: Metadata3Col = {};

  for (const key of COL_KEYS) {
    const col = parsed[key];
    if (!col || typeof col !== 'object' || Array.isArray(col)) continue;

    const colRaw = col as Record<string, unknown>;

    // hashtags가 배열 또는 문자열 모두 허용 (Claude가 가끔 문자열로 반환할 수 있음)
    let hashtags: string[] = [];
    if (Array.isArray(colRaw.hashtags)) {
      hashtags = colRaw.hashtags.filter((h): h is string => typeof h === 'string');
    } else if (typeof colRaw.hashtags === 'string') {
      hashtags = (colRaw.hashtags as string)
        .split(/[\s,]+/)
        .filter((h) => h.trim().length > 0);
    }

    result[key] = {
      title: typeof colRaw.title === 'string' ? colRaw.title : '',
      tag: typeof colRaw.tag === 'string' ? colRaw.tag : '',
      name: typeof colRaw.name === 'string' ? colRaw.name : '',
      hashtags,
    };
  }

  return result;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  // 인증 검증
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return NextResponse.json(
      { success: false, error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  // Rate limit 검사 (분당 5회)
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rateLimitResult = checkRateLimit(
    getRateLimitKey(ip, 'generate-slot-captions'),
    SLOT_CAPTION_RATE_LIMIT,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED' },
      {
        status: 429,
        headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() },
      },
    );
  }

  // 요청 바디 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.', code: 'INVALID_JSON' },
      { status: 400 },
    );
  }

  // 입력값 검증
  let input: ValidatedInput;
  try {
    input = validateRequestBody(body);
  } catch (validationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          validationError instanceof Error ? validationError.message : '입력값 검증 실패',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  try {
    const client = getAnthropicClient();
    const slotKeys = Object.keys(input.slots);

    // Claude Vision content 배열 구성:
    // 슬롯 순서대로 "이미지 N (slotKey):" 레이블 텍스트 + 이미지 블록 교차 배치
    const imageContentBlocks: Parameters<
      typeof client.messages.create
    >[0]['messages'][0]['content'] = [];

    slotKeys.forEach((slotKey, idx) => {
      const slot = input.slots[slotKey];
      // 각 이미지 앞에 슬롯 레이블 삽입
      imageContentBlocks.push({
        type: 'text',
        text: `이미지 ${idx + 1} (${slotKey}):`,
      });
      imageContentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: slot.mimeType,
          data: slot.imageBase64,
        },
      });
    });

    // frameType에 따라 프롬프트 선택
    const promptText =
      input.frameType === 'custom_3col'
        ? build3ColPrompt(slotKeys)
        : buildGalleryPrompt(slotKeys);

    imageContentBlocks.push({ type: 'text', text: promptText });

    // Claude Vision API 호출
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: imageContentBlocks,
        },
      ],
    });

    // 응답 텍스트 추출
    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    // JSON 파싱 (jsonrepair로 불완전한 JSON 복구)
    let parsed: Record<string, unknown>;
    try {
      const repairedJson = jsonrepair(rawText);
      parsed = JSON.parse(repairedJson) as Record<string, unknown>;
    } catch {
      console.error('[/api/ai/generate-slot-captions] JSON 파싱 실패. 원본 응답:', rawText);
      return NextResponse.json(
        {
          success: false,
          error: 'AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.',
          code: 'PARSE_ERROR',
        },
        { status: 502 },
      );
    }

    // frameType별 metadata 변환 및 반환
    if (input.frameType === 'custom_3col') {
      const metadata = normalize3ColMetadata(parsed);
      return NextResponse.json({ success: true, data: { metadata } }, { status: 200 });
    } else {
      const metadata = transformGallerySlotsToCaptions(parsed);
      return NextResponse.json({ success: true, data: { metadata } }, { status: 200 });
    }
  } catch (error) {
    console.error('[/api/ai/generate-slot-captions] 처리 중 오류:', error);

    // 환경변수 누락 오류
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json(
        {
          success: false,
          error: '서버 설정 오류: AI API 키가 구성되지 않았습니다.',
          code: 'CONFIG_ERROR',
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : '슬롯 캡션 생성 중 알 수 없는 오류가 발생했습니다.',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
