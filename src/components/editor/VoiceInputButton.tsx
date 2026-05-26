'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import useEditorStore from '@/store/useEditorStore';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
}

const MAX_RECORDING_MS = 60_000;

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ onTranscript }) => {
  const isRecording = useEditorStore((s) => s.isRecording);
  const setIsRecording = useEditorStore((s) => s.setIsRecording);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string, isError: boolean) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const stopAndTranscribe = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (timerRef.current) clearTimeout(timerRef.current);
    recorder.stop();
    setIsRecording(false);
  }, [setIsRecording]);

  const handleClick = useCallback(async () => {
    if (isLoading) return;

    if (isRecording) {
      stopAndTranscribe();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        setIsLoading(true);
        try {
          const response = await fetch('/api/ai/speech-to-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blob,
          });
          const data = (await response.json()) as { success: boolean; text?: string; error?: string };
          if (data.success && data.text) {
            onTranscript(data.text);
          } else {
            showToast(data.error ?? '음성 인식에 실패했습니다. 다시 시도해주세요.', true);
          }
        } catch {
          showToast('음성 인식에 실패했습니다. 다시 시도해주세요.', true);
        } finally {
          setIsLoading(false);
        }
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        showToast('녹음 중 오류가 발생했습니다.', true);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);

      timerRef.current = setTimeout(stopAndTranscribe, MAX_RECORDING_MS);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('마이크 접근 권한이 필요합니다.', true);
      }
    }
  }, [isRecording, isLoading, onTranscript, stopAndTranscribe, setIsRecording]);

  return (
    <div className="relative">
      {isLoading ? (
        <button
          disabled
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-gray-400 bg-gray-100"
        >
          <Loader2 size={12} className="animate-spin" />
          인식 중...
        </button>
      ) : isRecording ? (
        <button
          onClick={handleClick}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100"
        >
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <Square size={11} />
          녹음 중
        </button>
      ) : (
        <button
          onClick={handleClick}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200"
        >
          <Mic size={12} />
          음성입력
        </button>
      )}

      {toastMessage && (
        <div
          className="absolute bottom-8 left-0 z-50 rounded-md px-3 py-1.5 text-xs shadow-md"
          style={{
            backgroundColor: toastMessage.isError ? 'rgba(254,242,242,1)' : 'rgba(240,253,244,1)',
            border: `1px solid ${toastMessage.isError ? 'rgba(190,0,20,0.3)' : 'rgba(74,222,128,0.4)'}`,
            color: toastMessage.isError ? '#be0014' : '#166534',
            whiteSpace: 'nowrap',
          }}
        >
          {toastMessage.text}
        </div>
      )}
    </div>
  );
};
