import { useEffect } from 'react';

export type HelpMode = 'image' | 'video';

interface ShortcutItem {
  keys: string[];
  desc: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const VIEW_SECTION: ShortcutSection = {
  title: '视图操作',
  items: [
    { keys: ['滚轮'], desc: '以光标为中心同步缩放所有窗口（1.0x–16x）' },
    { keys: ['拖拽'], desc: '放大后同步平移所有窗口' },
    { keys: ['双击'], desc: '在图像区域双击还原缩放' },
  ],
};

const PICKER_SECTION: ShortcutSection = {
  title: '取色',
  items: [
    { keys: ['Esc', '右键'], desc: '退出取色模式' },
    { keys: ['移动'], desc: '取色模式下移动鼠标，读取笔尖像素的 RGB' },
  ],
};

const THUMBNAIL_SECTION: ShortcutSection = {
  title: '预览列表',
  items: [
    { keys: ['Ctrl', '⌘'], desc: '点击缩略图：对齐所有文件夹到同名文件（无同名时对齐到相同序号）' },
    { keys: ['单击'], desc: '切换该文件夹的当前文件，其他窗口不变' },
  ],
};

const IMAGE_SECTIONS: ShortcutSection[] = [
  {
    title: '图片切换',
    items: [
      { keys: ['←'], desc: '上一张图片' },
      { keys: ['→'], desc: '下一张图片' },
    ],
  },
  VIEW_SECTION,
  {
    title: '覆盖对比',
    items: [
      { keys: ['1–4'], desc: '悬停窗口时按住数字键，覆盖显示对应窗口的图片（松开还原）' },
    ],
  },
  THUMBNAIL_SECTION,
  PICKER_SECTION,
];

const VIDEO_SECTIONS: ShortcutSection[] = [
  {
    title: '播放控制',
    items: [
      { keys: ['空格'], desc: '播放 / 暂停' },
      { keys: ['A', 'D'], desc: '上一帧 / 下一帧（自动暂停）' },
    ],
  },
  {
    title: '视频切换',
    items: [
      { keys: ['←'], desc: '上一个视频' },
      { keys: ['→'], desc: '下一个视频' },
    ],
  },
  VIEW_SECTION,
  {
    title: '覆盖对比',
    items: [
      { keys: ['1–4'], desc: '悬停窗口时按住数字键，覆盖显示对应窗口的当前帧（松开还原）' },
    ],
  },
  THUMBNAIL_SECTION,
  PICKER_SECTION,
];

const TIPS: Record<HelpMode, string> = {
  image:
    '提示：取色模式下所有窗口会在相同的相对坐标处显示各自的颜色；缩放与平移在所有窗口间同步。',
  video:
    '提示：视频播放时取色按钮禁用，暂停后可正常取色；缩放与平移在所有窗口间同步。',
};

interface ShortcutHelpDialogProps {
  mode: HelpMode;
  onClose: () => void;
}

export default function ShortcutHelpDialog({ mode, onClose }: ShortcutHelpDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections = mode === 'video' ? VIDEO_SECTIONS : IMAGE_SECTIONS;
  const title = mode === 'video' ? '视频对比 · 快捷键' : '图像对比 · 快捷键';

  const backdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={backdropClick}
    >
      <div className="w-[560px] max-h-[80vh] overflow-auto bg-[#2b2b2b] border border-[#3c3c3c] rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c]">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#4a9eff] text-sm font-bold text-white">
              ?
            </span>
            <span className="text-sm font-bold text-[#e0e0e0]">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="flex items-center justify-center w-6 h-6 rounded text-[#888888] hover:bg-[#3c3c3c] hover:text-[#e0e0e0]"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="mb-2 text-xs text-[#888888]">{section.title}</div>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <div key={item.desc} className="flex items-center gap-3">
                    <div className="flex w-[136px] shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={`${k}-${i}`} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-[#666666]">/</span>}
                          <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded border border-[#3c3c3c] border-b-2 bg-[#1e1e1e] px-1.5 font-mono text-[11px] text-[#e0e0e0]">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                    <span className="text-sm text-[#c0c0c0]">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#3c3c3c] px-4 py-3 text-xs leading-relaxed text-[#888888]">
          {TIPS[mode]}
        </div>
      </div>
    </div>
  );
}
