'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import {
  DEFAULT_CATEGORY_TREE,
  type ParentCategory,
  type Subcategory,
} from '@/lib/categories';

const STORAGE_KEY = 'sourcing-calendar-categories';

interface SuggestResponse {
  subcategories: Subcategory[];
  suggestedAt: string;
}

function loadCategories(): ParentCategory[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as ParentCategory[]) : DEFAULT_CATEGORY_TREE;
  } catch {
    return DEFAULT_CATEGORY_TREE;
  }
}

export default function CalendarPage() {
  const [categories, setCategories] = useState<ParentCategory[]>(DEFAULT_CATEGORY_TREE);
  const [activeCatId, setActiveCatId] = useState<string>(DEFAULT_CATEGORY_TREE[0].id);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set());
  const [newSubName, setNewSubName] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  useEffect(() => {
    const loaded = loadCategories();
    setCategories(loaded);
    setActiveCatId(loaded[0].id);
  }, []);

  const persistCategories = useCallback((updated: ParentCategory[]) => {
    setCategories(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  }, []);

  const activeCat = categories.find((c) => c.id === activeCatId) ?? categories[0];

  function handleSelectParent(catId: string) {
    setActiveCatId(catId);
    setActiveSubId(null);
    setSuggestedIds(new Set());
    setAddingNew(false);
    setNewSubName('');
  }

  function handleDeleteSub(subId: string) {
    const updated = categories.map((cat) =>
      cat.id === activeCatId
        ? { ...cat, subcategories: cat.subcategories.filter((s) => s.id !== subId) }
        : cat,
    );
    persistCategories(updated);
    if (activeSubId === subId) setActiveSubId(null);
  }

  function handleAddSub() {
    const name = newSubName.trim();
    if (!name) return;
    const newSub: Subcategory = { id: `custom-${name}-${Date.now()}`, name };
    const updated = categories.map((cat) =>
      cat.id === activeCatId
        ? { ...cat, subcategories: [...cat.subcategories, newSub] }
        : cat,
    );
    persistCategories(updated);
    setNewSubName('');
    setAddingNew(false);
  }

  async function handleSuggest() {
    if (!activeCat || suggestLoading) return;
    setSuggestLoading(true);
    try {
      const res = await fetch('/api/calendar/suggest-subcategories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentCategory: activeCat.name,
          currentSubcategories: activeCat.subcategories.map((s) => s.name),
        }),
      });
      const data = (await res.json()) as SuggestResponse;
      const newSubs = data.subcategories;
      const updated = categories.map((cat) =>
        cat.id === activeCatId ? { ...cat, subcategories: newSubs } : cat,
      );
      persistCategories(updated);
      setActiveSubId(null);
      setSuggestedIds(new Set(newSubs.map((s) => s.id)));
    } catch {
      // 네트워크 오류: 무시
    } finally {
      setSuggestLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Noto Sans KR', sans-serif", color: C.text }}>
      {/* 헤더 */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: C.text }}>소싱 캘린더</h1>
        <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
          카테고리별 소싱 후보 관리 · AI 소분류 추천
        </p>
      </div>

      {/* 대분류 탭 + AI 추천 버튼 */}
      <div style={{
        background: C.card, borderBottom: `2px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px',
      }}>
        <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleSelectParent(cat.id)}
              style={{
                padding: '12px 20px', border: 'none', cursor: 'pointer', fontSize: 14,
                fontWeight: activeCatId === cat.id ? 700 : 500,
                color: activeCatId === cat.id ? C.accent : C.textSub,
                background: 'transparent',
                borderBottom: activeCatId === cat.id ? `2px solid ${C.accent}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s',
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <button
          onClick={handleSuggest}
          disabled={suggestLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 600,
            background: suggestLoading ? '#f4f4f5' : 'rgba(99,102,241,0.08)',
            color: suggestLoading ? C.textSub : '#6366f1',
            border: `1px solid ${suggestLoading ? C.border : 'rgba(99,102,241,0.3)'}`,
            borderRadius: 8, cursor: suggestLoading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', marginLeft: 12, transition: 'all 0.15s',
          }}
        >
          <Sparkles size={13} />
          {suggestLoading ? '추천 중...' : '✦ 소분류 AI 추천'}
        </button>
      </div>

      {/* 소분류 그리드 */}
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {activeCat?.subcategories.map((sub) => {
            const isActive = activeSubId === sub.id;
            const isSuggested = suggestedIds.has(sub.id);
            return (
              <div
                key={sub.id}
                onClick={() => setActiveSubId(isActive ? null : sub.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  border: `1px solid ${isActive ? C.accent : isSuggested ? '#a5b4fc' : C.border}`,
                  borderRadius: 8, padding: '6px 10px 6px 12px',
                  background: isActive ? `${C.accent}10` : isSuggested ? 'rgba(99,102,241,0.06)' : C.card,
                  cursor: 'pointer', transition: 'all 0.15s',
                  opacity: suggestLoading ? 0.5 : 1,
                }}
              >
                <span style={{
                  fontSize: 13,
                  color: isActive ? C.accent : C.text,
                  fontWeight: isActive ? 600 : 400,
                }}>
                  {sub.name}
                </span>
                {isSuggested && (
                  <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginLeft: 2 }}>AI</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSub(sub.id); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 2, color: C.textSub, display: 'flex',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}

          {/* 소분류 추가 */}
          {addingNew ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSub();
                  if (e.key === 'Escape') { setAddingNew(false); setNewSubName(''); }
                }}
                placeholder="소분류명"
                style={{
                  padding: '6px 10px', fontSize: 13, color: C.text,
                  border: `1px solid ${C.accent}`, borderRadius: 8, outline: 'none', width: 110,
                }}
              />
              <button
                onClick={handleAddSub}
                style={{
                  padding: '6px 10px', fontSize: 13, background: C.accent,
                  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
                }}
              >추가</button>
              <button
                onClick={() => { setAddingNew(false); setNewSubName(''); }}
                style={{
                  padding: '6px 10px', fontSize: 13, background: C.bg, color: C.textSub,
                  border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
                }}
              >취소</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingNew(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
                fontSize: 13, color: C.textSub, background: 'transparent',
                border: `1px dashed ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Plus size={13} /> 추가
            </button>
          )}
        </div>

        {/* 선택 안내 */}
        {activeSubId ? (
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>
            선택됨: <strong style={{ color: C.text }}>{activeCat?.name}</strong>
            {' > '}
            <strong style={{ color: C.text }}>
              {activeCat?.subcategories.find((s) => s.id === activeSubId)?.name}
            </strong>
          </p>
        ) : (
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>소분류를 선택하세요.</p>
        )}
      </div>
    </div>
  );
}
