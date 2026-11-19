export type DialogKind = 'alert' | 'confirm';

export interface DialogOptions {
  title?: string;
}

interface DialogRequest {
  kind: DialogKind;
  message: string;
  title?: string;
  resolve: (confirmed: boolean) => void;
}

let current: DialogRequest | null = null;
const queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function enqueue(request: DialogRequest): void {
  if (current) {
    queue.push(request);
    return;
  }
  current = request;
  emit();
}

export function subscribeDialog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCurrentDialog(): DialogRequest | null {
  return current;
}

export function closeDialog(confirmed: boolean): void {
  const request = current;
  if (!request) return;
  current = queue.shift() ?? null;
  request.resolve(confirmed);
  emit();
}

export function showAlert(message: string, options: DialogOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    enqueue({
      kind: 'alert',
      message,
      title: options.title,
      resolve: () => resolve(),
    });
  });
}

export function showConfirm(message: string, options: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: 'confirm',
      message,
      title: options.title,
      resolve,
    });
  });
}
