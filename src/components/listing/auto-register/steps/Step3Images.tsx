'use client';
import { useState } from 'react';

export interface ImagesValue {
  thumbnailUrl: string;
  additionalUrls: string[];
}

interface Props {
  initialValue: ImagesValue;
  onNext: (value: ImagesValue) => void;
  onBack: () => void;
}

export function Step3Images({ initialValue, onNext, onBack }: Props) {
  const [thumbnail, setThumbnail] = useState(initialValue.thumbnailUrl);
  const [editInstruction, setEditInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');

  async function handleAiEdit() {
    if (!editInstruction.trim()) return;
    setIsEditing(true);
    setEditError('');
    try {
      const res = await fetch('/api/ai/edit-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: thumbnail, instruction: editInstruction }),
      });
      if (res.ok) {
        const data = (await res.json()) as { editedUrl?: string };
        if (data.editedUrl) setThumbnail(data.editedUrl);
      } else {
        setEditError('AI 편집 중 오류가 발생했습니다.');
      }
    } catch {
      setEditError('네트워크 오류가 발생했습니다.');
    } finally {
      setIsEditing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">이미지 확인 · AI 편집</h3>

      {thumbnail ? (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnail}
            alt="대표 이미지"
            className="w-48 h-48 object-cover rounded-lg border border-gray-200"
          />

          <div className="flex gap-2">
            <input
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="예: 배경을 흰색으로 바꿔줘"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isEditing}
            />
            <button
              onClick={handleAiEdit}
              disabled={isEditing || !editInstruction.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {isEditing ? '편집 중...' : 'AI 편집'}
            </button>
          </div>
          {editError && <p className="text-xs text-red-500">{editError}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">이미지를 불러오지 못했습니다.</p>
      )}

      <div className="flex gap-3 justify-end mt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          이전
        </button>
        <button
          onClick={() => onNext({ thumbnailUrl: thumbnail, additionalUrls: initialValue.additionalUrls })}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          다음
        </button>
      </div>
    </div>
  );
}
