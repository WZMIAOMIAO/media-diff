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
  /** 是否给文字描边（提升在复杂背景上的可读性） */
  outline?: boolean;
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
  /** 递归（含子文件夹）时按相对路径配对 */
  recursive?: boolean;
}

/** Runtime blind evaluation state exposed by the compare hooks. */
export interface BlindEvalApi {
  aliases: Record<string, string>;
  order: string[];
  /** 盲评的配对 key 是否为相对路径（递归模式） */
  recursive: boolean;
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

/** One annotation record: compared media paths (window order) + question/answer. */
export interface AnnotationEntry {
  /** Image mode compared paths. */
  image?: string[];
  /** Video mode compared paths. */
  video?: string[];
  question: string;
  answer: string;
}

export type AnnotationMedia = 'image' | 'video';

export interface AnnotationCheckResult {
  /** Resolved JSON file path (directory input gains the default filename). */
  path: string;
  exists: boolean;
  writable: boolean;
}

/** Runtime annotation state exposed by the compare hooks. */
export interface AnnotationApi {
  /** Which media this annotation session is for. */
  media: AnnotationMedia;
  outputPath: string;
  /** Number of media groups currently navigable. */
  total: number;
  /** Of those, how many already have an annotation entry. */
  annotatedCount: number;
  /** Whether the current group has been annotated. */
  isAnnotated: boolean;
  question: string;
  setQuestion: (question: string) => void;
  result: string;
  setResult: (result: string) => void;
  commonTexts: string[];
  addCommonText: (text: string) => void;
  removeCommonText: (text: string) => void;
  submit: () => Promise<void>;
}
