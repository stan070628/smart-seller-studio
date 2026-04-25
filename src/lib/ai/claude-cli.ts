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

const execFileAsync = promisify(execFile);

// 모델 별칭 → 전체 모델 ID (API 폴백용)
const MODEL_IDS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
  haiku:  'claude-haiku-4-5-20251001',
};

/** CLI로 텍스트 응답을 얻는다. 실패 시 Error throw. */
async function callViaCLI(
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<string> {
  const args = ['--print', '--model', model];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  args.push(userPrompt);

  const { stdout } = await execFileAsync('claude', args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: 120_000,            // 120초 (CLI는 5~15초 소요)
  });

  return stdout.trim();
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
    return await callViaCLI(systemPrompt, userPrompt, model);
  } catch {
    // CLI 없음(Vercel 등) → API key 폴백
    return callViaSDK(systemPrompt, userPrompt, model, maxTokens);
  }
}
