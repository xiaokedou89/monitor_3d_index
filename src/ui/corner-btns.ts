/**
 * 右上角图标按钮（P4）：💬 智能助手 / ❓ 帮助。
 * 两者互斥（打开一个自动关闭另一个），激活态高亮。
 */
import type { AppStore } from './store/app-store';
import { clear, el } from './dom';

export interface CornerBtnsDeps {
  root: HTMLElement;
  appStore: AppStore;
}

export interface CornerBtns {
  dispose(): void;
}

export function createCornerBtns(deps: CornerBtnsDeps): CornerBtns {
  const { root, appStore } = deps;

  const render = (): void => {
    clear(root);
    const st = appStore.get();
    root.append(
      el('button', {
        class: `corner-btn${st.assistantOpen ? ' active' : ''}`,
        'data-corner-btn': 'assistant',
        title: '智能助手（离线演示问答）',
        text: '💬',
        onclick: () => appStore.set({ assistantOpen: !st.assistantOpen, helpOpen: false }),
      }),
      el('button', {
        class: `corner-btn${st.helpOpen ? ' active' : ''}`,
        'data-corner-btn': 'help',
        title: '帮助（连接语义 / 操作说明）',
        text: '❓',
        onclick: () => appStore.set({ helpOpen: !st.helpOpen, assistantOpen: false }),
      }),
    );
  };

  const unsub = appStore.subscribe(() => render());
  render();
  return {
    dispose() {
      unsub();
    },
  };
}
