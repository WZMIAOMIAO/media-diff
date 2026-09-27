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

export interface BlindSetupResult {
  existing_file_matched: boolean;
  output_path: string;
  /** folder path -> alias (A/B/C/D) */
  aliases: Record<string, string>;
  /** current part file names, already shuffled */
  common_files: string[];
  /** image name -> window order, indexed by visual position -> folder index */
  display_orders: Record<string, number[]>;
  /** alias -> list of winning image names */
  win_lists: Record<string, string[]>;
}

export type BlindMedia = 'image' | 'video';

export interface BlindSetupParams {
  paths: string[];
  total_parts: number;
  current_part: number;
  seed: number;
  output_path: string;
  load_existing?: boolean;
  media?: BlindMedia;
}

/** Runtime blind evaluation state exposed by the compare hooks. */
export interface BlindEvalApi {
  aliases: Record<string, string>;
  order: string[];
  displayOrders: Record<string, number[]>;
  outputPath: string;
  index: number;
  total: number;
  /** file name -> winning alias */
  votes: Map<string, string>;
  votedCount: number;
  setIndex: (index: number) => void;
  vote: (name: string, alias: string | null) => Promise<void>;
}


