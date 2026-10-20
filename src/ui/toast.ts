/**
 * Toast 轻提示（操作反馈/错误），自动消退。
 */
import { el } from './dom';

export interface Toaster {
  show(message: string, kind?: 'ok' | 'error'): void;
}

export function createToaster(root: HTMLElement): Toaster {
  return {
    show(message, kind = 'ok') {
      const toast = el('div', { class: `toast ${kind}` }, message);
      root.append(toast);
      window.setTimeout(() => {
        toast.style.transition = 'opacity 0.4s ease';
        toast.style.opacity = '0';
        window.setTimeout(() => toast.remove(), 420);
      }, 2600);
    },
  };
}
