/**
 * Claude structured outputs 응답에서 텍스트를 꺼내 JSON으로 파싱한다.
 *
 * `stop_reason`을 먼저 보지 않고 바로 JSON.parse를 하면, 잘리거나 거부된 응답이
 * "JSON이 아닙니다" 한 줄로 뭉개져 원인(예산 부족인지 콘텐츠 거부인지)을 알 수 없다.
 * 네이버·1688 판독 두 곳에서 같은 응답 형태를 다루므로 여기 한 곳에 모은다.
 */
export function readStructuredText(response: {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
}): unknown {
  if (response.stop_reason === 'max_tokens') {
    throw new Error('판독 출력이 잘렸습니다 (max_tokens)');
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('판독이 거부됐습니다 (refusal)');
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error('판독 결과가 비어 있습니다');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`판독 결과가 JSON이 아닙니다: ${text.slice(0, 200)}`);
  }
}
