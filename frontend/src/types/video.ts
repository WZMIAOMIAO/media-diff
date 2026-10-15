import type { HistogramData, SelectedFolder, WatermarkConfig } from '../types';

export type { HistogramData, SelectedFolder, WatermarkConfig };

export interface VideoEntry {
  name: string;
  path: string;
  /** 递归列出时相对所选根目录的路径（posix 分隔符）；扁平模式为 undefined */
  rel?: string;
  /** 前端注入的对齐占位项：该 key 在本文件夹中不存在 */
  missing?: boolean;
}

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  duration: number;
  codec: string;
  format: string;
  /** 后端探测：该编码浏览器是否可直接解码（false 时需转码） */
  browser_playable?: boolean;
  /** 文件修改时间/大小，用于给流地址加版本号以避免浏览器复用过期缓存 */
  mtime?: number;
  size?: number;
  /** 前端注入：该 info 对应的视频路径，用于追踪刷新 */
  path?: string;
}

export type TranscodeState =
  | 'none'
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'not_needed';

export interface TranscodeStatus {
  state: TranscodeState;
  progress: number;
  error?: string | null;
}

export interface VideoTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  isVideo?: boolean;
  hasChildren?: boolean;
  loaded: boolean;
  expanded: boolean;
  children?: VideoTreeNode[];
}

export interface VideoBrowseResult {
  path: string;
  subdirs: { name: string; path: string; has_children: boolean }[];
  videos: VideoEntry[];
}

export type AddRootResult = 'ok' | 'not_exist' | 'exists';
