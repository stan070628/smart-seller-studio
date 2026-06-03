'use client';

/**
 * ImageInputSection.tsx
 * URL 직접 입력 + 파일 업로드를 탭으로 통합하는 이미지 입력 섹션
 *
 * - "파일 업로드" / "URL 직접 입력" 2탭 구조
 * - 탭 전환 시 url 배열은 공유 — 데이터 유실 없음
 * - 파일 업로드: POST /api/listing/upload-image (multipart/form-data)
 *   성공 → 반환된 url을 onUrlsChange로 추가
 *   실패 → 에러 메시지 표시 (해결 힌트 포함)
 * - URL 입력: textarea 줄바꿈 구분 (기존 방식 유지)
 */

import React, { useState, useCallback } from 'react';
import ImageDropZone from './ImageDropZone';
import UploadedImageList, { type UploadedImageItem } from './UploadedImageList';

// ─── 색상 상수 (BothRegisterForm 동일) ────────────────────────────────────────
const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  card: '#ffffff',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '6px',
};

// ─── 업로드 API 응답 타입 ─────────────────────────────────────────────────────
interface UploadSuccessData {
  url: string;
  assetId: string;
  fileName: string;
  fileSize: number;
}

interface UploadApiResponse {
  success: boolean;
  data?: UploadSuccessData;
  error?: string;
  code?: string;
}

// ─── 에러 코드 → 사용자 안내 메시지 매핑 ──────────────────────────────────────
function resolveUploadErrorMessage(error?: string, code?: string): string {
  if (code === 'FILE_TOO_LARGE') return '파일 크기를 10MB 이하로 줄여주세요.';
  if (code === 'UNSUPPORTED_FORMAT') return 'JPG, PNG, WEBP 형식만 지원합니다.';
  if (code === 'UPLOAD_LIMIT_EXCEEDED') return '최대 업로드 개수를 초과했습니다.';
  if (error) return error;
  return '업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface ImageInputSectionProps {
  label: string;
  required?: boolean;
  maxCount: number;
  urls: string[];
  onUrlsChange: (urls: string[]) => void;
  usageContext: 'listing_thumbnail' | 'listing_detail';
  error?: string;
}

type TabKey = 'upload' | 'url';

// ─── 로컬 이미지 항목 (업로드 진행 추적용) ────────────────────────────────────
interface LocalImageEntry extends UploadedImageItem {
  // url이 비어있을 수 있는 업로드 대기 상태를 구분하기 위한 로컬 id
  localId: string;
}

export default function ImageInputSection({
  label,
  required,
  maxCount,
  urls,
  onUrlsChange,
  usageContext,
  error,
}: ImageInputSectionProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('upload');
  // 업로드 탭에서 관리하는 로컬 항목 목록 (url 배열과 1:1 대응)
  const [localItems, setLocalItems] = useState<LocalImageEntry[]>(() =>
    urls.map((url) => ({
      localId: url,
      url,
      status: 'ready',
    })),
  );
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // URL 탭 textarea의 원본 텍스트 (urls 배열과 분리해 관리)
  const [rawUrlText, setRawUrlText] = useState(() => urls.join('\n'));

  // ─── URL 탭 입력 처리 ───────────────────────────────────────────────────
  const handleUrlTextChange = (raw: string) => {
    setRawUrlText(raw);
    // http(s)://로 시작하는 줄만 유효 URL로 파싱
    const parsed = raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    onUrlsChange(parsed);
    setLocalItems(
      parsed.map((url) => ({
        localId: url,
        url,
        status: 'ready',
      })),
    );
  };

  // ─── 파일 업로드 처리 ───────────────────────────────────────────────────
  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      // 업로드 대기 항목 추가 (url은 임시 objectURL 사용 — 미리보기 목적)
      const pendingEntries: LocalImageEntry[] = selectedFiles.map((file) => ({
        localId: `pending-${Date.now()}-${file.name}`,
        url: URL.createObjectURL(file),
        fileName: file.name,
        status: 'uploading',
      }));

      setLocalItems((prev) => [...prev, ...pendingEntries]);
      setIsUploading(true);
      setUploadErrors([]);

      // 순차 업로드 (병렬 업로드 시 서버 부하 방지)
      const newErrors: string[] = [];
      // urls는 렌더 시점 스냅샷이므로 변이용 임시 배열 사용
      const addedUrls: string[] = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const pending = pendingEntries[i];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('usageContext', usageContext);

        try {
          const res = await fetch('/api/listing/upload-image', {
            method: 'POST',
            body: formData,
          });
          const json: UploadApiResponse = await res.json();

          if (!res.ok || !json.success || !json.data) {
            throw { error: json.error, code: json.code };
          }

          const { url, assetId, fileName: uploadedFileName } = json.data;

          // objectURL 해제 후 실제 URL로 교체
          URL.revokeObjectURL(pending.url);

          setLocalItems((prev) =>
            prev.map((item) =>
              item.localId === pending.localId
                ? { ...item, url, assetId, fileName: uploadedFileName, status: 'ready' }
                : item,
            ),
          );

          addedUrls.push(url);
        } catch (err: unknown) {
          const e = err as { error?: string; code?: string };
          const message = resolveUploadErrorMessage(e.error, e.code);
          newErrors.push(`${file.name}: ${message}`);

          // 해당 항목을 error 상태로 전환
          setLocalItems((prev) =>
            prev.map((item) =>
              item.localId === pending.localId ? { ...item, status: 'error' } : item,
            ),
          );
        }
      }

      // 성공한 URL만 store에 추가
      if (addedUrls.length > 0) {
        onUrlsChange([...urls, ...addedUrls]);
      }

      if (newErrors.length > 0) {
        setUploadErrors(newErrors);
      }
      setIsUploading(false);
    },
    [urls, onUrlsChange, usageContext],
  );

  // ─── 이미지 제거 ─────────────────────────────────────────────────────────
  const handleRemove = useCallback(
    (index: number) => {
      const item = localItems[index];
      // objectURL이면 메모리 해제
      if (item.url.startsWith('blob:')) {
        URL.revokeObjectURL(item.url);
      }
      const nextItems = localItems.filter((_, i) => i !== index);
      setLocalItems(nextItems);

      // ready 상태 항목만 urls에 반영
      const nextUrls = nextItems
        .filter((it) => it.status === 'ready' && !it.url.startsWith('blob:'))
        .map((it) => it.url);
      onUrlsChange(nextUrls);
    },
    [localItems, onUrlsChange],
  );

  // ─── 탭 전환 ─────────────────────────────────────────────────────────────
  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setUploadErrors([]);
  };

  // 현재 업로드 완료된(ready) 이미지 수
  const readyCount = urls.length;

  return (
    <div>
      {/* 레이블 */}
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: C.accent, marginLeft: '2px' }}>*</span>}
      </label>

      {/* 탭 바 */}
      <div
        style={{
          display: 'flex',
          gap: '0',
          marginBottom: '12px',
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          overflow: 'hidden',
          width: 'fit-content',
        }}
      >
        {(['upload', 'url'] as TabKey[]).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              style={{
                padding: '6px 16px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.accent : C.textSub,
                backgroundColor: isActive ? 'rgba(190,0,20,0.06)' : C.card,
                border: 'none',
                cursor: 'pointer',
                borderRight: tab === 'upload' ? `1px solid ${C.border}` : 'none',
                transition: 'background-color 0.12s ease, color 0.12s ease',
              }}
            >
              {tab === 'upload' ? '파일 업로드' : 'URL 직접 입력'}
            </button>
          );
        })}
      </div>

      {/* ── 파일 업로드 탭 ──────────────────────────────────────────────────── */}
      {activeTab === 'upload' && (
        <div>
          <ImageDropZone
            onFilesSelected={handleFilesSelected}
            maxCount={maxCount}
            currentCount={readyCount}
            isUploading={isUploading}
          />

          {/* 업로드 에러 메시지 */}
          {uploadErrors.length > 0 && (
            <div
              style={{
                marginTop: '8px',
                padding: '10px 14px',
                backgroundColor: '#fee2e2',
                borderRadius: '8px',
                border: '1px solid #fca5a5',
              }}
            >
              {uploadErrors.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '12px',
                    color: '#b91c1c',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    marginBottom: i < uploadErrors.length - 1 ? '4px' : 0,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>⚠</span>
                  <span>{msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* 업로드된 이미지 목록 */}
          <UploadedImageList items={localItems} onRemove={handleRemove} />
        </div>
      )}

      {/* ── URL 직접 입력 탭 ────────────────────────────────────────────────── */}
      {activeTab === 'url' && (
        <div>
          <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
            URL을 줄바꿈으로 구분 · 첫 번째가 대표이미지 · 최대 {maxCount}개
          </div>
          <textarea
            style={{
              ...inputStyle,
              height: '80px',
              resize: 'vertical',
              borderColor: error ? '#b91c1c' : C.border,
            }}
            value={rawUrlText}
            onChange={(e) => handleUrlTextChange(e.target.value)}
            placeholder={`https://example.com/image1.jpg\nhttps://example.com/image2.jpg`}
          />

          {/* URL 탭 미리보기 */}
          {urls.length > 0 && (
            <UploadedImageList
              items={urls.map((url) => ({ url, status: 'ready', localId: url }))}
              onRemove={(index) => {
                const nextUrls = urls.filter((_, i) => i !== index);
                onUrlsChange(nextUrls);
                setLocalItems(nextUrls.map((url) => ({ localId: url, url, status: 'ready' })));
              }}
            />
          )}
        </div>
      )}

      {/* 폼 에러 메시지 */}
      {error && (
        <div
          style={{
            fontSize: '11px',
            color: '#b91c1c',
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
