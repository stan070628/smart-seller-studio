// 유튜브 URL 파싱 — videoId 추출 + Shorts 여부로 비율 추정
export interface ParsedYoutube {
  videoId: string;
  aspect: 'vertical' | 'horizontal';
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeUrl(raw: string): ParsedYoutube | null {
  if (!raw || typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  let videoId = '';
  let aspect: 'vertical' | 'horizontal' = 'horizontal';

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'shorts' && parts[1]) {
      videoId = parts[1];
      aspect = 'vertical';
    } else if (parts[0] === 'embed' && parts[1]) {
      videoId = parts[1];
    } else {
      videoId = url.searchParams.get('v') ?? '';
    }
  } else {
    return null;
  }

  if (!ID_RE.test(videoId)) return null;
  return { videoId, aspect };
}
