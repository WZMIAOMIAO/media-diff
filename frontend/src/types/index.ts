export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  isImage?: boolean;
  hasChildren?: boolean;
  loaded: boolean;
  expanded: boolean;
  children?: TreeNode[];
}

export interface SelectedFolder {
  path: string;
  name: string;
}

export interface HistogramData {
  r: number[]; // 256 bins
  g: number[];
  b: number[];
  rMean: number;
  gMean: number;
  bMean: number;
}

export interface WatermarkConfig {
  text: string;
  color: string; // hex 如 #ff0000
  fontSize: number; // 8~72
}
