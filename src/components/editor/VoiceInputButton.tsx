'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import useEditorStore from '@/store/useEditorStore';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
}

const MAX_RECORDING_MS = 60_000;
const TARGET_SAMPLE_RATE = 16000;

function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return buffer;
  const ratio = inputRate / outputRate;
  const length = Math.floor(buffer.length / ratio);
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = buffer[Math.floor(i * ratio)];
  }
  return result;
}

function float32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const clamped = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return result;
}

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ onTranscript }) => {
  const isRecording = useEditorStore((s) => s.isRecording);
  const setIsRecording = useEditorStore((s) => s.setIsRecording);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      processorRef.current?.disconnect();
      gainRef.current?.disconnect();
      void audioCtxRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const showToast = useCallback((text: string, isError: boolean) => {
    if (!mountedRef.current) return;
    setToastMessage({ text, isError });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setToastMessage(null);
    }, 3000);
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    const samples = samplesRef.current.splice(0);
    const ctx = audioCtxRef.current;
    const inputSampleRate = ctx?.sampleRate ?? TARGET_SAMPLE_RATE;

    processorRef.current?.disconnect();
    processorRef.current = null;
    gainRef.current?.disconnect();
    gainRef.current = null;
    void ctx?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setIsRecording(false);

    if (samples.length === 0) return;
    setIsLoading(true);

    try {
      const totalLength = samples.reduce((s, b) => s + b.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of samples) { merged.set(chunk, offset); offset += chunk.length; }

      const downsampled = downsampleBuffer(merged, inputSampleRate, TARGET_SAMPLE_RATE);
      const pcm16 = float32ToInt16(downsampled);

      const response = await fetch('/api/ai/speech-to-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: pcm16.buffer as ArrayBuffer,
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
      if (mountedRef.current) setIsLoading(false);
    }
  }, [onTranscript, setIsRecording, showToast]);

  const handleClick = useCallback(async () => {
    if (isLoading) return;

    if (isRecording) {
      void stopAndTranscribe();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      samplesRef.current = [];

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessorNode must be connected to destination to fire in all browsers.
      // A gain=0 node prevents audio echo from the microphone feed.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const gain = ctx.createGain();
      gain.gain.value = 0;

      processor.onaudioprocess = (e) => {
        samplesRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(ctx.destination);
      processorRef.current = processor;
      gainRef.current = gain;

      setIsRecording(true);
      timerRef.current = setTimeout(() => { void stopAndTranscribe(); }, MAX_RECORDING_MS);
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          showToast('마이크 접근 권한이 필요합니다.', true);
        } else if (err.name === 'NotFoundError') {
          showToast('마이크를 찾을 수 없습니다.', true);
        } else {
          showToast('마이크를 시작할 수 없습니다.', true);
        }
      }
    }
  }, [isRecording, isLoading, stopAndTranscribe, showToast, setIsRecording]);

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
