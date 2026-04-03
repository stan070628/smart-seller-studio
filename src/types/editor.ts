/**
 * editor.ts
 * 에디터 전반에서 사용하는 TypeScript 타입 정의 모음
 */

// ---------------------------------------------------------------------------
// 이미지 관련 타입
// ---------------------------------------------------------------------------

/** 사용자가 업로드한 단일 이미지 정보 */
export interface UploadedImage {
  /** 브라우저 내에서만 유효한 ObjectURL (URL.createObjectURL 결과) */
  id: string;
  url: string;
  /** 원본 파일명 */
  name: string;
  /** 파일 크기 (bytes) */
  size: number;
  /** 업로드 시각 (ISO 문자열) */
  uploadedAt: string;
  /** Supabase Storage 업로드 완료 후 교체될 URL */
  storageUrl?: string;
  /** Storage 업로드 진행 상태 */
  uploadStatus: 'pending' | 'uploading' | 'done' | 'error';
  /** base64 변환을 위해 보관하는 원본 File 객체 (2B 이미지 분석에서 사용) */
  file?: File;
}

// ---------------------------------------------------------------------------
// 이미지 분석 결과 타입
// ---------------------------------------------------------------------------

export interface ImageAnalysisResult {
  material: string;
  shape: string;
  colors: string[];
  keyComponents: string[];
  visualPrompt: string;
}

// ---------------------------------------------------------------------------
// AI 카피 관련 타입
// ---------------------------------------------------------------------------

/** AI가 생성한 제목/카피 단건 */
export interface GeneratedCopy {
  id: string;
  /** 제목 카피 텍스트 */
  title: string;
  /** 서브 카피 텍스트 (선택적) */
  subtitle?: string;
}

// ---------------------------------------------------------------------------
// 캔버스 객체 관련 타입
// ---------------------------------------------------------------------------

/** 캔버스 위에 배치되는 객체 종류 */
export type CanvasObjectType = 'image' | 'text' | 'textbox';

/** 캔버스 객체 기본 인터페이스 */
export interface CanvasObjectBase {
  /** Fabric.js 객체와 동기화할 고유 ID */
  id: string;
  type: CanvasObjectType;
  /** 캔버스 내 x 좌표 */
  left: number;
  /** 캔버스 내 y 좌표 */
  top: number;
  /** 표시 너비 */
  width: number;
  /** 표시 높이 */
  height: number;
  /** 회전 각도 (degrees) */
  angle: number;
  /** z-index (렌더 순서) */
  zIndex: number;
}

/** 이미지 캔버스 객체 */
export interface CanvasImageObject extends CanvasObjectBase {
  type: 'image';
  /** UploadedImage 의 id 참조 */
  imageId: string;
  /** 실제 렌더에 사용할 ObjectURL */
  src: string;
}

/** 텍스트 캔버스 객체 */
export interface CanvasTextObject extends CanvasObjectBase {
  type: 'text' | 'textbox';
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fill: string;
  textAlign: 'left' | 'center' | 'right';
}

/** 캔버스 객체 유니온 타입 */
export type CanvasObject = CanvasImageObject | CanvasTextObject;

// ---------------------------------------------------------------------------
// 선택된 캔버스 객체 속성 타입 (우측 PropertiesPanel 용)
// ---------------------------------------------------------------------------

/** 현재 선택된 Fabric 객체의 편집 가능 속성 스냅샷 */
export interface SelectedObjectProps {
  /** Fabric 커스텀 속성 __ssId 와 일치하는 고유 ID */
  id: string;
  /** 객체 종류 */
  type: 'text' | 'image';
  // 텍스트 전용
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fill?: string;
  textAlign?: string;
  // 공통
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
}

// ---------------------------------------------------------------------------
// 에디터 스토어 상태 타입
// ---------------------------------------------------------------------------

/** Zustand 스토어 전체 상태 & 액션 */
export interface EditorStore {
  // --- 상태 ---
  /** 업로드된 이미지 목록 */
  uploadedImages: UploadedImage[];
  /** 쿠팡 리뷰 텍스트 */
  reviewText: string;
  /** AI 생성 제목 카피 목록 (최대 3개) */
  generatedCopies: GeneratedCopy[];
  /** 캔버스 위 객체 목록 */
  canvasObjects: CanvasObject[];
  /** AI 카피 생성 로딩 여부 */
  isGenerating: boolean;
  /** PNG 내보내기 트리거 카운터 (0이면 미실행) */
  exportTrigger: number;
  /** 이미지 AI 분석 결과 */
  imageAnalysis: ImageAnalysisResult | null;
  /** 이미지 분석 로딩 여부 */
  isAnalyzing: boolean;
  /** 현재 선택된 Fabric 객체 ID (없으면 null) */
  selectedObjectId: string | null;
  /** 현재 선택된 객체의 편집 가능 속성 스냅샷 (없으면 null) */
  selectedObjectProps: SelectedObjectProps | null;
  /** 캔버스 배경색 HEX 문자열 */
  canvasBgColor: string;
  /** Undo/Redo 히스토리 스택 (최대 51 스텝) */
  canvasHistory: CanvasObject[][];
  /** 현재 히스토리 포인터 인덱스 */
  historyIndex: number;

  // --- 액션 ---
  addImage: (image: UploadedImage) => void;
  removeImage: (id: string) => void;
  updateImageStatus: (
    id: string,
    patch: Partial<Pick<UploadedImage, 'storageUrl' | 'uploadStatus'>>,
  ) => void;
  setReviewText: (text: string) => void;
  setGeneratedCopies: (copies: GeneratedCopy[]) => void;
  setIsGenerating: (value: boolean) => void;
  addCanvasObject: (obj: CanvasObject) => void;
  updateCanvasObject: (id: string, patch: Partial<CanvasObject>) => void;
  removeCanvasObject: (id: string) => void;
  clearCanvasObjects: () => void;
  triggerExport: () => void;
  setImageAnalysis: (result: ImageAnalysisResult | null) => void;
  setIsAnalyzing: (value: boolean) => void;
  /** 선택 객체 변경 시 id + props 동시 업데이트 */
  setSelectedObject: (id: string | null, props: SelectedObjectProps | null) => void;
  /** 캔버스 배경색 변경 */
  setBgColor: (color: string) => void;
  /** 현재 canvasObjects 스냅샷을 히스토리에 추가 */
  pushHistory: (objects: CanvasObject[]) => void;
  /** 한 단계 되돌리기 */
  undo: () => void;
  /** 한 단계 앞으로 */
  redo: () => void;
}
