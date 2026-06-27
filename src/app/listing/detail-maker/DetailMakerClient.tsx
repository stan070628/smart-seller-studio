'use client';

import React, { useState, useRef, useEffect } from 'react';
import { C } from '@/lib/design-tokens';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
import { contentToSections, mobileContentToSections, distributeImagesToSections } from '@/lib/detail-page/section-parser';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';
import DetailMakerThumbnailGallery from '@/components/listing/detail-maker/DetailMakerThumbnailGallery';
import DetailPlanReview from '@/components/listing/detail-maker/DetailPlanReview';
import { buildStoryboardWithSectionIds } from '@/lib/detail-page/storyboard-mapping';
import { generateCoupangThumbnail, editThumbnail, type TextBadgeOptions } from '@/lib/detail-page/thumbnail-flow';
import { getMoodPreset } from '@/lib/detail-page/mood-presets';
import type { DetailSection, DetailPageTheme, CreativeBrief, SceneStoryboardItem } from '@/types/detail-page';
import type { DetailPageContent, MobileDetailPageContent } from '@/lib/ai/prompts/detail-page';

type Category = 'basic' | 'fashion' | 'living' | 'food';

export default function DetailMakerClient() {
  // 입력
  const [productName, setProductName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState<Category>('basic');
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // 결과
  const [sections, setSections] = useState<DetailSection[]>([]);
  const [theme, setTheme] = useState<DetailPageTheme>({ ...DEFAULT_THEME, layoutMode: 'mobile' });
  const [generatedHtml, setGeneratedHtml] = useState<string>('');

  // 진행 상태
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 씬 생성 취소용 — 새 생성 요청 시 이전 결과 무시
  const sceneGenIdRef = useRef(0);

  // 무드 추천 취소용 — 새 추천 요청 시 이전(느린) 응답 무시
  const suggestMoodIdRef = useRef(0);

  // 씬 편집 상태
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sceneEditError, setSceneEditError] = useState<{ sectionId: string; message: string } | null>(null);
  const sceneEditIdRef = useRef(0);
  const prevSceneUrls = useRef<Map<string, string>>(new Map());

  // 크리에이티브 브리프
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief | null>(null);
  const [suggestedMoodIds, setSuggestedMoodIds] = useState<string[]>([]);
  const [isSuggestingMood, setIsSuggestingMood] = useState(false);

  // 참고 텍스트
  const [referenceText, setReferenceText] = useState('');

  // 스토리보드 (2단계 흐름)
  const [storyboard, setStoryboard] = useState<SceneStoryboardItem[] | null>(null);
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);

  type DetailStep = 'idle' | 'generating' | 'planning' | 'editing';
  const [detailStep, setDetailStep] = useState<DetailStep>('idle');

  // sections와 storyboard가 모두 준비되면 sectionId 매핑 수행
  // (HTML이 먼저 오거나 storyboard가 먼저 오는 레이스 컨디션 대응)
  useEffect(() => {
    if (sections.length === 0 || !storyboard || storyboard.length === 0) return;
    if (storyboard.every(s => s.sectionId !== null)) return;
    setStoryboard(prev => {
      if (!prev) return prev;
      return buildStoryboardWithSectionIds(prev, sections);
    });
  }, [sections, storyboard]);

  // 썸네일
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [editingThumbnailUrl, setEditingThumbnailUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  // 썸네일 탭 전용 참조 이미지
  const [thumbnailExtraUrls, setThumbnailExtraUrls] = useState<string[]>([]);
  const [uploadingThumbnailRef, setUploadingThumbnailRef] = useState(false);

  // ─── 이미지 업로드 ──────────────────────────────────────────────────────────
  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('usageContext', 'listing_detail');
    const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? `업로드 실패 (${res.status})`);
    return json.data.url as string;
  }

  async function handleUploadFiles(files: FileList | File[]) {
    setUploading(true);
    setError(null);
    try {
      const arr = Array.from(files).slice(0, 10 - uploadedUrls.length);
      const urls = await Promise.all(arr.map(uploadOne));
      const nextUrls = [...uploadedUrls, ...urls].slice(0, 10);
      setUploadedUrls(nextUrls);
      void suggestMood(nextUrls);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 업로드 실패');
    } finally {
      setUploading(false);
    }
  }

  function handleReplaceImage(idx: number, newUrl: string) {
    setUploadedUrls(prev => prev.map((u, i) => (i === idx ? newUrl : u)));
  }

  function handleAddImage(newUrl: string) {
    setUploadedUrls(prev => (prev.length < 10 ? [...prev, newUrl] : prev));
  }

  function handleReplaceThumbnailRef(idx: number, newUrl: string) {
    setThumbnailExtraUrls(prev => prev.map((u, i) => (i === idx ? newUrl : u)));
  }

  function handleAddThumbnailRef(newUrl: string) {
    setThumbnailExtraUrls(prev => [...prev, newUrl]);
  }

  // 무드 추천 (논블로킹) — 실패해도 조용히 무시
  async function suggestMood(urls: string[]) {
    if (urls.length === 0) return;
    suggestMoodIdRef.current += 1;
    const reqId = suggestMoodIdRef.current;
    setIsSuggestingMood(true);
    try {
      const res = await fetch('/api/ai/suggest-mood', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productImageUrls: urls.slice(0, 3), productName: productName.trim() || undefined }),
      });
      const json = await res.json() as { success: boolean; data?: { moodIds: string[] } };
      // 더 최신 추천 요청이 시작됐으면 이 응답은 폐기 (느린 응답이 최신 결과를 덮어쓰지 않도록)
      if (suggestMoodIdRef.current !== reqId) return;
      if (json.success && json.data) setSuggestedMoodIds(json.data.moodIds);
    } catch {
      // 무시
    } finally {
      // 최신 요청만 로딩 상태를 해제 (구식 응답이 진행 중 플래그를 끄지 않도록)
      if (suggestMoodIdRef.current === reqId) setIsSuggestingMood(false);
    }
  }

  // 무드 선택 — 브리프 확정 + 페이지 팔레트 통일
  function handleSelectMood(id: string) {
    const preset = getMoodPreset(id);
    if (!preset) return;
    setCreativeBrief({ moodId: preset.id, sceneHint: preset.sceneHint });
    setTheme(prev => ({ ...prev, palette: preset.palette }));
  }

  // ─── 썸네일 전용 참조 이미지 업로드/제거 ────────────────────────────────────
  async function handleUploadThumbnailRefFiles(files: FileList | File[]) {
    setUploadingThumbnailRef(true);
    setThumbnailError(null);
    try {
      const arr = Array.from(files).slice(0, 3 - thumbnailExtraUrls.length);
      const urls = await Promise.all(arr.map(uploadOne));
      setThumbnailExtraUrls(prev => [...prev, ...urls].slice(0, 3));
    } catch (e) {
      setThumbnailError(e instanceof Error ? e.message : '이미지 업로드 실패');
    } finally {
      setUploadingThumbnailRef(false);
    }
  }

  function handleRemoveThumbnailRefImage(idx: number) {
    setThumbnailExtraUrls(prev => prev.filter((_, i) => i !== idx));
  }

  // ─── 썸네일 생성/수정/관리 ────────────────────────────────────────────────────
  async function handleGenerateThumbnail(direction: string, textBadge?: TextBadgeOptions) {
    const refImgs = thumbnailExtraUrls.length > 0 ? thumbnailExtraUrls : uploadedUrls;
    if (refImgs.length === 0) { setThumbnailError('참고 이미지를 먼저 업로드하세요.'); return; }
    setIsGeneratingThumbnail(true);
    setThumbnailError(null);
    try {
      const url = await generateCoupangThumbnail(refImgs.slice(0, 3), direction, textBadge);
      setGeneratedThumbnails(prev => [...prev, url]);
    } catch (e) {
      setThumbnailError(e instanceof Error ? e.message : '썸네일 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGeneratingThumbnail(false);
    }
  }

  async function handleEditThumbnail(url: string, prompt: string) {
    setEditingThumbnailUrl(url);
    setThumbnailError(null);
    try {
      const editedUrl = await editThumbnail(url, prompt);
      setGeneratedThumbnails(prev => prev.map(u => (u === url ? editedUrl : u)));
    } catch (e) {
      setThumbnailError(e instanceof Error ? e.message : '썸네일 수정 중 오류가 발생했습니다.');
    } finally {
      setEditingThumbnailUrl(null);
    }
  }

  function handleRemoveThumbnail(url: string) {
    setGeneratedThumbnails(prev => prev.filter(u => u !== url));
  }

  async function handleDownloadThumbnail(url: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `thumbnail-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setThumbnailError('다운로드에 실패했습니다.');
    }
  }

  function handleRemoveImage(idx: number) {
    const next = uploadedUrls.filter((_, i) => i !== idx);
    setUploadedUrls(next);
    // 이미지가 모두 사라지면 그 이미지 기반 추천은 더 이상 유효하지 않음 → 초기화
    if (next.length === 0) {
      setSuggestedMoodIds([]);
      suggestMoodIdRef.current += 1; // 진행 중인 추천 응답도 폐기
    }
  }

  // ─── render API 헬퍼 ────────────────────────────────────────────────────────
  async function refreshRenderedHtml(
    nextSections: DetailSection[],
    nextTheme: DetailPageTheme,
  ) {
    if (nextSections.length === 0) return;
    setIsRendering(true);
    setError(null);
    try {
      const res = await fetch('/api/detail-page/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: nextSections, theme: nextTheme }),
      });
      const json = await res.json();
      if (res.ok) {
        setGeneratedHtml(json.html);
      } else {
        setError(json.error ?? '미리보기 갱신에 실패했습니다.');
      }
    } catch {
      setError('미리보기 갱신 중 오류가 발생했습니다.');
    } finally {
      setIsRendering(false);
    }
  }

  // ─── Gemini 씬 이미지 생성 ─────────────────────────────────────────────────
  async function generateSceneImages(
    sectionsSnapshot: DetailSection[],
    refUrls: string[],
    genId: number,
    currentTheme: DetailPageTheme,
    sceneHint?: string,
    storyboardItems?: SceneStoryboardItem[] | null,
  ) {
    const targets = sectionsSnapshot.filter(s => s.type === 'hero' || s.type === 'point');
    if (targets.length === 0 || refUrls.length === 0) return;

    const results = await Promise.allSettled(
      targets.map(async (section, idx) => {
        try {
          const sectionType = section.type === 'hero' ? 'hero' : 'lifestyle';
          const headline =
            (section.content.type === 'hero' || section.content.type === 'point')
              ? section.content.headline
              : undefined;

          // storyboard 있으면 씬별 소스 이미지 + 프롬프트 사용, 없으면 기존 로테이션 로직
          let sectionRefUrls: string[];
          let combinedHint: string | undefined;

          const storyboardScene = storyboardItems?.[idx];
          if (storyboardScene) {
            const srcIdx = Math.min(storyboardScene.sourceImageIndex, refUrls.length - 1);
            sectionRefUrls = [refUrls[srcIdx]];
            const promptBase = storyboardScene.prompt.trim() || undefined;
            const headlineBase = headline?.trim() || undefined;
            combinedHint = promptBase ?? headlineBase ?? sceneHint;
          } else {
            // 섹션마다 다른 이미지 조합으로 씬 다양성 확보 (최대 3장, 인덱스 로테이션)
            const startIdx = refUrls.length > 3 ? idx % (refUrls.length - 2) : 0;
            sectionRefUrls = refUrls.slice(startIdx, startIdx + 3);
            // 섹션 헤드라인을 sceneHint에 결합해 AI가 맥락에 맞는 씬 생성하도록 유도
            combinedHint = [headline?.trim(), sceneHint?.trim()].filter(Boolean).join(' — ') || undefined;
          }

          // cleanup 모드: 배경 제거 API 사용, 일반 씬 생성 API 우회
          let imageBase64: string;
          let mimeType: string;

          if (storyboardScene?.mode === 'cleanup') {
            const srcIdx = Math.min(storyboardScene.sourceImageIndex, refUrls.length - 1);
            const sourceUrl = refUrls[srcIdx] ?? refUrls[0];
            const cleanupRes = await fetch('/api/ai/cleanup-product-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: sourceUrl }),
            });
            if (!cleanupRes.ok) return null;
            const cleanupData = await cleanupRes.json() as {
              imageBase64?: string;
              mimeType?: string;
              error?: string;
            };
            if (cleanupData.error || !cleanupData.imageBase64 || !cleanupData.mimeType) return null;
            imageBase64 = cleanupData.imageBase64;
            mimeType = cleanupData.mimeType;
          } else {
            const sceneRes = await fetch('/api/ai/generate-scene-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sectionType,
                productImageUrls: sectionRefUrls,
                productInfo: headline ? { headline } : undefined,
                sceneHint: combinedHint,
              }),
            });
            if (!sceneRes.ok) return null;

            const sceneData = await sceneRes.json() as {
              success: boolean;
              data?: { imageBase64: string; mimeType: string };
            };
            if (!sceneData.success || !sceneData.data) return null;
            imageBase64 = sceneData.data.imageBase64;
            mimeType = sceneData.data.mimeType;
          }

          const uploadRes = await fetch('/api/image/upload-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64,
              mimeType,
              role: sectionType,
            }),
          });
          if (!uploadRes.ok) return null;

          const uploadData = await uploadRes.json() as { success: boolean; url?: string };
          if (!uploadData.success || !uploadData.url) return null;

          return { sectionId: section.id, url: uploadData.url, sceneId: storyboardScene?.id };
        } catch {
          return null;
        }
      }),
    );

    // 새 생성이 시작됐으면 결과 폐기
    if (sceneGenIdRef.current !== genId) return;

    const urlUpdates = results
      .filter((r): r is PromiseFulfilledResult<{ sectionId: string; url: string; sceneId: string | undefined } | null> =>
        r.status === 'fulfilled')
      .map(r => r.value)
      .filter((v): v is { sectionId: string; url: string; sceneId: string | undefined } => v !== null);

    if (urlUpdates.length > 0) {
      setSections(prev => {
        const updated = prev.map(s => {
          const hit = urlUpdates.find(u => u.sectionId === s.id);
          if (!hit) return s;
          return { ...s, attachedImages: [{ url: hit.url, order: 0, processingMode: 'original' as const }] };
        });
        void refreshRenderedHtml(updated, currentTheme);
        return updated;
      });

      // storyboard resultUrl 업데이트
      const storyboardUpdates = urlUpdates.filter(u => u.sceneId != null);
      if (storyboardUpdates.length > 0) {
        setStoryboard(prev => {
          if (!prev) return prev;
          return prev.map(scene => {
            const hit = storyboardUpdates.find(u => u.sceneId === scene.id);
            return hit ? { ...scene, resultUrl: hit.url } : scene;
          });
        });
      }
    }
  }

  // ─── ③ 단일 섹션 씬 편집 ──────────────────────────────────────────────────
  async function handleSceneEdit(
    section: DetailSection,
    opts: { instruction: string; referenceImageUrls: string[] },
  ) {
    setEditingSectionId(section.id);
    setSceneEditError(null);
    sceneEditIdRef.current += 1;
    const editId = sceneEditIdRef.current;

    // 편집 전 이전 URL 보관 (undo용)
    const prevUrl = section.attachedImages[0]?.url;
    if (prevUrl) prevSceneUrls.current.set(section.id, prevUrl);

    const FAIL_MSG = '씬 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.';

    try {
      const headline = (() => {
        const c = section.content;
        if (c.type === 'hero' || c.type === 'point') return c.headline;
        return undefined;
      })();

      const res = await fetch('/api/ai/generate-scene-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionType: section.type === 'hero' ? 'hero' : 'lifestyle',
          productImageUrls: opts.referenceImageUrls.length > 0 ? opts.referenceImageUrls : uploadedUrls.slice(0, 2),
          baseImageUrl: section.attachedImages[0]?.url,
          instruction: opts.instruction || undefined,
          productInfo: headline ? { headline } : undefined,
        }),
      });

      if (sceneEditIdRef.current !== editId) return;

      const json = await res.json() as {
        success: boolean;
        data?: { imageBase64: string; mimeType: string };
        error?: string;
      };
      if (!res.ok || !json.success) throw new Error(json.error ?? FAIL_MSG);

      const uploadRes = await fetch('/api/image/upload-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: json.data!.imageBase64,
          mimeType: json.data!.mimeType,
          role: section.type === 'hero' ? 'hero' : 'lifestyle',
        }),
      });

      if (sceneEditIdRef.current !== editId) return;

      const uploadData = await uploadRes.json() as { success: boolean; url?: string };
      if (!uploadData.success || !uploadData.url) throw new Error(FAIL_MSG);

      const newUrl = uploadData.url;
      setSections(prev => {
        const updated = prev.map(s =>
          s.id === section.id
            ? { ...s, attachedImages: [{ url: newUrl, order: 0, processingMode: 'original' as const }] }
            : s,
        );
        void refreshRenderedHtml(updated, theme);
        return updated;
      });
      setEditingSectionId(null);
    } catch (e) {
      if (sceneEditIdRef.current !== editId) return;
      setSceneEditError({
        sectionId: section.id,
        message: e instanceof Error ? e.message : FAIL_MSG,
      });
      setEditingSectionId(null);
      throw e; // re-throw → SectionCard에서 catch해 패널 유지
    }
  }

  function handleSceneUndo(sectionId: string) {
    const prevUrl = prevSceneUrls.current.get(sectionId);
    if (!prevUrl) return;
    setSections(prev => {
      const updated = prev.map(s =>
        s.id === sectionId
          ? { ...s, attachedImages: [{ url: prevUrl, order: 0, processingMode: 'original' as const }] }
          : s,
      );
      void refreshRenderedHtml(updated, theme);
      return updated;
    });
    prevSceneUrls.current.delete(sectionId);
    setSceneEditError(prev => (prev?.sectionId === sectionId ? null : prev));
  }

  // ─── 2단계 흐름: ① 스토리라인 기획 + HTML 병렬 생성 ──────────────────────────
  async function handlePlanStoryboard() {
    if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
    if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }

    // 재생성 시 이전 결과 초기화
    setSections([]);
    setStoryboard(null);
    setGeneratedHtml('');
    setDetailStep('generating');
    setStoryboardError(null);
    setError(null);
    setIsGenerating(true);
    setIsGeneratingStoryboard(true);
    sceneGenIdRef.current += 1;
    const planGenId = sceneGenIdRef.current;

    const fullProductName = [brandName.trim(), productName.trim()].filter(Boolean).join(' ');

    const htmlPromise = fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls: uploadedUrls,
        productName: fullProductName,
        category,
        mobileMode: true,
        referenceText: referenceText.trim() || undefined,
      }),
    }).then(r => r.json());

    const storyboardPromise = fetch('/api/ai/plan-scene-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName: productName.trim(),
        brandName: brandName.trim() || undefined,
        category,
        imageCount: uploadedUrls.length,
        referenceText: referenceText.trim() || undefined,
        sceneCount: 4,
      }),
    }).then(async r => {
      if (!r.ok) throw new Error(`스토리라인 생성 실패 (${r.status})`);
      return r.json();
    });

    // storyboard 도착 즉시 planning 단계로 전환 (HTML 기다리지 않음)
    storyboardPromise
      .then(data => {
        if (!data.scenes) throw new Error(data.error ?? '스토리라인 생성 실패');
        const rawScenes = (data.scenes as Array<Record<string, unknown>>).map(s => ({
          ...s,
          id: crypto.randomUUID(),
          mode: 'ai' as const,
          sectionId: null,
        } as SceneStoryboardItem));
        setStoryboard(rawScenes);
        setDetailStep('planning');
      })
      .catch(e => {
        setStoryboard([]);
        setStoryboardError(e instanceof Error ? e.message : '스토리라인 생성 중 오류가 발생했습니다.');
        setDetailStep('planning');
      })
      .finally(() => {
        setIsGeneratingStoryboard(false);
      });

    try {
      const json = await htmlPromise;
      if (!json.success) throw new Error(json.error ?? '생성 실패');
      setGeneratedHtml(json.html);
      if (json.mobileContent) {
        try {
          const parsed = mobileContentToSections(
            json.mobileContent as import('@/lib/ai/prompts/detail-page').MobileDetailPageContent,
            uploadedUrls,
          );
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] mobileContentToSections 실패:', e);
          setError('생성 결과를 편집기로 불러오지 못했습니다. 다시 시도해주세요.');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HTML 생성 중 오류가 발생했습니다.');
    } finally {
      if (sceneGenIdRef.current === planGenId) setIsGenerating(false);
    }
  }

  // ─── 2단계 흐름: ② 스토리보드 확정 후 씬 이미지 생성 ──────────────────────
  function handleGenerateScenesFromStoryboard() {
    if (sections.length === 0) return;
    setDetailStep('editing');  // planning → editing 단계 전환
    sceneGenIdRef.current += 1;
    const currentGenId = sceneGenIdRef.current;
    setIsGeneratingScenes(true);
    void generateSceneImages(
      sections,
      uploadedUrls,
      currentGenId,
      theme,
      creativeBrief?.sceneHint,
      storyboard,
    ).finally(() => {
      if (sceneGenIdRef.current === currentGenId) setIsGeneratingScenes(false);
    });
  }

  // ─── 단일 씬 재생성 (다시 클린업 / AI로 전환) ──────────────────────────────
  async function handleRegenerateScene(sceneId: string, forceMode?: 'ai' | 'cleanup') {
    if (!storyboard) return;
    const scene = storyboard.find(s => s.id === sceneId);
    if (!scene || uploadedUrls.length === 0) return;

    const effectiveMode = forceMode ?? scene.mode;
    const targets = sections.filter(s => s.type === 'hero' || s.type === 'point');
    const sceneIdx = storyboard.findIndex(s => s.id === sceneId);
    const section = targets[sceneIdx];
    if (!section) return;

    // 모드 변경 + resultUrl 클리어
    setStoryboard(prev =>
      prev?.map(s =>
        s.id === sceneId ? { ...s, mode: effectiveMode, resultUrl: undefined } : s,
      ) ?? null,
    );

    sceneGenIdRef.current += 1;
    const genId = sceneGenIdRef.current;
    setIsGeneratingScenes(true);

    try {
      let imageBase64: string;
      let mimeType: string;
      const sectionType = section.type === 'hero' ? 'hero' : 'lifestyle';

      if (effectiveMode === 'cleanup') {
        const srcIdx = Math.min(scene.sourceImageIndex, uploadedUrls.length - 1);
        const sourceUrl = uploadedUrls[srcIdx] ?? uploadedUrls[0];
        const res = await fetch('/api/ai/cleanup-product-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: sourceUrl }),
        });
        if (!res.ok) {
          console.warn('[handleRegenerateScene] cleanup API 실패:', res.status);
          return;
        }
        const data = await res.json() as { imageBase64?: string; mimeType?: string; error?: string };
        if (!data.imageBase64 || !data.mimeType) {
          console.warn('[handleRegenerateScene] cleanup 응답 데이터 없음');
          return;
        }
        imageBase64 = data.imageBase64;
        mimeType = data.mimeType;
      } else {
        const headline =
          (section.content.type === 'hero' || section.content.type === 'point')
            ? section.content.headline
            : undefined;
        const srcIdx = Math.min(scene.sourceImageIndex, uploadedUrls.length - 1);
        const res = await fetch('/api/ai/generate-scene-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionType,
            productImageUrls: [uploadedUrls[srcIdx]],
            productInfo: headline ? { headline } : undefined,
            sceneHint: scene.prompt.trim() || headline,
          }),
        });
        if (!res.ok) {
          console.warn('[handleRegenerateScene] generate-scene-image 실패:', res.status);
          return;
        }
        const data = await res.json() as { success: boolean; data?: { imageBase64: string; mimeType: string } };
        if (!data.success || !data.data) {
          console.warn('[handleRegenerateScene] generate-scene-image 응답 없음');
          return;
        }
        imageBase64 = data.data.imageBase64;
        mimeType = data.data.mimeType;
      }

      const uploadRes = await fetch('/api/image/upload-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType, role: sectionType }),
      });
      if (!uploadRes.ok) {
        console.warn('[handleRegenerateScene] upload 실패:', uploadRes.status);
        return;
      }
      const uploadData = await uploadRes.json() as { success: boolean; url?: string };
      if (!uploadData.success || !uploadData.url) {
        console.warn('[handleRegenerateScene] upload 응답 없음');
        return;
      }

      if (sceneGenIdRef.current !== genId) return;

      const url = uploadData.url;
      setStoryboard(prev =>
        prev?.map(s => s.id === sceneId ? { ...s, resultUrl: url } : s) ?? null,
      );
      setSections(prev => {
        const updated = prev.map(s => {
          if (s.id !== section.id) return s;
          return { ...s, attachedImages: [{ url, order: 0, processingMode: 'original' as const }] };
        });
        void refreshRenderedHtml(updated, theme);
        return updated;
      });
    } catch (e) {
      if (sceneGenIdRef.current === genId) {
        console.warn('[handleRegenerateScene] 씬 생성 실패:', e);
      }
    } finally {
      if (sceneGenIdRef.current === genId) setIsGeneratingScenes(false);
    }
  }

  // ─── AI 생성 ────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
    if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }
    setIsGenerating(true);
    setIsGeneratingScenes(false);
    setError(null);
    // 수동 씬 편집(generateSceneImages) 경쟁 방지 — 새 생성 시작 시 이전 결과 폐기
    sceneGenIdRef.current += 1;
    const currentGenId = sceneGenIdRef.current;

    try {
      const fullProductName = [brandName.trim(), productName.trim()].filter(Boolean).join(' ');
      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls: uploadedUrls,
          productName: fullProductName,
          category,
          mobileMode: true,
          referenceText: referenceText.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `생성 실패 (${res.status})`);

      setGeneratedHtml(json.html);

      let parsed: DetailSection[] | null = null;
      if (json.mobileContent) {
        try {
          parsed = mobileContentToSections(json.mobileContent as MobileDetailPageContent, uploadedUrls);
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] mobileContentToSections 실패:', e);
          setError('생성 결과를 편집기로 불러오지 못했습니다. 다시 시도해주세요.');
        }
      // 구버전 서버(mobileMode 미지원)가 desktop content를 반환하는 롤링 배포 케이스 대비 fallback
      } else if (json.content) {
        try {
          const rawSections = contentToSections(json.content as DetailPageContent);
          parsed = distributeImagesToSections(rawSections, uploadedUrls);
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] contentToSections 실패:', e);
          setError('생성 결과를 편집기로 불러오지 못했습니다. 다시 시도해주세요.');
        }
      }

      // HTML 생성 완료 → 즉시 페이지 표시 후 씬 이미지 교체 (논블로킹)
      if (parsed && parsed.length > 0) {
        setIsGeneratingScenes(true);
        void generateSceneImages(parsed, uploadedUrls, currentGenId, theme, creativeBrief?.sceneHint).finally(() => {
          if (sceneGenIdRef.current === currentGenId) setIsGeneratingScenes(false);
        });
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 생성 중 오류가 발생했습니다.');
      setIsGeneratingScenes(false);
    } finally {
      setIsGenerating(false);
    }
  }

  // ─── 섹션/테마 변경 ─────────────────────────────────────────────────────────
  function handleSectionsChange(next: DetailSection[]) {
    setSections(next);
    void refreshRenderedHtml(next, theme);
  }

  function handleThemeChange(next: DetailPageTheme) {
    setTheme(next);
    void refreshRenderedHtml(sections, next);
  }

  // ─── 섹션 AI 편집 ───────────────────────────────────────────────────────────
  async function handleSectionAiEdit(section: DetailSection, instruction: string): Promise<void> {
    const res = await fetch('/api/detail-page/edit-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        instruction,
        theme,
        productName: productName.trim() || undefined,
        existingSections: sections.map(s => ({ type: s.type, content: s.content })),
      }),
    });
    let json: Record<string, unknown>;
    try { json = await res.json(); }
    catch { throw new Error(`섹션 편집 실패 (${res.status})`); }
    if (!res.ok) throw new Error((json.error as string | undefined) ?? '섹션 편집 실패');

    const updatedSection = json.section as DetailSection | undefined;
    if (!updatedSection) throw new Error('섹션 편집 응답이 유효하지 않습니다.');
    const updated = sections.map(s => s.id === section.id ? { ...s, ...updatedSection } : s);
    setSections(updated);
    await refreshRenderedHtml(updated, theme);
  }

  // ─── HTML 복사 / 다운로드 ────────────────────────────────────────────────────
  async function handleHtmlCopy() {
    await navigator.clipboard.writeText(generatedHtml).catch(() => {});
  }

  function handleDownload() {
    const blob = new Blob([generatedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'detail-page.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '100vh', background: C.bg }}>
      {/* 좌측 300px 입력 패널 */}
      <DetailMakerInputPanel
        productName={productName}
        setProductName={setProductName}
        brandName={brandName}
        setBrandName={setBrandName}
        category={category}
        setCategory={setCategory}
        uploadedUrls={uploadedUrls}
        uploading={uploading}
        isGenerating={isGenerating || isGeneratingScenes}
        error={error}
        onUploadFiles={handleUploadFiles}
        onRemoveImage={handleRemoveImage}
        onGenerate={handlePlanStoryboard}
        suggestedMoodIds={suggestedMoodIds}
        selectedMoodId={creativeBrief?.moodId ?? null}
        isSuggestingMood={isSuggestingMood}
        onSelectMood={handleSelectMood}
        thumbnailRefUrls={uploadedUrls}
        isGeneratingThumbnail={isGeneratingThumbnail}
        thumbnailError={thumbnailError}
        onGenerateThumbnail={handleGenerateThumbnail}
        thumbnailExtraUrls={thumbnailExtraUrls}
        uploadingThumbnailRef={uploadingThumbnailRef}
        onUploadThumbnailRef={handleUploadThumbnailRefFiles}
        onRemoveThumbnailRef={handleRemoveThumbnailRefImage}
        referenceText={referenceText}
        setReferenceText={setReferenceText}
        onReplaceImage={handleReplaceImage}
        onAddImage={handleAddImage}
        onReplaceExtraRef={handleReplaceThumbnailRef}
        onAddExtraRef={handleAddThumbnailRef}
      />

      {/* 우측 — detailStep 단일 소스 렌더 분기 */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {generatedThumbnails.length > 0 && (
          <DetailMakerThumbnailGallery
            thumbnails={generatedThumbnails}
            editingUrl={editingThumbnailUrl}
            onDownload={handleDownloadThumbnail}
            onRemove={handleRemoveThumbnail}
            onEdit={handleEditThumbnail}
          />
        )}

        {detailStep === 'editing' ? (
          <>
            <DetailPageEditor
              sections={sections}
              theme={theme}
              isGenerating={isRendering || isGenerating}
              onSectionsChange={handleSectionsChange}
              onThemeChange={handleThemeChange}
              onRegenerateAll={handlePlanStoryboard}
              onSectionAiEdit={handleSectionAiEdit}
              onHtmlCopy={handleHtmlCopy}
              onDownload={handleDownload}
              generatedHtml={generatedHtml}
              uploadedUrls={uploadedUrls}
              onSceneEdit={handleSceneEdit}
              editingSectionId={editingSectionId}
              sceneEditError={sceneEditError}
              prevSceneUrlMap={prevSceneUrls.current}
              onSceneUndo={handleSceneUndo}
            />
            {isGeneratingScenes && (
              <div style={{
                position: 'absolute',
                bottom: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(124,58,237,0.92)',
                color: '#fff',
                padding: '8px 18px',
                borderRadius: '24px',
                fontSize: '13px',
                fontWeight: 600,
                backdropFilter: 'blur(4px)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                zIndex: 10,
              }}>
                ✨ AI 씬 이미지 생성 중...
              </div>
            )}
          </>
        ) : detailStep === 'planning' ? (
          <>
            {storyboardError && (
              <div style={{ padding: '12px 16px', background: '#450a0a', color: '#fca5a5', fontSize: '13px' }}>
                {storyboardError}
              </div>
            )}
            <DetailPlanReview
              sections={sections}
              storyboard={storyboard ?? []}
              uploadedUrls={uploadedUrls}
              isHtmlReady={!isGenerating && generatedHtml !== ''}
              isGeneratingScenes={isGeneratingScenes}
              onSectionsChange={handleSectionsChange}
              onScenesChange={scenes => setStoryboard(scenes)}
              onGenerate={handleGenerateScenesFromStoryboard}
            />
          </>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: C.textSub,
            gap: '12px',
          }}>
            {detailStep === 'generating' ? (
              <>
                <div style={{ fontSize: '32px' }}>✨</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>
                  {isGeneratingStoryboard ? '스토리라인을 구성하고 있어요' : 'AI가 상세페이지를 생성하고 있어요'}
                </div>
                <div style={{ fontSize: '13px' }}>잠시만 기다려주세요...</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '40px' }}>📄</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>상품상세 자동만들기</div>
                <div style={{ fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
                  왼쪽에서 상품명과 이미지를 입력하고
                  <br />
                  기획 생성 버튼을 눌러보세요
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
