'use client';

import React from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { C } from '@/lib/design-tokens';
import type { SceneStoryboardItem } from '@/types/detail-page';

export interface StoryboardEditorProps {
  scenes: SceneStoryboardItem[];
  uploadedUrls: string[];
  isHtmlReady: boolean;
  isGeneratingScenes: boolean;
  onScenesChange: (scenes: SceneStoryboardItem[]) => void;
  onGenerate: () => void;
}

interface SceneCardProps {
  scene: SceneStoryboardItem;
  uploadedUrls: string[];
  onUpdate: (updated: SceneStoryboardItem) => void;
  onDelete: () => void;
}

function SceneCard({ scene, uploadedUrls, onUpdate, onDelete }: SceneCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: scene.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: '#2d2d44',
        borderRadius: '8px',
        padding: '14px',
        marginBottom: '10px',
        borderLeft: `3px solid ${scene.mode === 'cleanup' ? '#059669' : '#6366f1'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          {...attributes}
          {...listeners}
          style={{ color: '#6b7280', fontSize: '14px', cursor: 'grab', userSelect: 'none' }}
        >
          ⠿
        </span>
        <input
          value={scene.title}
          onChange={e => onUpdate({ ...scene, title: e.target.value })}
          placeholder="씬 제목"
          style={{
            flex: 1,
            background: '#1a1a2e',
            border: '1px solid #4b5563',
            borderRadius: '5px',
            padding: '4px 8px',
            color: '#fff',
            fontSize: '13px',
          }}
        />
        {/* 삭제 버튼 — aria-label에 이모지 포함하여 getByRole({ name: /🗑/ }) 쿼리 지원 */}
        <button
          onClick={onDelete}
          aria-label="씬 삭제 🗑"
          style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
        >
          🗑
        </button>
      </div>

      <input
        value={scene.description}
        onChange={e => onUpdate({ ...scene, description: e.target.value })}
        placeholder="씬 설명 (한 줄)"
        style={{
          width: '100%',
          background: '#1a1a2e',
          border: '1px solid #374151',
          borderRadius: '5px',
          padding: '4px 8px',
          color: '#9ca3af',
          fontSize: '12px',
          marginBottom: '8px',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        {scene.mode === 'ai' && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px' }}>IMAGE PROMPT</div>
            <textarea
              value={scene.prompt}
              onChange={e => onUpdate({ ...scene, prompt: e.target.value })}
              style={{
                width: '100%',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '5px',
                padding: '6px 8px',
                color: '#9ca3af',
                fontSize: '11px',
                boxSizing: 'border-box',
                resize: 'vertical',
                height: '60px',
              }}
            />
          </div>
        )}

        <div style={{ width: scene.mode === 'ai' ? '80px' : '100%', flexShrink: 0 }}>
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px' }}>소스 이미지</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {uploadedUrls.map((url, i) => (
              <button
                key={i}
                onClick={() => onUpdate({ ...scene, sourceImageIndex: i })}
                aria-label={`이미지 ${i + 1} 선택`}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '4px',
                  border: scene.sourceImageIndex === i ? '2px solid #6366f1' : '2px solid transparent',
                  padding: 0,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  background: '#374151',
                }}
              >
                <img
                  src={url}
                  alt={`이미지 ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StoryboardEditor({
  scenes,
  uploadedUrls,
  isHtmlReady,
  isGeneratingScenes,
  onScenesChange,
  onGenerate,
}: StoryboardEditorProps) {
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex(s => s.id === active.id);
    const newIndex = scenes.findIndex(s => s.id === over.id);
    onScenesChange(arrayMove(scenes, oldIndex, newIndex));
  }

  function handleAddScene() {
    onScenesChange([
      ...scenes,
      {
        id: crypto.randomUUID(),
        title: '새 씬',
        description: '',
        prompt: '',
        sourceImageIndex: 0,
        mode: 'ai',
      },
    ]);
  }

  const canGenerate = isHtmlReady && !isGeneratingScenes;

  return (
    <div style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: '15px', fontWeight: 600, color: C.text, marginBottom: '4px' }}>
        스토리라인 편집
      </div>
      <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '16px' }}>
        씬을 드래그해 순서를 변경하거나 프롬프트를 직접 수정할 수 있어요
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={scenes.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {scenes.map((scene, i) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              uploadedUrls={uploadedUrls}
              onUpdate={updated => {
                const next = [...scenes];
                next[i] = updated;
                onScenesChange(next);
              }}
              onDelete={() => onScenesChange(scenes.filter((_, j) => j !== i))}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        onClick={handleAddScene}
        style={{
          width: '100%',
          padding: '10px',
          background: 'transparent',
          border: '1px dashed #4b5563',
          borderRadius: '8px',
          color: '#6b7280',
          fontSize: '13px',
          cursor: 'pointer',
          marginBottom: '14px',
        }}
      >
        + 씬 추가
      </button>

      {/* isHtmlReady=false 일 때 안내 문구 */}
      {!isHtmlReady && (
        <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '8px' }}>
          상세페이지 HTML 생성 중…
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          width: '100%',
          padding: '12px',
          background: canGenerate ? '#6366f1' : '#374151',
          border: 'none',
          borderRadius: '8px',
          color: canGenerate ? '#fff' : '#6b7280',
          fontSize: '14px',
          fontWeight: 600,
          cursor: canGenerate ? 'pointer' : 'not-allowed',
        }}
      >
        {isGeneratingScenes ? '씬 이미지 생성 중…' : '② 씬 이미지 생성'}
      </button>
    </div>
  );
}
