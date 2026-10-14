/**
 * 指针手势：把 pointer 事件分解为 click / hover / drag 三种语义。
 * - click：按下与抬起位移 ≤ 阈值（旋转/平移拖拽不算点击）
 * - hover：节流到每帧一次（rAF 合并）
 */
export interface GestureEvents {
  onClick(e: PointerEvent): void;
  onHover(e: PointerEvent): void;
}

const DRAG_THRESHOLD_PX = 5;

export function attachGestures(
  domElement: HTMLElement,
  handlers: GestureEvents,
): () => void {
  let downPos: { x: number; y: number } | null = null;
  let lastHover: PointerEvent | null = null;
  let hoverScheduled = false;

  const onPointerDown = (e: PointerEvent): void => {
    downPos = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (downPos) {
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) downPos = null; // 已判定为拖拽
    }
    lastHover = e;
    if (!hoverScheduled) {
      hoverScheduled = true;
      requestAnimationFrame(() => {
        hoverScheduled = false;
        if (lastHover) handlers.onHover(lastHover);
      });
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (downPos) {
      downPos = null;
      handlers.onClick(e);
    }
  };

  const onPointerLeave = (): void => {
    downPos = null;
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointerleave', onPointerLeave);

  return () => {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointerleave', onPointerLeave);
  };
}
