'use client';

/**
 * Scene Studio — 프롬프트를 직접 붙여넣어 씬 이미지를 만드는 수동 도구.
 *
 * 왜 별도 화면인가:
 * detail-maker-pro의 자동 파이프라인은 Claude가 씬 프롬프트를 쓰고(sceneHint 600자),
 * 슬롯 구조에 묶여 있다. 반면 여기서는 외부에서 작성한 완성형 프롬프트를 그대로
 * Gemini에 보낸다(scenePrompt 직결 · 2000자 · Claude 우회). 워크플로가 다르므로
 * Pro 화면을 고치는 대신 독립 화면으로 둔다.
 *
 * 왜 Gemini 웹이 아니라 이 화면인가:
 * Gemini 웹/앱 출력에는 가시 워터마크가 붙는다. API 경로에는 붙지 않는다.
 *
 * 합성 모드(lifestyle/detail/feature)는 참조 이미지에서 누끼를 떠 배경 위에 얹는다.
 * 제품을 다시 그리지 않으므로 로고·자수가 보존된다. hero는 제품을 생성하므로
 * 로고가 있는 상품에서는 쓰지 않는다 — 아래 경고 참조.
 */

import { useState, useRef } from 'react';

type SectionType = 'hero' | 'lifestyle' | 'detail' | 'feature';

interface RefImage {
  base64: string;
  mimeType: string;
  previewUrl: string;
  name: string;
}

const MAX_PROMPT = 2000;
const MAX_REFS = 3;
/** 긴 변 상한. 원본 4000px 3장을 그대로 base64로 보내면 요청이 수 MB가 된다. */
const RESIZE_LONG_EDGE = 1536;

const COMPOSITE_SECTIONS: SectionType[] = ['lifestyle', 'detail', 'feature'];

const SECTION_LABEL: Record<SectionType, string> = {
  lifestyle: 'lifestyle — 배경 생성 + 제품 합성',
  detail: 'detail — 매크로 배경 + 제품 합성',
  feature: 'feature — 연출 배경 + 제품 합성',
  hero: 'hero — 제품까지 AI가 생성 (로고 상품 금지)',
};

// ── 스타일 (기존 Pro 화면의 다크 테마와 맞춤) ────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #33334a',
  background: '#1a1a26',
  color: '#e8e8f0',
  fontSize: 13,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#a0a0b0',
  display: 'block',
  marginBottom: 8,
};

const cardStyle: React.CSSProperties = {
  background: '#14141d',
  border: '1px solid #2a2a3a',
  borderRadius: 12,
  padding: 20,
};

/** 이미지를 긴 변 기준으로 축소하고 순수 base64(데이터 URL prefix 제거)를 돌려준다. */
async function fileToResizedBase64(
  file: File,
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const scale = Math.min(1, RESIZE_LONG_EDGE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 컨텍스트를 만들 수 없습니다.');
  ctx.drawImage(img, 0, 0, w, h);

  // PNG는 누끼 대상에서 알파가 유지돼야 하므로 원본이 PNG면 PNG로 둔다.
  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const outUrl = canvas.toDataURL(mimeType, 0.92);

  return {
    base64: outUrl.replace(/^data:[^;]+;base64,/, ''),
    mimeType,
    previewUrl: outUrl,
  };
}

export default function SceneStudioPage() {
  const [prompt, setPrompt] = useState('');
  const [sectionType, setSectionType] = useState<SectionType>('lifestyle');
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; mimeType: string } | null>(null);
  // 쿠팡은 이미지를 URL(vendorPath)로만 받는다 — base64 불가, 200자 제한.
  // 그래서 생성 결과를 Storage에 올려 공개 URL을 확보하는 단계가 필요하다.
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isComposite = COMPOSITE_SECTIONS.includes(sectionType);
  const overLimit = prompt.length > MAX_PROMPT;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_REFS - refs.length;
    if (room <= 0) {
      setError(`참조 이미지는 최대 ${MAX_REFS}장입니다.`);
      return;
    }
    try {
      const picked = Array.from(files).slice(0, room);
      const converted = await Promise.all(
        picked.map(async (f) => ({ ...(await fileToResizedBase64(f)), name: f.name })),
      );
      setRefs((prev) => [...prev, ...converted]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 읽지 못했습니다.');
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      setError('프롬프트를 입력하세요.');
      return;
    }
    if (overLimit) {
      setError(`프롬프트가 ${MAX_PROMPT}자를 넘습니다. 현재 ${prompt.length}자.`);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setHostedUrl(null);
    try {
      const res = await fetch('/api/ai/generate-scene-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionType,
          // 직결 경로: Claude를 거치지 않고 이 프롬프트가 그대로 Gemini로 간다.
          scenePrompt: prompt.trim(),
          ...(refs.length > 0 && {
            referenceImages: refs.map((r) => ({ base64: r.base64, mimeType: r.mimeType })),
          }),
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { imageBase64: string; mimeType: string };
      };
      if (!json.success || !json.data) {
        setError(json.error ?? `생성 실패 (HTTP ${res.status})`);
        return;
      }
      setResult({
        url: `data:${json.data.mimeType};base64,${json.data.imageBase64}`,
        mimeType: json.data.mimeType,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  /** 생성 결과를 Storage에 올려 쿠팡에 넣을 공개 URL을 만든다. */
  async function handleUpload() {
    if (!result) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/image/upload-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: result.url.replace(/^data:[^;]+;base64,/, ''),
          mimeType: result.mimeType.includes('png') ? 'image/png' : 'image/jpeg',
          role: sectionType,
        }),
      });
      const json = (await res.json()) as { success: boolean; url?: string; error?: string };
      if (!json.success || !json.url) {
        setError(json.error ?? `업로드 실패 (HTTP ${res.status})`);
        return;
      }
      setHostedUrl(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d14', color: '#e8e8f0', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Scene Studio</h1>
        <p style={{ fontSize: 13, color: '#8a8a9a', marginBottom: 24 }}>
          완성형 프롬프트를 그대로 Gemini에 보냅니다. Claude 재작성 단계를 거치지 않고,
          Gemini 웹과 달리 워터마크가 붙지 않습니다.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
          {/* ── 입력 ───────────────────────────────────────────── */}
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={labelStyle}>생성 모드</label>
              <select
                value={sectionType}
                onChange={(e) => setSectionType(e.target.value as SectionType)}
                style={inputStyle}
              >
                {(Object.keys(SECTION_LABEL) as SectionType[]).map((t) => (
                  <option key={t} value={t}>
                    {SECTION_LABEL[t]}
                  </option>
                ))}
              </select>

              {isComposite ? (
                <p style={{ fontSize: 12, color: '#6ac68a', marginTop: 8, lineHeight: 1.6 }}>
                  참조 이미지에서 제품 누끼를 떠 생성된 배경 위에 합성합니다.
                  <strong> 제품을 다시 그리지 않으므로 로고·자수가 보존됩니다.</strong>
                </p>
              ) : (
                <p style={{ fontSize: 12, color: '#e0a13c', marginTop: 8, lineHeight: 1.6 }}>
                  ⚠️ hero는 <strong>제품까지 AI가 새로 그립니다.</strong> 로고·자수·텍스트가 있는
                  상품에서는 형태가 깨지므로 쓰지 마세요.
                </p>
              )}
            </div>

            <div>
              <label style={labelStyle}>
                프롬프트{' '}
                <span style={{ color: overLimit ? '#e05c5c' : '#6a6a7a', fontWeight: 500 }}>
                  {prompt.length} / {MAX_PROMPT}
                </span>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={16}
                placeholder="영문 프롬프트를 붙여넣으세요. 배경만 생성하려면 제품을 묘사하지 않는 프롬프트여야 합니다."
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  lineHeight: 1.6,
                  borderColor: overLimit ? '#e05c5c' : '#33334a',
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>
                참조 이미지 ({refs.length}/{MAX_REFS})
                {isComposite && <span style={{ color: '#6a6a7a', fontWeight: 500 }}> — 누끼 대상</span>}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  void handleFiles(e.target.files);
                  e.target.value = '';
                }}
                style={{ ...inputStyle, padding: 8, fontSize: 12 }}
              />
              {refs.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {refs.map((r, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.previewUrl}
                        alt={r.name}
                        style={{
                          width: 88,
                          height: 88,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid #33334a',
                        }}
                      />
                      <button
                        onClick={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: 'none',
                          background: '#e05c5c',
                          color: '#fff',
                          fontSize: 12,
                          cursor: 'pointer',
                          lineHeight: 1,
                        }}
                        aria-label={`${r.name} 제거`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/*
              합성 모드인데 참조가 없으면 route가 누끼를 뜨지 못하고
              PRODUCT_FIDELITY_INSTRUCTION("제품을 렌더링하라")을 붙인다.
              배경 전용 프롬프트와 정면으로 모순되므로 반드시 알린다.
            */}
            {isComposite && refs.length === 0 && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#2a2416',
                  border: '1px solid #5c4c26',
                  color: '#e0c48c',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                참조 이미지가 없으면 누끼를 뜰 수 없어 <strong>배경 전용으로 생성되지 않습니다.</strong>{' '}
                대신 &ldquo;제품을 렌더링하라&rdquo;는 지시가 자동으로 붙어, 로고·자수가 있는 상품은
                형태가 깨집니다. 제품 사진을 1장 이상 첨부하세요.
              </div>
            )}

            <button
              onClick={() => void handleGenerate()}
              disabled={loading || overLimit || !prompt.trim()}
              style={{
                padding: '12px 20px',
                borderRadius: 8,
                border: 'none',
                background: loading || overLimit || !prompt.trim() ? '#33334a' : '#5b6ef5',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: loading || overLimit || !prompt.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '생성 중… (최대 2분)' : '이미지 생성'}
            </button>

            {error && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#2a1616',
                  border: '1px solid #5c2626',
                  color: '#f0a0a0',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* ── 결과 ───────────────────────────────────────────── */}
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={labelStyle}>결과</label>
            {result ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.url}
                  alt="생성된 씬"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid #2a2a3a' }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <a
                    href={result.url}
                    download={`scene-${sectionType}-${Date.now()}.${
                      result.mimeType.includes('png') ? 'png' : 'jpg'
                    }`}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: 8,
                      background: '#22223a',
                      color: '#c8c8e0',
                      fontSize: 13,
                      fontWeight: 600,
                      textAlign: 'center',
                      textDecoration: 'none',
                    }}
                  >
                    다운로드
                  </a>
                  <button
                    onClick={() => void handleGenerate()}
                    disabled={loading}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#22223a',
                      color: '#c8c8e0',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    같은 프롬프트로 재생성
                  </button>
                </div>

                {/* 쿠팡 등록용 URL — vendorPath는 URL만 받으며 200자를 넘으면 등록이 거부된다. */}
                {hostedUrl ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      background: '#16241a',
                      border: '1px solid #2c5c38',
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#8ac6a0', fontWeight: 700, marginBottom: 6 }}>
                      쿠팡 등록용 URL ({hostedUrl.length}자
                      {hostedUrl.length > 200 ? ' — 🔴 200자 초과, 등록 거부됨' : ''})
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#c8e0d0',
                        wordBreak: 'break-all',
                        fontFamily: 'ui-monospace, monospace',
                        marginBottom: 8,
                        lineHeight: 1.5,
                      }}
                    >
                      {hostedUrl}
                    </div>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(hostedUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#2c5c38',
                        color: '#dff0e4',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? '복사됨' : 'URL 복사'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => void handleUpload()}
                    disabled={uploading}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: uploading ? '#33334a' : '#2c5c38',
                      color: '#dff0e4',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: uploading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {uploading ? '업로드 중…' : '쿠팡 등록용 URL 만들기'}
                  </button>
                )}
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 320,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 10,
                  border: '1px dashed #2a2a3a',
                  color: '#5a5a6a',
                  fontSize: 13,
                }}
              >
                생성된 이미지가 여기에 표시됩니다
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
