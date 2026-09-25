import type { HistogramData, SelectedFolder, WatermarkConfig } from '../types';

export type { HistogramData, SelectedFolder, WatermarkConfig };

export interface VideoEntry {
  name: string;
  path: string;
}

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  duration: number;
  codec: string;
  format: string;
  /** 前端注入：该 info 对应的视频路径，用于追踪刷新 */
  path?: string;
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
