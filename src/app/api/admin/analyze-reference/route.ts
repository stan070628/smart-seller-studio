/**
 * POST /api/admin/analyze-reference
 *
 * 관리자 레퍼런스 학습: 레퍼런스 이미지를 Claude로 분석하여
 * 각 템플릿 코드의 스타일 개선안(proposedCode)을 반환합니다.
 *
 * 처리 흐름:
 * 1. Zod 요청 바디 검증 (URL 또는 base64 중 하나 필수)
 * 2. 이미지 준비
 *    - referenceImageUrl 방식: fetch → ArrayBuffer → base64 변환 + magic bytes 검증
 *    - referenceImageBase64 방식: data URL prefix 제거 후 그대로 사용
 * 3. targetTemplates를 3개씩 배치로 분할
 * 4. 배치별 readTemplateFile → Claude claude-opus-4-6 호출
 * 5. 응답 JSON 파싱 후 배치 결과 병합
 * 6. AnalyzeReferenceResponse 반환
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { readTemplateFile, getTemplatePath } from '@/lib/admin/template-io';
import {
  REFERENCE_ANALYSIS_SYSTEM_PROMPT,
  buildReferenceUserPrompt,
} from '@/lib/ai/prompts/reference-analysis';
import type {
  AnalyzeReferenceResponse,
  TemplateProposal,
} from '@/types/admin';
import type { FrameType } from '@/types/frames';
import path from 'path';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 13개 메인 프레임 타입 리터럴 목록 (custom_* 제외) */
const MAIN_FRAME_TYPES = [
  'hero',
  'pain_point',
  'solution',
  'usp',
  'detail_1',
  'detail_2',
  'how_to_use',
  'before_after',
  'target',
  'spec',
  'faq',
  'social_proof',
  'cta',
] as const;

/** Claude에 한 번에 전달할 배치 크기 */
const BATCH_SIZE = 3;

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const RequestSchema = z
  .object({
    /** URL 입력 방식 */
    referenceImageUrl: z.string().url('유효한 이미지 URL을 입력해주세요.').optional(),
    /** 파일 업로드 방식: data URL 또는 raw base64 */
    referenceImageBase64: z.string().optional(),
    /** 파일 업로드 방식일 때 MIME 타입 (image/jpeg 등) */
    referenceImageMimeType: z.string().optional(),
    /** 화면 표시용 소스 레이블 */
    referenceSource: z.string().min(1, 'referenceSource가 필요합니다.'),
    /** 분석할 프레임 타입 목록 */
    targetTemplates: z
      .array(z.enum(MAIN_FRAME_TYPES))
      .min(1, '최소 1개 이상의 템플릿을 지정해야 합니다.')
      .max(13, '템플릿은 최대 13개까지 지정할 수 있습니다.'),
  })
  .refine(
    (d) => d.referenceImageUrl || d.referenceImageBase64,
    { message: 'referenceImageUrl 또는 referenceImageBase64 중 하나는 필수입니다.' }
  );

// ─────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────

/** Claude vision API가 허용하는 이미지 MIME 타입 */
type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * URL로부터 이미지를 fetch하여 base64 문자열과 MIME 타입을 반환합니다.
 * magic bytes로 실제 이미지 형식을 재검증합니다.
 */
async function fetchImageAsBase64(
  url: string
): Promise<{ base64: string; mimeType: AllowedMimeType }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000), // 15초 타임아웃
  });

  if (!response.ok) {
    throw new Error(
      `[analyze-reference] 이미지 fetch 실패: HTTP ${response.status} (${url})`
    );
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // magic bytes로 실제 이미지 포맷 감지
  let mimeType: AllowedMimeType;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = 'image/jpeg';
  } else if (
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    mimeType = 'image/png';
  } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    mimeType = 'image/gif';
  } else if (
    bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    mimeType = 'image/webp';
  } else {
    throw new Error(
      '[analyze-reference] 지원하지 않는 이미지 형식입니다. JPEG, PNG, GIF, WebP만 허용됩니다.'
    );
  }

  const base64 = Buffer.from(buffer).toString('base64');
  return { base64, mimeType };
}

/**
 * base64 문자열에서 data URL prefix(data:image/...;base64,)를 제거하고
 * raw base64와 MIME 타입을 반환합니다.
 * prefix가 없으면 인자로 전달된 mimeType을 그대로 사용합니다.
 */
function normalizeBase64Input(
  raw: string,
  fallbackMimeType: string | undefined
): { base64: string; mimeType: AllowedMimeType } {
  const ALLOWED: AllowedMimeType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  // data URL 형태인지 확인 (data:image/jpeg;base64,xxxx)
  // 's' 플래그 대신 [\s\S]+ 패턴으로 개행 포함 매칭 (ES2017 호환)
  const dataUrlMatch = raw.match(/^data:(image\/[a-z+]+);base64,([\s\S]+)$/);

  let detectedMime: string;
  let base64: string;

  if (dataUrlMatch) {
    detectedMime = dataUrlMatch[1];
    base64 = dataUrlMatch[2];
  } else {
    // raw base64: fallbackMimeType 의존
    detectedMime = fallbackMimeType ?? '';
    base64 = raw;
  }

  if (!ALLOWED.includes(detectedMime as AllowedMimeType)) {
    throw new Error(
      `[analyze-reference] 지원하지 않는 이미지 MIME 타입: "${detectedMime}". ` +
      'JPEG, PNG, GIF, WebP만 허용됩니다.'
    );
  }

  return { base64, mimeType: detectedMime as AllowedMimeType };
}

/**
 * Claude 응답 텍스트에서 코드 펜스를 제거하고 JSON을 파싱합니다.
 */
function parseClaudeJsonResponse(raw: string): unknown {
  // ```json ... ``` 또는 ``` ... ``` 형태의 코드 펜스 제거
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  return JSON.parse(stripped);
}

/**
 * Claude가 반환한 배열 원소를 TemplateProposal 형태로 정규화합니다.
 */
function normalizeProposal(
  raw: unknown,
  frameType: FrameType,
  currentCode: string
): TemplateProposal {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[analyze-reference] 제안 데이터 형식 오류: frameType=${frameType}`);
  }

  const item = raw as Record<string, unknown>;

  return {
    frameType,
    templateFileName: path.basename(getTemplatePath(frameType)),
    currentCode,
    proposedCode:
      typeof item.proposedCode === 'string' ? item.proposedCode : currentCode,
    changeSummary:
      typeof item.changeSummary === 'string' ? item.changeSummary : '',
    diffHighlights: Array.isArray(item.diffHighlights)
      ? (item.diffHighlights as { lineRange: string; description: string }[])
      : [],
  };
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 요청 바디 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 }
    );
  }

  // Zod 검증
  const validated = RequestSchema.safeParse(body);
  if (!validated.success) {
    const message = validated.error.issues[0]?.message ?? '입력값 검증 실패';
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  const {
    referenceImageUrl,
    referenceImageBase64,
    referenceImageMimeType,
    targetTemplates,
  } = validated.data;

  // 이미지 준비: URL 방식 또는 base64 방식
  let imageBase64: string;
  let imageMimeType: AllowedMimeType;

  try {
    if (referenceImageUrl) {
      // URL 방식: fetch → ArrayBuffer → base64 + magic bytes 검증
      const result = await fetchImageAsBase64(referenceImageUrl);
      imageBase64 = result.base64;
      imageMimeType = result.mimeType;
    } else {
      // base64 방식: data URL prefix 제거 후 MIME 타입 추출
      const result = normalizeBase64Input(
        referenceImageBase64!,
        referenceImageMimeType
      );
      imageBase64 = result.base64;
      imageMimeType = result.mimeType;
    }
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error
          ? err.message
          : '레퍼런스 이미지를 처리하는 중 오류가 발생했습니다.',
      },
      { status: 400 }
    );
  }

  // ANTHROPIC_API_KEY 검증
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return Response.json(
      { success: false, error: '서버 설정 오류: ANTHROPIC_API_KEY가 구성되지 않았습니다.' },
      { status: 503 }
    );
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // targetTemplates를 BATCH_SIZE개씩 분할
  const batches: FrameType[][] = [];
  for (let i = 0; i < targetTemplates.length; i += BATCH_SIZE) {
    batches.push(targetTemplates.slice(i, i + BATCH_SIZE) as FrameType[]);
  }

  const allProposals: TemplateProposal[] = [];
  // referenceAnalysis는 첫 배치에서만 추출하고 이후 배치에서는 재사용합니다
  let referenceAnalysis: AnalyzeReferenceResponse['data']['referenceAnalysis'] | null = null;

  for (const batch of batches) {
    // 배치 내 각 프레임 코드 읽기
    const templateInputs: { frameType: string; code: string }[] = [];
    const codeMap = new Map<FrameType, string>();

    for (const frameType of batch) {
      try {
        const code = await readTemplateFile(frameType);
        templateInputs.push({ frameType, code });
        codeMap.set(frameType, code);
      } catch (err) {
        console.error(`[analyze-reference] ${frameType} 파일 읽기 실패:`, err);
        // 개별 파일 오류는 건너뛰고 계속 진행
        continue;
      }
    }

    if (templateInputs.length === 0) {
      continue;
    }

    // 첫 배치에서만 referenceAnalysis 필드를 함께 요청합니다
    const isFirstBatch = referenceAnalysis === null;
    const userPromptText = isFirstBatch
      ? `${buildReferenceUserPrompt(templateInputs)}\n\n추가로, 레퍼런스 이미지 전체 분석 결과를 다음 JSON 최상위 필드로 함께 반환하세요:\n"referenceAnalysis": { "layoutStyle": string, "colorPalette": string[], "typographyNotes": string, "compositionNotes": string }\n\n따라서 최종 출력은 배열이 아닌 아래 객체 형식으로 반환하세요:\n{ "referenceAnalysis": { ... }, "proposals": [ ... ] }`
      : buildReferenceUserPrompt(templateInputs);

    let rawText = '';
    try {
      const claudeResponse = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 32000,
        system: REFERENCE_ANALYSIS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              // 레퍼런스 이미지 (base64 블록)
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageMimeType,
                  data: imageBase64,
                },
              },
              // 분석 지시 텍스트
              {
                type: 'text',
                text: userPromptText,
              },
            ],
          },
        ],
      });

      rawText = claudeResponse.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('');
    } catch (err) {
      console.error(
        `[analyze-reference] Claude API 호출 실패 (배치: ${batch.join(', ')}):`,
        err
      );
      return Response.json(
        {
          success: false,
          error: err instanceof Error
            ? `AI 분석 중 오류가 발생했습니다: ${err.message}`
            : 'AI 분석 중 알 수 없는 오류가 발생했습니다.',
        },
        { status: 502 }
      );
    }

    // JSON 파싱
    let parsedResponse: unknown;
    try {
      parsedResponse = parseClaudeJsonResponse(rawText);
    } catch {
      console.error('[analyze-reference] JSON 파싱 실패. 원본 응답:', rawText.slice(0, 500));
      return Response.json(
        { success: false, error: 'AI 응답을 JSON으로 파싱할 수 없습니다.' },
        { status: 502 }
      );
    }

    // 첫 배치: referenceAnalysis 추출 및 proposals 파싱
    let proposals: unknown[];
    if (isFirstBatch && parsedResponse !== null && typeof parsedResponse === 'object' && !Array.isArray(parsedResponse)) {
      const obj = parsedResponse as Record<string, unknown>;

      if (obj.referenceAnalysis && typeof obj.referenceAnalysis === 'object') {
        const ra = obj.referenceAnalysis as Record<string, unknown>;
        referenceAnalysis = {
          layoutStyle: typeof ra.layoutStyle === 'string' ? ra.layoutStyle : '',
          colorPalette: Array.isArray(ra.colorPalette) ? (ra.colorPalette as string[]) : [],
          typographyNotes: typeof ra.typographyNotes === 'string' ? ra.typographyNotes : '',
          compositionNotes: typeof ra.compositionNotes === 'string' ? ra.compositionNotes : '',
        };
      }

      proposals = Array.isArray(obj.proposals) ? obj.proposals : [];
    } else if (Array.isArray(parsedResponse)) {
      proposals = parsedResponse;
    } else {
      proposals = [];
    }

    // 각 제안 정규화 및 누적
    for (let i = 0; i < templateInputs.length; i++) {
      const frameType = batch[i] as FrameType;
      const currentCode = codeMap.get(frameType) ?? '';
      const rawItem = proposals[i];

      try {
        const proposal = normalizeProposal(rawItem, frameType, currentCode);
        allProposals.push(proposal);
      } catch (err) {
        console.error(`[analyze-reference] 제안 정규화 실패 (${frameType}):`, err);
        // 정규화 실패 시 현재 코드를 그대로 반환하는 폴백
        allProposals.push({
          frameType,
          templateFileName: `${frameType}Template.tsx`,
          currentCode,
          proposedCode: currentCode,
          changeSummary: '분석 중 오류가 발생하여 변경 사항이 없습니다.',
          diffHighlights: [],
        });
      }
    }
  }

  // referenceAnalysis가 첫 배치에서 추출되지 않은 경우 기본값 사용
  if (!referenceAnalysis) {
    referenceAnalysis = {
      layoutStyle: '분석 결과를 가져올 수 없습니다.',
      colorPalette: [],
      typographyNotes: '',
      compositionNotes: '',
    };
  }

  const successResponse: AnalyzeReferenceResponse = {
    success: true,
    data: {
      referenceAnalysis,
      templateProposals: allProposals,
    },
  };

  return Response.json(successResponse, { status: 200 });
}
