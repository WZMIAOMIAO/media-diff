import type { VideoPlayerApi } from '../../hooks/video/useVideoPlayer';
import { SPEEDS } from '../../hooks/video/useVideoPlayer';
import Toggle from '../Toggle';

interface PlayerBarProps {
  player: VideoPlayerApi;
  mainFps: number;
}

function formatTime(frame: number, fps: number): string {
  if (fps <= 0) return '--';
  const sec = frame / fps;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      {muted ? (
        <>
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
    </svg>
  );
}

function PlayerBar({ player, mainFps }: PlayerBarProps) {
  const { isPlaying, currentFrame, baseFrameCount, speed, loop, muted } = player;
  const max = Math.max(1, baseFrameCount);

  const onProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = parseInt(e.target.value, 10);
    if (!Number.isNaN(f)) player.seekToFrame(f);
  };

  return (
    <div className="h-14 shrink-0 flex items-center gap-3 px-3 bg-[#252525] border-t border-[#3c3c3c]">
      <button
        type="button"
        onClick={player.togglePlay}
        title={isPlaying ? '暂停 (空格)' : '播放 (空格)'}
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-[#4a9eff] hover:opacity-90 text-white"
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>

      <div className="shrink-0 flex items-center gap-1">
        <button
          type="button"
          onClick={() => player.stepFrame(-1)}
          title="上一帧 (a)"
          className="px-2 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555] text-[#e0e0e0]"
        >
          ◀|
        </button>
        <button
          type="button"
          onClick={() => player.stepFrame(1)}
          title="下一帧 (d)"
          className="px-2 py-1 text-sm bg-[#333333] border border-[#3c3c3c] rounded hover:border-[#555555] text-[#e0e0e0]"
        >
          |▶
        </button>
      </div>

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="shrink-0 text-xs text-[#888888] tabular-nums w-16 text-right">
          {currentFrame}
        </span>
        <input
          type="range"
          min={1}
          max={max}
          value={Math.min(currentFrame, max)}
          onChange={onProgressChange}
          className="flex-1 min-w-0 accent-[#4a9eff]"
        />
        <span className="shrink-0 text-xs text-[#888888] tabular-nums w-16">
          /{max}
        </span>
      </div>

      <span className="shrink-0 text-xs text-[#888888] tabular-nums w-20 text-right">
        {formatTime(currentFrame, mainFps)}
      </span>

      <div className="shrink-0 flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => player.setSpeed(s)}
            className={`px-1.5 py-0.5 text-xs rounded border ${
              speed === s
                ? 'bg-[#4a9eff] border-[#4a9eff] text-white'
                : 'bg-[#333333] border-[#3c3c3c] text-[#e0e0e0] hover:border-[#555555]'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="shrink-0">
        <Toggle checked={loop} onChange={player.setLoop} color="#4a9eff" label="循环" />
      </div>

      <button
        type="button"
        onClick={() => player.setMuted(!muted)}
        title={muted ? '开启声音' : '关闭声音'}
        aria-pressed={!muted}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded border ${
          muted
            ? 'bg-[#333333] border-[#3c3c3c] text-[#888888] hover:border-[#555555]'
            : 'bg-[#4a9eff] border-[#4a9eff] text-white'
        }`}
      >
        <SpeakerIcon muted={muted} />
      </button>
    </div>
  );
}

export default PlayerBar;
