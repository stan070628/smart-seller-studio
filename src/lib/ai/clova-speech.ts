/**
 * CLOVA Speech-to-Text API 래퍼
 * Naver CLOVA Speech API를 통해 음성을 텍스트로 변환합니다.
 */

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const keyId = process.env.NAVER_CLOVA_SPEECH_API_KEY_ID;
  const apiKey = process.env.NAVER_CLOVA_SPEECH_API_KEY;

  if (!keyId || !apiKey) {
    throw new Error('[CLOVA Speech] 환경변수가 설정되지 않았습니다.');
  }

  const arrayBuffer = await audioBlob.arrayBuffer();

  const response = await fetch(
    'https://naveropenapi.apigw.ntruss.com/recog/v1/stt?lang=Kor',
    {
      method: 'POST',
      headers: {
        'X-NCP-APIGW-API-KEY-ID': keyId,
        'X-NCP-APIGW-API-KEY': apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: arrayBuffer,
    }
  );

  if (!response.ok) {
    throw new Error(`CLOVA Speech API 오류: ${response.status}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text ?? '';
}
