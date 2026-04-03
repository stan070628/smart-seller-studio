/**
 * 프로젝트 관련 공통 TypeScript 타입 정의
 */

export interface Project {
  id: string
  user_id: string
  name: string
  canvas_state: object | null
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}
