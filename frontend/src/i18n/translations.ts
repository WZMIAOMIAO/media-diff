export type Lang = 'zh' | 'en';

type Dict = Record<string, string>;

export const zh: Dict = {
  // common
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.browse': '浏览',
  'common.loading': '加载中...',
  'common.remove': '移除',
  'common.clear': '清除',
  'common.dragResize': '拖拽调整宽度',
  'common.removeRoot': '移除根目录',
  'common.copyFileName': '复制文件名',
  'common.searchImages': '搜索...',
  'common.searchVideos': '搜索视频...',

  // top nav
  'nav.watermark': '水印',
  'nav.histogram': 'RGB直方图',
  'nav.annotation': '标注模式',
  'nav.blind': '盲评模式',
  'nav.imageMode': '图像模式',
  'nav.videoMode': '视频模式',
  'nav.switchMode': '切换模式',
  'nav.help': '使用帮助',
  'nav.shortcuts': '快捷键',
  'nav.language': '语言',
  'nav.alert.annotationBlindConflict': '标注模式和盲评模式不能同时开启，请先关闭当前模式',
  'nav.alert.comingSoon': '开发中',

  // sidebar
  'sidebar.expandFolder': '展开文件夹面板',
  'sidebar.collapseFolder': '折叠文件夹面板',
  'sidebar.folders': '文件夹',
  'sidebar.selectedDirs': '已选对比目录',
  'sidebar.none': '暂无',

  // folder tree
  'tree.menu.add': '添加到多目录对比',
  'tree.menu.refresh': '刷新',
  'tree.menu.copyAbs': '复制绝对路径',
  'tree.menu.copyRel': '复制相对路径',
  'tree.empty': '请输入文件夹路径添加根目录',

  // folder input
  'folderInput.placeholder': '输入文件夹路径后回车...',
  'folderInput.browse': '浏览文件夹',
  'folderInput.notExist': '文件夹不存在',
  'folderInput.exists': '该路径已添加',

  // thumbnail panel
  'panel.preview': '预览图',
  'panel.videoList': '视频列表',
  'panel.intersection': '交集',
  'panel.clearSearch': '清除搜索',
  'panel.filter': '过滤: {query}',
  'panel.emptyHint': '请通过右键菜单添加对比文件夹',
  'column.noMatch': '无匹配结果',

  // window / compare area
  'window.noImage': '无图片',
  'window.noVideo': '无视频',
  'window.imageLoadFailed': '图片加载失败',
  'window.frameExtractFailed': '抽帧失败',
  'window.frameExtracting': '抽帧中...',
  'window.vote': '点赞（每组只能选一张）',
  'compare.emptyImage': '请添加对比文件夹后选择图片查看',
  'compare.emptyVideo': '请添加对比文件夹后选择视频查看',
  'overlay.fromWindow': '从窗口 {n} 覆盖',

  // color picker
  'colorPicker.enabled': '取色（Esc 退出）',
  'colorPicker.disabled': '视频播放时不可取色',

  // player bar
  'player.play': '播放 (空格)',
  'player.pause': '暂停 (空格)',
  'player.prevFrame': '上一帧 (a)',
  'player.nextFrame': '下一帧 (d)',
  'player.loop': '循环',
  'player.unmute': '开启声音',
  'player.mute': '关闭声音',

  // browse dialog
  'browse.back': '返回上级',
  'browse.placeholder': '输入路径或关键词后回车...',
  'browse.noSubdirs': '无子目录',
  'browse.select': '选择此文件夹',
  'browse.failed': '浏览失败',
  'browse.rootsFailed': '获取根目录失败',

  // watermark
  'watermark.title': '水印设置',
  'watermark.unified': '统一样式',
  'watermark.appliesAll': '应用到所有窗口',
  'watermark.color': '颜色',
  'watermark.customColor': '自定义颜色',
  'watermark.fontSize': '字号',
  'watermark.window': '窗口{n}',
  'watermark.placeholder': '输入水印文字',
  'watermark.fillNames': '填充文件夹名',
  'watermark.clearAll': '清除全部',

  // blind eval
  'media.image': '图片',
  'media.video': '视频',
  'blind.setupTitle': '盲评参数设置（共有同名{noun} {total} 个）',
  'blind.parts': '划分份数',
  'blind.currentPart': '当前第几份',
  'blind.seed': '随机种子',
  'blind.outputPath': '输出文件路径',
  'blind.outputPlaceholder': '目录或 .json 文件路径',
  'blind.enter': '进入盲评',
  'blind.processing': '处理中...',
  'blind.alert.outputRequired': '请填写输出文件路径',
  'blind.alert.partsMin': '划分份数至少为1',
  'blind.alert.partRange': '当前评测份数需在 1 到总份数之间',
  'blind.alert.partsTooMany': '划分份数不能大于{noun}总数（当前共 {total} 个）',
  'blind.alert.enterFailed': '进入盲评模式失败',
  'blind.confirm.loadExisting':
    '输出文件已存在且与当前对比项匹配，是否加载已有的盲评数据？\n点“取消”将退回设置窗口。',
  'blind.bar': '盲评',
  'blind.info': '评测信息',
  'blind.result': '获取评测结果',
  'blind.resultTitle': '评测结果（当前份共 {total} 项）',
  'blind.exitConfirm': '确定退出盲评模式吗？已投票结果已保存到文件。',
  'blind.needFolders': '盲评模式需要至少2个对比文件夹，请先添加',
  'blind.locked.add': '盲评模式下请先退出盲评再添加对比目录',
  'blind.locked.remove': '盲评模式下请先退出盲评再删除对比目录',
  'blind.locked.clear': '盲评模式下请先退出盲评再清除对比目录',
  'blind.voteFailed': '保存投票失败',
  'limit.folders': '不支持超过4个对比文件夹',

  // shortcut help
  'help.titleImage': '图像对比 · 快捷键',
  'help.titleVideo': '视频对比 · 快捷键',
  'help.close': '关闭',
  'help.group.view': '视图操作',
  'help.wheel': '以光标为中心同步缩放所有窗口（1.0x–16x）',
  'help.zoom': '快捷缩放所有窗口（↑ 放大 / ↓ 缩小，以窗口中心为锚点）',
  'help.drag': '放大后同步平移所有窗口',
  'help.dblclick': '在图像区域双击还原缩放',
  'help.group.colorPicker': '取色',
  'help.cpExit': '退出取色模式',
  'help.cpMove': '取色模式下移动鼠标，读取笔尖像素的 RGB',
  'help.group.preview': '预览列表',
  'help.previewCtrl': '点击缩略图：对齐所有文件夹到同名文件（无同名时对齐到相同序号）',
  'help.previewClick': '切换该文件夹的当前文件，其他窗口不变',
  'help.group.imageSwitch': '图片切换',
  'help.prevImage': '上一张图片',
  'help.nextImage': '下一张图片',
  'help.group.overlay': '覆盖对比',
  'help.overlayImage': '悬停窗口时按住数字键，覆盖显示对应窗口的图片（松开还原）',
  'help.group.playback': '播放控制',
  'help.space': '播放 / 暂停',
  'help.ad': '上一帧 / 下一帧（自动暂停）',
  'help.group.videoSwitch': '视频切换',
  'help.prevVideo': '上一个视频',
  'help.nextVideo': '下一个视频',
  'help.overlayVideo': '悬停窗口时按住数字键，覆盖显示对应窗口的当前帧（松开还原）',
  'help.noteImage':
    '提示：取色模式下所有窗口会在相同的相对坐标处显示各自的颜色；缩放与平移在所有窗口间同步。',
  'help.noteVideo':
    '提示：视频播放时取色按钮禁用，暂停后可正常取色；缩放与平移在所有窗口间同步。',
  'help.key.wheel': '滚轮',
  'help.key.drag': '拖拽',
  'help.key.dblclick': '双击',
  'help.key.rightClick': '右键',
  'help.key.move': '移动',
  'help.key.click': '单击',
  'help.key.space': '空格',

  // api / errors (frontend generated)
  'api.defaultDirFailed': '获取默认目录失败',
  'api.browseFailed': '浏览文件夹失败',
  'api.imageListFailed': '获取图片列表失败',
  'api.imageLoadFailed': '图片加载失败',
  'api.thumbFailed': '缩略图加载失败',
  'api.histogramFailed': '直方图加载失败',
  'api.blindFailed': '盲评请求失败',
  'api.videoListFailed': '获取视频列表失败',
  'api.videoInfoFailed': '视频信息获取失败',
  'api.frameFailed': '抽帧失败',
  'api.frameHistogramFailed': '帧直方图加载失败',
  'api.videoThumbFailed': '封面缩略图加载失败',
};

export const en: Dict = {
  // common
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.browse': 'Browse',
  'common.loading': 'Loading...',
  'common.remove': 'Remove',
  'common.clear': 'Clear',
  'common.dragResize': 'Drag to resize',
  'common.removeRoot': 'Remove root folder',
  'common.copyFileName': 'Copy file name',
  'common.searchImages': 'Search...',
  'common.searchVideos': 'Search videos...',

  // top nav
  'nav.watermark': 'Watermark',
  'nav.histogram': 'RGB Histogram',
  'nav.annotation': 'Annotation',
  'nav.blind': 'Blind Review',
  'nav.imageMode': 'Image',
  'nav.videoMode': 'Video',
  'nav.switchMode': 'Switch mode',
  'nav.help': 'Help',
  'nav.shortcuts': 'Shortcuts',
  'nav.language': 'Language',
  'nav.alert.annotationBlindConflict':
    'Annotation and Blind Review cannot be enabled at the same time. Please turn off the current mode first.',
  'nav.alert.comingSoon': 'Coming soon',

  // sidebar
  'sidebar.expandFolder': 'Expand folder panel',
  'sidebar.collapseFolder': 'Collapse folder panel',
  'sidebar.folders': 'Folders',
  'sidebar.selectedDirs': 'Selected folders',
  'sidebar.none': 'None',

  // folder tree
  'tree.menu.add': 'Add to compare',
  'tree.menu.refresh': 'Refresh',
  'tree.menu.copyAbs': 'Copy absolute path',
  'tree.menu.copyRel': 'Copy relative path',
  'tree.empty': 'Enter a folder path to add a root',

  // folder input
  'folderInput.placeholder': 'Type a folder path and press Enter...',
  'folderInput.browse': 'Browse folder',
  'folderInput.notExist': 'Folder does not exist',
  'folderInput.exists': 'Path already added',

  // thumbnail panel
  'panel.preview': 'Preview',
  'panel.videoList': 'Videos',
  'panel.intersection': 'Intersect',
  'panel.clearSearch': 'Clear search',
  'panel.filter': 'Filter: {query}',
  'panel.emptyHint': 'Add compared folders via the right-click menu',
  'column.noMatch': 'No matching result',

  // window / compare area
  'window.noImage': 'No image',
  'window.noVideo': 'No video',
  'window.imageLoadFailed': 'Failed to load image',
  'window.frameExtractFailed': 'Frame extraction failed',
  'window.frameExtracting': 'Extracting frame...',
  'window.vote': 'Vote (one per group)',
  'compare.emptyImage': 'Add compared folders and select an image',
  'compare.emptyVideo': 'Add compared folders and select a video',
  'overlay.fromWindow': 'Overlay from window {n}',

  // color picker
  'colorPicker.enabled': 'Pick color (Esc to exit)',
  'colorPicker.disabled': 'Unavailable while the video is playing',

  // player bar
  'player.play': 'Play (Space)',
  'player.pause': 'Pause (Space)',
  'player.prevFrame': 'Previous frame (a)',
  'player.nextFrame': 'Next frame (d)',
  'player.loop': 'Loop',
  'player.unmute': 'Unmute',
  'player.mute': 'Mute',

  // browse dialog
  'browse.back': 'Up',
  'browse.placeholder': 'Type a path or keyword and press Enter...',
  'browse.noSubdirs': 'No subfolders',
  'browse.select': 'Select this folder',
  'browse.failed': 'Browse failed',
  'browse.rootsFailed': 'Failed to load root directories',

  // watermark
  'watermark.title': 'Watermark Settings',
  'watermark.unified': 'Unified style',
  'watermark.appliesAll': 'Applies to all windows',
  'watermark.color': 'Color',
  'watermark.customColor': 'Custom color',
  'watermark.fontSize': 'Font size',
  'watermark.window': 'Window {n}',
  'watermark.placeholder': 'Watermark text',
  'watermark.fillNames': 'Fill folder names',
  'watermark.clearAll': 'Clear all',

  // blind eval
  'media.image': 'images',
  'media.video': 'videos',
  'blind.setupTitle': 'Blind review setup ({total} common {noun})',
  'blind.parts': 'Parts',
  'blind.currentPart': 'Current part',
  'blind.seed': 'Random seed',
  'blind.outputPath': 'Output file path',
  'blind.outputPlaceholder': 'Folder or .json file path',
  'blind.enter': 'Start',
  'blind.processing': 'Processing...',
  'blind.alert.outputRequired': 'Please enter an output file path',
  'blind.alert.partsMin': 'Parts must be at least 1',
  'blind.alert.partRange': 'Current part must be between 1 and the total parts',
  'blind.alert.partsTooMany': 'Parts cannot exceed the number of {noun} ({total} in total)',
  'blind.alert.enterFailed': 'Failed to start blind review',
  'blind.confirm.loadExisting':
    'The output file already exists and matches the current folders. Load the existing blind review data?\nClick "Cancel" to go back to the setup window.',
  'blind.bar': 'Blind',
  'blind.info': 'Review info',
  'blind.result': 'Get results',
  'blind.resultTitle': 'Results ({total} items in this part)',
  'blind.exitConfirm': 'Exit blind review? Your votes have already been saved.',
  'blind.needFolders': 'Blind review needs at least 2 compared folders',
  'blind.locked.add': 'Exit blind review before adding compared folders',
  'blind.locked.remove': 'Exit blind review before removing compared folders',
  'blind.locked.clear': 'Exit blind review before clearing compared folders',
  'blind.voteFailed': 'Failed to save vote',
  'limit.folders': 'At most 4 folders can be compared',

  // shortcut help
  'help.titleImage': 'Image Compare · Shortcuts',
  'help.titleVideo': 'Video Compare · Shortcuts',
  'help.close': 'Close',
  'help.group.view': 'View',
  'help.wheel': 'Zoom all windows around the cursor (1.0x–16x)',
  'help.zoom': 'Quick zoom all windows (↑ in / ↓ out, anchored at window centre)',
  'help.drag': 'Pan all windows when zoomed in',
  'help.dblclick': 'Double-click the image area to reset zoom',
  'help.group.colorPicker': 'Color picker',
  'help.cpExit': 'Exit color picker mode',
  'help.cpMove': 'Move the mouse in pick mode to read the pixel RGB',
  'help.group.preview': 'Preview list',
  'help.previewCtrl':
    'Click a thumbnail: align all folders to the same-named file (fallback to the same index)',
  'help.previewClick': "Switch that folder's current file, other windows unchanged",
  'help.group.imageSwitch': 'Image switching',
  'help.prevImage': 'Previous image',
  'help.nextImage': 'Next image',
  'help.group.overlay': 'Overlay compare',
  'help.overlayImage':
    "Hold a number key while hovering to overlay that window's image (release to restore)",
  'help.group.playback': 'Playback',
  'help.space': 'Play / Pause',
  'help.ad': 'Previous / next frame (auto pause)',
  'help.group.videoSwitch': 'Video switching',
  'help.prevVideo': 'Previous video',
  'help.nextVideo': 'Next video',
  'help.overlayVideo':
    "Hold a number key while hovering to overlay that window's current frame (release to restore)",
  'help.noteImage':
    'Note: In pick mode, all windows show their own color at the same relative position; zoom and pan are synced across windows.',
  'help.noteVideo':
    'Note: The color picker is disabled while playing; pause to pick colors. Zoom and pan are synced across windows.',
  'help.key.wheel': 'Wheel',
  'help.key.drag': 'Drag',
  'help.key.dblclick': 'Double-click',
  'help.key.rightClick': 'Right-click',
  'help.key.move': 'Move',
  'help.key.click': 'Click',
  'help.key.space': 'Space',

  // api / errors (frontend generated)
  'api.defaultDirFailed': 'Failed to get the default directory',
  'api.browseFailed': 'Failed to browse folder',
  'api.imageListFailed': 'Failed to get the image list',
  'api.imageLoadFailed': 'Failed to load image',
  'api.thumbFailed': 'Failed to load thumbnail',
  'api.histogramFailed': 'Failed to load histogram',
  'api.blindFailed': 'Blind review request failed',
  'api.videoListFailed': 'Failed to get the video list',
  'api.videoInfoFailed': 'Failed to get video info',
  'api.frameFailed': 'Frame extraction failed',
  'api.frameHistogramFailed': 'Failed to load frame histogram',
  'api.videoThumbFailed': 'Failed to load video thumbnail',
};

export const dictionaries: Record<Lang, Dict> = { zh, en };
