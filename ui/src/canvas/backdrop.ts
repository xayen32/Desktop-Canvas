import { convertFileSrc } from '@tauri-apps/api/core';
import { BackdropSchema, ImageBackdropConfig } from '../types/schema';

export class BackdropRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private backdrop: BackdropSchema;
  private loadedImage: HTMLImageElement | null = null;

  constructor(canvas: HTMLCanvasElement, initialBackdrop: BackdropSchema) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = context;
    this.backdrop = initialBackdrop;

    if (this.backdrop.type === 'image') {
      const src = this.resolveImageSrc(this.backdrop.image);
      if (src) {
        this.loadImage(src);
      }
    }
  }

  private resolveImageSrc(imageConfig?: ImageBackdropConfig): string | null {
    if (!imageConfig) return null;
    if (imageConfig.dataUrl) return imageConfig.dataUrl;
    if (imageConfig.localFilePath) {
      try {
        return convertFileSrc(imageConfig.localFilePath);
      } catch {
        return imageConfig.localFilePath;
      }
    }
    return null;
  }

  public getBackdrop(): BackdropSchema {
    return { ...this.backdrop };
  }

  public getLoadedImage(): HTMLImageElement | null {
    return this.loadedImage;
  }

  public setBackdrop(backdrop: BackdropSchema, onLoaded?: () => void): void {
    this.backdrop = backdrop;
    if (this.backdrop.type === 'image') {
      const src = this.resolveImageSrc(this.backdrop.image);
      if (src) {
        if (this.loadedImage && this.loadedImage.src === src && this.loadedImage.complete) {
          this.render();
          if (onLoaded) onLoaded();
        } else {
          this.loadImage(src, onLoaded);
        }
      } else {
        this.loadedImage = null;
        this.render();
        if (onLoaded) onLoaded();
      }
    } else {
      this.loadedImage = null;
      this.render();
      if (onLoaded) onLoaded();
    }
  }

  public loadImage(src: string, onLoaded?: () => void): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.loadedImage = img;
      this.render();
      if (onLoaded) onLoaded();
    };
    img.onerror = (err) => {
      console.warn('Failed to load canvas backdrop image:', err);
      if (onLoaded) onLoaded();
    };
    img.src = src;
  }

  public resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  public render(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    this.renderTo(this.ctx, width, height);
  }

  public renderTo(targetCtx: CanvasRenderingContext2D, width: number, height: number): void {
    targetCtx.clearRect(0, 0, width, height);

    if (this.backdrop.type === 'solid' && this.backdrop.solid) {
      targetCtx.fillStyle = this.backdrop.solid.color;
      targetCtx.fillRect(0, 0, width, height);
    } else if (this.backdrop.type === 'gradient' && this.backdrop.gradient) {
      const gradConfig = this.backdrop.gradient;
      if (gradConfig.kind === 'radial') {
        const cx = width / 2;
        const cy = height / 2;
        const r = Math.max(width, height) / 2;
        const radial = targetCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
        for (const stop of gradConfig.stops) {
          radial.addColorStop(Math.min(Math.max(stop.offset, 0), 1), stop.color);
        }
        targetCtx.fillStyle = radial;
        targetCtx.fillRect(0, 0, width, height);
      } else {
        const rad = (gradConfig.angleDegrees * Math.PI) / 180;
        const cx = width / 2;
        const cy = height / 2;
        const halfLength = Math.abs(width * Math.cos(rad)) / 2 + Math.abs(height * Math.sin(rad)) / 2;

        const x0 = cx - Math.cos(rad) * halfLength;
        const y0 = cy - Math.sin(rad) * halfLength;
        const x1 = cx + Math.cos(rad) * halfLength;
        const y1 = cy + Math.sin(rad) * halfLength;

        const linear = targetCtx.createLinearGradient(x0, y0, x1, y1);
        for (const stop of gradConfig.stops) {
          linear.addColorStop(Math.min(Math.max(stop.offset, 0), 1), stop.color);
        }
        targetCtx.fillStyle = linear;
        targetCtx.fillRect(0, 0, width, height);
      }
    } else if (this.backdrop.type === 'image' && this.loadedImage) {
      const img = this.loadedImage;
      const fitMode = this.backdrop.image?.fitMode || 'cover';

      if (fitMode === 'cover') {
        const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        targetCtx.drawImage(img, x, y, w, h);
      } else if (fitMode === 'contain') {
        const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        targetCtx.fillStyle = '#000000';
        targetCtx.fillRect(0, 0, width, height);
        targetCtx.drawImage(img, x, y, w, h);
      } else if (fitMode === 'center') {
        const x = (width - img.naturalWidth) / 2;
        const y = (height - img.naturalHeight) / 2;
        targetCtx.drawImage(img, x, y);
      } else if (fitMode === 'tile') {
        const pattern = targetCtx.createPattern(img, 'repeat');
        if (pattern) {
          targetCtx.fillStyle = pattern;
          targetCtx.fillRect(0, 0, width, height);
        }
      }
    } else {
      targetCtx.fillStyle = '#1E1F22';
      targetCtx.fillRect(0, 0, width, height);
    }

    if (this.backdrop.overlay && this.backdrop.overlay.kind !== 'none') {
      const { kind, spacing, opacity } = this.backdrop.overlay;
      const step = Math.max(spacing, 8);

      targetCtx.save();
      targetCtx.globalAlpha = Math.min(Math.max(opacity, 0), 1);

      if (kind === 'grid') {
        targetCtx.strokeStyle = '#FFFFFF';
        targetCtx.lineWidth = 1;
        targetCtx.beginPath();

        for (let x = 0; x <= width; x += step) {
          targetCtx.moveTo(x + 0.5, 0);
          targetCtx.lineTo(x + 0.5, height);
        }
        for (let y = 0; y <= height; y += step) {
          targetCtx.moveTo(0, y + 0.5);
          targetCtx.lineTo(width, y + 0.5);
        }
        targetCtx.stroke();
      } else if (kind === 'dots') {
        targetCtx.fillStyle = '#FFFFFF';
        for (let x = step / 2; x < width; x += step) {
          for (let y = step / 2; y < height; y += step) {
            targetCtx.beginPath();
            targetCtx.arc(x, y, 1.5, 0, Math.PI * 2);
            targetCtx.fill();
          }
        }
      }

      targetCtx.restore();
    }
  }
}
