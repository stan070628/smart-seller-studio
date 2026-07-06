/**
 * Claude CLI subprocess wrapper
 *
 * 로컬 환경: `claude --print` (Claude Code OAuth — 구독 한도 내 무료)
 * 배포 환경: ANTHROPIC_API_KEY 폴백
 *
 * 주의: --bare 플래그 절대 사용 금지 (OAuth 세션 끊김)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

export interface ClaudeImage {
  base64: string;
  mimeType: string;
}

// 모델 별칭 → 전체 모델 ID (API 폴백용)
const MODEL_IDS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
  haiku:  'claude-haiku-4-5-20251001',
};

/** CLI로 텍스트 응답을 얻는다. 실패 시 Error throw. */
async function callViaCLI(
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<string> {
  const args = ['--print', '--output-format', 'json', '--model', model];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  args.push(userPrompt);

  const { stdout } = await execFileAsync('claude', args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });

  // --output-format json → { type, result, is_error, ... }
  let parsed: { result?: string; is_error?: boolean; api_error_status?: string };
  try {
    parsed = JSON.parse(stdout.trim()) as typeof parsed;
  } catch {
    // --output-format json이 적용 안 된 경우(구버전 캐시 등) → raw stdout 그대로 반환
    if (stdout.trim()) return stdout.trim();
    throw new Error('Claude CLI: 빈 stdout');
  }
  if (parsed.is_error) {
    throw new Error(`Claude CLI error: ${parsed.api_error_status ?? 'unknown'}`);
  }
  return (parsed.result ?? '').trim();
}

/** Anthropic SDK로 텍스트 응답을 얻는다. */
async function callViaSDK(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  maxTokens = 4096,
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');

  const client = new Anthropic({ apiKey });
  const modelId = MODEL_IDS[model] ?? model;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemPrompt || undefined,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
}

/**
 * Claude 호출 — CLI 우선, 실패 시 API key 폴백.
 *
 * @param systemPrompt 시스템 프롬프트
 * @param userPrompt   유저 프롬프트
 * @param model        'sonnet' | 'opus' | 'haiku'
 * @param maxTokens    SDK 폴백 시 max_tokens (CLI는 무시됨)
 */
export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  model: 'sonnet' | 'opus' | 'haiku' = 'sonnet',
  maxTokens = 4096,
): Promise<string> {
  try {
    const result = await callViaCLI(systemPrompt, userPrompt, model);
    console.log('[claude-cli] CLI 성공, result length:', result.length);
    return result;
  } catch (err) {
    // CLI 없음(Vercel 등) → API key 폴백
    console.warn('[claude-cli] CLI 실패 → SDK 폴백. 원인:', err instanceof Error ? err.message : String(err));
    return callViaSDK(systemPrompt, userPrompt, model, maxTokens);
  }
}

// ─── 비전(이미지 포함) 호출 ────────────────────────────────────────────────

type MediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** CLI: 이미지를 임시 파일로 쓰고 프롬프트에 경로를 참조시킨다(Claude Code가 파일을 읽음). */
async function callViaCLIWithImages(
  systemPrompt: string,
  userPrompt: string,
  images: ClaudeImage[],
  model: string,
): Promise<string> {
  const paths: string[] = [];
  try {
    for (const img of images) {
      const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
      const p = join(tmpdir(), `pro-ref-${randomUUID()}.${ext}`);
      await writeFile(p, Buffer.from(img.base64, 'base64'));
      paths.push(p);
    }
    const refText = paths.map((p, i) => `이미지 ${i}: ${p}`).join('\n');
    const prompt = `${userPrompt}\n\n[첨부 제품 이미지 파일 — 인덱스 0부터. 각 파일을 열어 실제 색상·형태·디테일을 확인하라]\n${refText}`;
    return await callViaCLI(systemPrompt, prompt, model);
  } finally {
    await Promise.all(paths.map((p) => unlink(p).catch(() => {})));
  }
}

/** SDK: base64 이미지를 content 블록으로 전달. */
async function callViaSDKWithImages(
  systemPrompt: string,
  userPrompt: string,
  images: ClaudeImage[],
  model: string,
  maxTokens: number,
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');

  const client = new Anthropic({ apiKey });
  const modelId = MODEL_IDS[model] ?? model;

  type Block =
    | { type: 'image'; source: { type: 'base64'; media_type: MediaType; data: string } }
    | { type: 'text'; text: string };
  const content: Block[] = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: (img.mimeType as MediaType) ?? 'image/jpeg', data: img.base64 },
  }));
  content.push({ type: 'text', text: `${userPrompt}\n\n[위 이미지들은 제품 참고 이미지 — 인덱스 0부터 순서대로]` });

  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemPrompt || undefined,
    messages: [{ role: 'user', content }],
  });
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
}

/**
 * 이미지 포함 Claude 호출 — CLI 우선(로컬 Claude Max), 실패 시 SDK 폴백.
 * images가 비면 텍스트 전용 callClaude로 위임한다.
 */
export async function callClaudeVision(
  systemPrompt: string,
  userPrompt: string,
  images: ClaudeImage[],
  model: 'sonnet' | 'opus' | 'haiku' = 'opus',
  maxTokens = 4096,
): Promise<string> {
  if (!images.length) return callClaude(systemPrompt, userPrompt, model, maxTokens);
  try {
    const result = await callViaCLIWithImages(systemPrompt, userPrompt, images, model);
    console.log('[claude-cli] vision CLI 성공, result length:', result.length);
    return result;
  } catch (err) {
    console.warn('[claude-cli] vision CLI 실패 → SDK 폴백. 원인:', err instanceof Error ? err.message : String(err));
    return callViaSDKWithImages(systemPrompt, userPrompt, images, model, maxTokens);
  }
}
