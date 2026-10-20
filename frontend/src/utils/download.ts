import { t } from '../i18n/store';

const API_BASE = '/api';

/**
 * Folder downloads are packed into a zip by a background job on the server. The
 * client polls the job so it can show that the server is compressing instead of
 * an opaque wait, then downloads the finished file with a plain browser
 * download. A browser can only receive a single file over HTTP, so a directory
 * must be packaged; this works for local and remote deployments in every
 * browser (unlike the File System Access API).
 */

export type DownloadStatus =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'error';

export interface DownloadState {
  status: DownloadStatus;
  filename: string;
  total: number;
  done: number;
  progress: number;
  errorText: string | null;
}

const INITIAL: DownloadState = {
  status: 'idle',
  filename: '',
  total: 0,
  done: 0,
  progress: 0,
  errorText: null,
};

let state: DownloadState = INITIAL;
const listeners = new Set<() => void>();

let pollTimer: number | null = null;
let currentJobId: string | null = null;
let cancelled = false;

function emit(): void {
  for (const fn of listeners) fn();
}

function setState(patch: Partial<DownloadState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeDownload(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getDownloadState(): DownloadState {
  return state;
}

function isActive(): boolean {
  return state.status === 'preparing' || state.status === 'running';
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fail(text: string): void {
  stopPolling();
  currentJobId = null;
  setState({ status: 'error', errorText: text });
}

/** Download a single file with its original bytes. */
export async function downloadFile(path: string): Promise<void> {
  const url = `${API_BASE}/filesystem/download?path=${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error('head failed');
  } catch {
    window.alert(t('download.error'));
    return;
  }
  triggerDownload(url);
}

interface PrepareResult {
  too_many: boolean;
  total: number;
  job_id?: string;
  filename?: string;
}

/** Pack a folder into a zip (server-side, with progress) and download it. */
export async function downloadFolder(path: string): Promise<void> {
  if (isActive()) return;
  stopPolling();
  cancelled = false;
  currentJobId = null;
  setState({ ...INITIAL, status: 'preparing' });

  let data: PrepareResult;
  try {
    const res = await fetch(`${API_BASE}/filesystem/prepare-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      fail((err as { detail?: string }).detail || t('download.error'));
      return;
    }
    data = (await res.json()) as PrepareResult;
  } catch {
    fail(t('download.error'));
    return;
  }
  if (cancelled) return;

  if (data.too_many) {
    fail(t('download.tooMany', { count: data.total }));
    return;
  }
  if (!data.job_id) {
    fail(t('download.error'));
    return;
  }
  currentJobId = data.job_id;
  setState({
    status: 'running',
    filename: data.filename ?? '',
    total: data.total,
    done: 0,
    progress: 0,
    errorText: null,
  });
  pollTimer = window.setInterval(() => void poll(data.job_id as string), 400);
  void poll(data.job_id);
}

async function poll(jobId: string): Promise<void> {
  if (cancelled || currentJobId !== jobId) return;
  let st: {
    state: string;
    progress?: number;
    total?: number;
    done?: number;
    error?: string;
  };
  try {
    const res = await fetch(
      `${API_BASE}/filesystem/zip-status?job_id=${encodeURIComponent(jobId)}`,
    );
    if (!res.ok) {
      fail(t('download.error'));
      return;
    }
    st = await res.json();
  } catch {
    // Transient network hiccup: keep polling.
    return;
  }
  if (cancelled || currentJobId !== jobId) return;

  if (st.state === 'pending' || st.state === 'running') {
    setState({
      status: 'running',
      done: st.done ?? 0,
      total: st.total ?? state.total,
      progress: st.progress ?? 0,
    });
  } else if (st.state === 'done') {
    stopPolling();
    currentJobId = null;
    triggerDownload(
      `${API_BASE}/filesystem/download-zip?job_id=${encodeURIComponent(jobId)}`,
    );
    // Auto-close: the browser's native download UI shows the transfer, so there
    // is nothing for the user to dismiss.
    state = INITIAL;
    emit();
  } else if (st.state === 'error') {
    fail(st.error || t('download.error'));
  }
}

/** Cancel the running pack job (best effort). */
export async function cancelDownload(): Promise<void> {
  const jobId = currentJobId;
  cancelled = true;
  stopPolling();
  currentJobId = null;
  setState({ status: 'cancelled' });
  if (jobId) {
    try {
      await fetch(`${API_BASE}/filesystem/cancel-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
    } catch {
      // best effort
    }
  }
}

/** Close the dialog (only when no job is running). */
export function closeDownload(): void {
  if (isActive()) return;
  cancelled = true;
  stopPolling();
  currentJobId = null;
  state = INITIAL;
  emit();
}
