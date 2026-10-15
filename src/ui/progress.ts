import { byId } from './dom';

/** Loading overlay with a staged progress bar and cancel button, plus a transient toast. */
export class Progress {
  private readonly box = byId('loading');
  private readonly stage = byId('loading-stage');
  private readonly bar = byId('loading-bar');
  private readonly toastEl = byId('toast');
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(onCancel: () => void) {
    byId<HTMLButtonElement>('loading-cancel').addEventListener('click', onCancel);
  }

  show(text: string, fraction: number): void {
    this.box.hidden = false;
    this.stage.textContent = text;
    this.bar.style.width = `${Math.round(Math.max(0.03, Math.min(1, fraction)) * 100)}%`;
  }

  hide(): void {
    this.box.hidden = true;
  }

  toast(text: string, ms = 4000): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), ms);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
