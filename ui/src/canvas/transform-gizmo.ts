import { CanvasTransform } from '../types/schema';

export type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'body' | null;

export interface GizmoCallbacks {
  onTransformStart?: () => void;
  onTransformChange: (transform: CanvasTransform) => void;
  onTransformEnd: () => void;
  onDelete?: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
}

export class TransformGizmo {
  private container: HTMLElement;
  private gizmoEl: HTMLElement;
  private transform: CanvasTransform | null = null;
  private callbacks: GizmoCallbacks | null = null;
  private activeHandle: HandleType = null;
  private dragStart = { x: 0, y: 0 };
  private initialTransform: CanvasTransform | null = null;
  private visible: boolean = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.gizmoEl = document.createElement('div');
    this.gizmoEl.className = 'transform-gizmo hidden';
    this.createDom();
    this.container.appendChild(this.gizmoEl);
    this.bindEvents();
  }

  private createDom(): void {
    this.gizmoEl.innerHTML = `
      <div class="gizmo-bounds">
        <div class="gizmo-rot-stem"></div>
        <div class="gizmo-handle handle-rot" data-handle="rotate" title="Rotate (Shift to snap 15°)"></div>
        <div class="gizmo-handle handle-nw" data-handle="nw"></div>
        <div class="gizmo-handle handle-n" data-handle="n"></div>
        <div class="gizmo-handle handle-ne" data-handle="ne"></div>
        <div class="gizmo-handle handle-e" data-handle="e"></div>
        <div class="gizmo-handle handle-se" data-handle="se"></div>
        <div class="gizmo-handle handle-s" data-handle="s"></div>
        <div class="gizmo-handle handle-sw" data-handle="sw"></div>
        <div class="gizmo-handle handle-w" data-handle="w"></div>
        <div class="gizmo-body" data-handle="body"></div>
        <div class="gizmo-actions">
          <button class="gizmo-btn" id="gizmoFrontBtn" title="Bring Forward (Step up layer)">↑</button>
          <button class="gizmo-btn" id="gizmoBackBtn" title="Send Backward (Step down layer)">↓</button>
          <button class="gizmo-btn danger" id="gizmoDelBtn" title="Delete">✕</button>
        </div>
      </div>
    `;
  }

  public attach(
    transform: CanvasTransform,
    callbacks: GizmoCallbacks,
    isAboveInk: boolean = false,
    showLayerButtons: boolean = true,
    showTransformHandles: boolean = true
  ): void {
    this.transform = { ...transform };
    this.callbacks = callbacks;
    this.visible = true;
    this.gizmoEl.classList.remove('hidden');
    this.setLayerState(isAboveInk);
    this.showLayerControls(showLayerButtons);
    this.showTransformHandles(showTransformHandles);
    this.updatePosition();
  }

  public showLayerControls(show: boolean): void {
    const frontBtn = this.gizmoEl.querySelector('#gizmoFrontBtn') as HTMLElement;
    const backBtn = this.gizmoEl.querySelector('#gizmoBackBtn') as HTMLElement;
    if (frontBtn) frontBtn.style.display = show ? '' : 'none';
    if (backBtn) backBtn.style.display = show ? '' : 'none';
  }

  public showTransformHandles(show: boolean): void {
    const handles = this.gizmoEl.querySelectorAll('.gizmo-handle, .gizmo-rot-stem');
    handles.forEach((el) => {
      (el as HTMLElement).style.display = show ? '' : 'none';
    });
  }

  public setLayerState(isAboveInk: boolean): void {
    const frontBtn = this.gizmoEl.querySelector('#gizmoFrontBtn') as HTMLElement;
    const backBtn = this.gizmoEl.querySelector('#gizmoBackBtn') as HTMLElement;
    if (frontBtn && backBtn) {
      frontBtn.title = isAboveInk ? 'Bring Forward' : 'Bring Forward (Step up layer / above ink)';
      backBtn.title = isAboveInk ? 'Send Backward (Step down layer / below ink)' : 'Send Backward';
    }
  }

  public detach(): void {
    this.transform = null;
    this.callbacks = null;
    this.visible = false;
    this.gizmoEl.classList.add('hidden');
  }

  public isAttached(): boolean {
    return this.visible && this.transform !== null;
  }

  public updateTransform(transform: CanvasTransform): void {
    if (!this.visible) return;
    this.transform = { ...transform };
    this.updatePosition();
  }

  private updatePosition(): void {
    if (!this.transform) return;
    const { x, y, width, height, rotation } = this.transform;
    this.gizmoEl.style.left = `${x}px`;
    this.gizmoEl.style.top = `${y}px`;
    this.gizmoEl.style.width = `${width}px`;
    this.gizmoEl.style.height = `${height}px`;
    this.gizmoEl.style.transform = `rotate(${rotation}deg)`;
  }

  private bindEvents(): void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !this.transform) return;
      const target = e.target as HTMLElement;
      let handle = target.dataset.handle as HandleType;

      if (!handle) {
        if (target === this.gizmoEl || target.closest('.gizmo-bounds') || target.classList.contains('gizmo-bounds')) {
          if (target.closest('.gizmo-actions')) return;
          handle = 'body';
        }
      }

      if (handle) {
        e.stopPropagation();
        this.activeHandle = handle;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialTransform = { ...this.transform };
        this.gizmoEl.setPointerCapture(e.pointerId);
        if (this.callbacks && this.callbacks.onTransformStart) {
          this.callbacks.onTransformStart();
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.activeHandle || !this.initialTransform || !this.transform) return;
      e.stopPropagation();

      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const init = this.initialTransform;

      if (this.activeHandle === 'rotate') {
        const cx = init.x + init.width / 2;
        const cy = init.y + init.height / 2;
        const rad = Math.atan2(e.clientY - cy, e.clientX - cx);
        let deg = (rad * 180) / Math.PI + 90;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }
        this.transform.rotation = Math.round(deg);
      } else if (this.activeHandle === 'se' || this.activeHandle === 'nw' || this.activeHandle === 'ne' || this.activeHandle === 'sw') {
        const aspect = init.width / Math.max(init.height, 1);
        let newWidth = init.width;
        let newHeight = init.height;

        if (this.activeHandle === 'se') {
          newWidth = Math.max(30, init.width + dx);
          if (!e.shiftKey) {
            newHeight = newWidth / aspect;
          } else {
            newHeight = Math.max(30, init.height + dy);
          }
        } else if (this.activeHandle === 'sw') {
          newWidth = Math.max(30, init.width - dx);
          if (!e.shiftKey) {
            newHeight = newWidth / aspect;
          } else {
            newHeight = Math.max(30, init.height + dy);
          }
          this.transform.x = init.x + (init.width - newWidth);
        } else if (this.activeHandle === 'ne') {
          newWidth = Math.max(30, init.width + dx);
          if (!e.shiftKey) {
            newHeight = newWidth / aspect;
          } else {
            newHeight = Math.max(30, init.height - dy);
          }
          this.transform.y = init.y + (init.height - newHeight);
        } else if (this.activeHandle === 'nw') {
          newWidth = Math.max(30, init.width - dx);
          if (!e.shiftKey) {
            newHeight = newWidth / aspect;
          } else {
            newHeight = Math.max(30, init.height - dy);
          }
          this.transform.x = init.x + (init.width - newWidth);
          this.transform.y = init.y + (init.height - newHeight);
        }

        this.transform.width = Math.round(newWidth);
        this.transform.height = Math.round(newHeight);
      } else if (this.activeHandle === 'e') {
        this.transform.width = Math.max(30, Math.round(init.width + dx));
      } else if (this.activeHandle === 's') {
        this.transform.height = Math.max(30, Math.round(init.height + dy));
      } else if (this.activeHandle === 'w') {
        const nw = Math.max(30, init.width - dx);
        this.transform.x = Math.round(init.x + (init.width - nw));
        this.transform.width = Math.round(nw);
      } else if (this.activeHandle === 'n') {
        const nh = Math.max(30, init.height - dy);
        this.transform.y = Math.round(init.y + (init.height - nh));
        this.transform.height = Math.round(nh);
      } else if (this.activeHandle === 'body') {
        this.transform.x = Math.round(init.x + dx);
        this.transform.y = Math.round(init.y + dy);
      }

      this.updatePosition();
      if (this.callbacks) {
        this.callbacks.onTransformChange(this.transform);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.activeHandle) return;
      this.activeHandle = null;
      try {
        this.gizmoEl.releasePointerCapture(e.pointerId);
      } catch {
      }
      if (this.callbacks) {
        this.callbacks.onTransformEnd();
      }
    };

    this.gizmoEl.addEventListener('pointerdown', onPointerDown);
    this.gizmoEl.addEventListener('pointermove', onPointerMove);
    this.gizmoEl.addEventListener('pointerup', onPointerUp);
    this.gizmoEl.addEventListener('pointercancel', onPointerUp);

    const delBtn = this.gizmoEl.querySelector('#gizmoDelBtn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks && this.callbacks.onDelete) {
          this.callbacks.onDelete();
        }
      });
    }

    const frontBtn = this.gizmoEl.querySelector('#gizmoFrontBtn');
    if (frontBtn) {
      frontBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks && this.callbacks.onBringForward) {
          this.callbacks.onBringForward();
        }
      });
    }

    const backBtn = this.gizmoEl.querySelector('#gizmoBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks && this.callbacks.onSendBackward) {
          this.callbacks.onSendBackward();
        }
      });
    }
  }
}
