import { importImage } from '../ipc-client';
import { ImageElement } from '../types/schema';
import { generateUUID } from './stroke';
import { TransformGizmo } from './transform-gizmo';

export interface MediaManagerOptions {
  container: HTMLElement;
  gizmo: TransformGizmo;
  onChange?: (images: ImageElement[]) => void;
}

export class MediaManager {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasAbove: HTMLCanvasElement;
  private ctxAbove: CanvasRenderingContext2D;
  private gizmo: TransformGizmo;
  private images: ImageElement[] = [];
  private selectedImageId: string | null = null;
  private onChange?: (images: ImageElement[]) => void;
  private enabled: boolean = false;

  constructor(options: MediaManagerOptions) {
    this.container = options.container;
    this.gizmo = options.gizmo;
    this.onChange = options.onChange;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'mediaCanvas';
    this.canvas.className = 'media-canvas';
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('Failed to get 2D context for media canvas');
    }
    this.ctx = context;
    this.container.appendChild(this.canvas);

    this.canvasAbove = document.createElement('canvas');
    this.canvasAbove.id = 'mediaCanvasAbove';
    this.canvasAbove.className = 'media-canvas-above';
    const contextAbove = this.canvasAbove.getContext('2d', { alpha: true });
    if (!contextAbove) {
      throw new Error('Failed to get 2D context for mediaCanvasAbove');
    }
    this.ctxAbove = contextAbove;
    this.container.appendChild(this.canvasAbove);

    this.bindEvents();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.deselect();
    }
  }

  public resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.canvasAbove.width = Math.floor(width * dpr);
    this.canvasAbove.height = Math.floor(height * dpr);
    this.canvasAbove.style.width = `${width}px`;
    this.canvasAbove.style.height = `${height}px`;
    this.ctxAbove.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.renderAll();
  }

  public getImages(): ImageElement[] {
    return [...this.images];
  }

  public setImages(images: ImageElement[]): void {
    this.images = [...images];
    for (const img of this.images) {
      if (!img.imgElement && img.src) {
        const imageEl = new Image();
        imageEl.src = img.src;
        imageEl.onload = () => this.renderAll();
        img.imgElement = imageEl;
      }
    }
    this.renderAll();
  }

  public async importImageFile(file: File, x?: number, y?: number): Promise<ImageElement | null> {
    try {
      const base64Data = await this.fileToBase64(file);
      const res = await importImage(base64Data, file.type || 'image/png');

      const imgEl = new Image();
      imgEl.src = base64Data;
      await new Promise((resolve) => {
        imgEl.onload = resolve;
      });

      const maxDim = 400;
      let w = imgEl.naturalWidth || 300;
      let h = imgEl.naturalHeight || 300;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const posX = x !== undefined ? x - w / 2 : window.innerWidth / 2 - w / 2;
      const posY = y !== undefined ? y - h / 2 : window.innerHeight / 2 - h / 2;

      const newImage: ImageElement = {
        id: generateUUID(),
        type: 'image',
        assetHash: res.assetHash,
        localFilePath: res.localFilePath,
        src: base64Data,
        imgElement: imgEl,
        transform: {
          x: Math.max(20, Math.round(posX)),
          y: Math.max(20, Math.round(posY)),
          width: w,
          height: h,
          rotation: 0,
        },
        zIndex: this.images.length + 5,
        pinned: false,
      };

      this.images.push(newImage);
      this.renderAll();
      this.selectImage(newImage.id);
      this.notify();
      return newImage;
    } catch (err) {
      console.error('Failed to import image file:', err);
      return null;
    }
  }

  public selectImage(id: string): void {
    this.selectedImageId = id;
    const img = this.images.find((i) => i.id === id);
    if (img) {
      this.gizmo.attach(
        img.transform,
        {
          onTransformChange: (t) => {
            img.transform = { ...t };
            this.renderAll();
          },
          onTransformEnd: () => {
            this.notify();
          },
          onDelete: () => {
            this.deleteSelected();
          },
          onBringForward: () => {
            this.bringForward(id);
          },
          onSendBackward: () => {
            this.sendBackward(id);
          },
        },
        !!img.aboveInk
      );
    }
  }

  public bringForward(id?: string): void {
    const targetId = id || this.selectedImageId;
    if (!targetId) return;
    const img = this.images.find((i) => i.id === targetId);
    if (!img) return;

    if (!img.aboveInk) {
      const below = this.images.filter((i) => !i.aboveInk);
      const idxInBelow = below.indexOf(img);

      if (idxInBelow < below.length - 1) {
        const nextImg = below[idxInBelow + 1];
        const idxA = this.images.indexOf(img);
        const idxB = this.images.indexOf(nextImg);
        this.images[idxA] = nextImg;
        this.images[idxB] = img;
      } else {
        img.aboveInk = true;
        const above = this.images.filter((i) => i.aboveInk && i !== img);
        this.images = this.images.filter((i) => i !== img);
        if (above.length > 0) {
          const firstAboveIdx = this.images.indexOf(above[0]);
          this.images.splice(firstAboveIdx, 0, img);
        } else {
          this.images.push(img);
        }
      }
    } else {
      const above = this.images.filter((i) => i.aboveInk);
      const idxInAbove = above.indexOf(img);

      if (idxInAbove < above.length - 1) {
        const nextImg = above[idxInAbove + 1];
        const idxA = this.images.indexOf(img);
        const idxB = this.images.indexOf(nextImg);
        this.images[idxA] = nextImg;
        this.images[idxB] = img;
      }
    }

    this.gizmo.setLayerState(!!img.aboveInk);
    this.renderAll();
    this.notify();
  }

  public sendBackward(id?: string): void {
    const targetId = id || this.selectedImageId;
    if (!targetId) return;
    const img = this.images.find((i) => i.id === targetId);
    if (!img) return;

    if (img.aboveInk) {
      const above = this.images.filter((i) => i.aboveInk);
      const idxInAbove = above.indexOf(img);

      if (idxInAbove > 0) {
        const prevImg = above[idxInAbove - 1];
        const idxA = this.images.indexOf(img);
        const idxB = this.images.indexOf(prevImg);
        this.images[idxA] = prevImg;
        this.images[idxB] = img;
      } else {
        img.aboveInk = false;
        const below = this.images.filter((i) => !i.aboveInk && i !== img);
        this.images = this.images.filter((i) => i !== img);
        if (below.length > 0) {
          const lastBelowIdx = this.images.indexOf(below[below.length - 1]);
          this.images.splice(lastBelowIdx + 1, 0, img);
        } else {
          this.images.unshift(img);
        }
      }
    } else {
      const below = this.images.filter((i) => !i.aboveInk);
      const idxInBelow = below.indexOf(img);

      if (idxInBelow > 0) {
        const prevImg = below[idxInBelow - 1];
        const idxA = this.images.indexOf(img);
        const idxB = this.images.indexOf(prevImg);
        this.images[idxA] = prevImg;
        this.images[idxB] = img;
      }
    }

    this.gizmo.setLayerState(!!img.aboveInk);
    this.renderAll();
    this.notify();
  }

  public deselect(): void {
    this.selectedImageId = null;
    this.gizmo.detach();
  }

  public deleteSelected(): void {
    if (!this.selectedImageId) return;
    this.images = this.images.filter((i) => i.id !== this.selectedImageId);
    this.deselect();
    this.renderAll();
    this.notify();
  }

  private bindEvents(): void {
    window.addEventListener('paste', async (e: ClipboardEvent) => {
      if (!this.enabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            await this.importImageFile(file);
            break;
          }
        }
      }
    });

    window.addEventListener('dragover', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    });

    window.addEventListener('drop', async (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) {
          await this.importImageFile(files[i], e.clientX, e.clientY);
        }
      }
    });
  }

  public hitTestAboveInk(x: number, y: number): ImageElement | null {
    const aboveImages = this.images.filter((i) => i.aboveInk);
    for (let i = aboveImages.length - 1; i >= 0; i--) {
      const img = aboveImages[i];
      if (this.isPointInImage(x, y, img)) {
        return img;
      }
    }
    return null;
  }

  public hitTestBelowInk(x: number, y: number): ImageElement | null {
    const belowImages = this.images.filter((i) => !i.aboveInk);
    for (let i = belowImages.length - 1; i >= 0; i--) {
      const img = belowImages[i];
      if (this.isPointInImage(x, y, img)) {
        return img;
      }
    }
    return null;
  }

  public hitTest(x: number, y: number): ImageElement | null {
    return this.hitTestAboveInk(x, y) || this.hitTestBelowInk(x, y);
  }

  private isPointInImage(x: number, y: number, img: ImageElement): boolean {
    const { transform } = img;
    return (
      x >= transform.x &&
      x <= transform.x + transform.width &&
      y >= transform.y &&
      y <= transform.y + transform.height
    );
  }

  public hitTestBox(box: { left: number; top: number; right: number; bottom: number }): ImageElement[] {
    const matched: ImageElement[] = [];
    for (const img of this.images) {
      const { transform } = img;
      const imgLeft = transform.x;
      const imgTop = transform.y;
      const imgRight = transform.x + transform.width;
      const imgBottom = transform.y + transform.height;

      const overlap = !(
        imgRight < box.left ||
        imgLeft > box.right ||
        imgBottom < box.top ||
        imgTop > box.bottom
      );
      if (overlap) {
        matched.push(img);
      }
    }
    return matched;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  public renderAll(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    this.ctx.clearRect(0, 0, width, height);
    if (this.ctxAbove) {
      this.ctxAbove.clearRect(0, 0, width, height);
    }

    for (const img of this.images) {
      if (!img.imgElement || !img.imgElement.complete) continue;
      const { x, y, width: w, height: h, rotation } = img.transform;

      const targetCtx = img.aboveInk && this.ctxAbove ? this.ctxAbove : this.ctx;

      targetCtx.save();
      const cx = x + w / 2;
      const cy = y + h / 2;

      targetCtx.translate(cx, cy);
      targetCtx.rotate((rotation * Math.PI) / 180);
      targetCtx.drawImage(img.imgElement, -w / 2, -h / 2, w, h);
      targetCtx.restore();
    }
  }

  private notify(): void {
    if (this.onChange) {
      this.onChange(this.getImages());
    }
  }
}
