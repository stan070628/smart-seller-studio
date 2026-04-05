'use client';

/**
 * TemplateRefContext.tsx
 * 프레임 카드 DOM ref를 인스펙터 패널과 공유하기 위한 Context
 */

import { createContext, useContext, useRef, useCallback } from 'react';
import type { FrameType } from '@/types/frames';

interface TemplateRefContextValue {
  registerRef: (frameType: FrameType, el: HTMLDivElement | null) => void;
  getRef: (frameType: FrameType) => HTMLDivElement | null;
}

const TemplateRefContext = createContext<TemplateRefContextValue>({
  registerRef: () => {},
  getRef: () => null,
});

export function TemplateRefProvider({ children }: { children: React.ReactNode }) {
  const refsMap = useRef(new Map<FrameType, HTMLDivElement>());

  const registerRef = useCallback((frameType: FrameType, el: HTMLDivElement | null) => {
    if (el) {
      refsMap.current.set(frameType, el);
    } else {
      refsMap.current.delete(frameType);
    }
  }, []);

  const getRef = useCallback((frameType: FrameType) => {
    return refsMap.current.get(frameType) ?? null;
  }, []);

  return (
    <TemplateRefContext.Provider value={{ registerRef, getRef }}>
      {children}
    </TemplateRefContext.Provider>
  );
}

export function useTemplateRefs() {
  return useContext(TemplateRefContext);
}
