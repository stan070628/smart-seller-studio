const TELEGRAM_API = 'https://api.telegram.org';

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN 환경변수 미설정');
  return token;
}

/** 텔레그램 채팅에 텍스트 메시지 전송 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' | undefined = undefined,
): Promise<void> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[telegram] sendMessage 실패 (${res.status}): ${body}`);
  }
}

/** getFile이 돌려주는 봇 서버 내 파일 경로 */
export async function getTelegramFilePath(fileId: string): Promise<string> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const body = (await res.json()) as { ok: boolean; result?: { file_path?: string }; description?: string };
  if (!body.ok || !body.result?.file_path) {
    throw new Error(`getFile 실패: ${body.description ?? res.status}`);
  }
  return body.result.file_path;
}

/**
 * 텔레그램 서버에서 파일 본체를 내려받는다.
 *
 * 🔴 Bot API는 다운로드를 20MB로 제한한다. 초과분은 getFile 단계에서 거부되므로
 *    호출 전에 file_size를 확인해 사용자에게 알리는 편이 낫다.
 */
export async function downloadTelegramFile(filePath: string): Promise<ArrayBuffer> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`파일 다운로드 실패 (${res.status})`);
  return res.arrayBuffer();
}
