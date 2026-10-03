import { loadCanvas, saveCanvas } from '../ipc-client';
import {
  BackdropSchema,
  CanvasElement,
  CanvasStateSchema,
  ImageElement,
  StrokeElement,
  TextNoteElement,
} from '../types/schema';
import { BackdropRenderer } from './backdrop';
import { InkingEngine } from './ink-engine';
import { MediaManager } from './media-manager';
import { computeStrokeOutline, renderOutlineOnCanvas } from './stroke';
import { FloatingTextNotesManager } from './text-notes';

export interface SceneGraphOptions {
  backdropRenderer: BackdropRenderer;
  inkEngine: InkingEngine;
  mediaManager: MediaManager;
  textNotesManager: FloatingTextNotesManager;
  defaultBackdrop: BackdropSchema;
}

export class SceneGraphManager {
  private backdropRenderer: BackdropRenderer;
  private inkEngine: InkingEngine;
  private mediaManager: MediaManager;
  private textNotesManager: FloatingTextNotesManager;
  private defaultBackdrop: BackdropSchema;
  private saveDebounceTimer: number | null = null;
  private isSaving: boolean = false;

  constructor(options: SceneGraphOptions) {
    this.backdropRenderer = options.backdropRenderer;
    this.inkEngine = options.inkEngine;
    this.mediaManager = options.mediaManager;
    this.textNotesManager = options.textNotesManager;
    this.defaultBackdrop = options.defaultBackdrop;
  }

  public serialize(): CanvasStateSchema {
    const strokes = this.inkEngine.getStrokes();
    const images = this.mediaManager.getImages();
    const textNotes = this.textNotesManager.getNotes();

    const elements: CanvasElement[] = [...strokes, ...images, ...textNotes];
    elements.sort((a, b) => a.zIndex - b.zIndex);

    return {
      schemaVersion: 1,
      viewport: {
        zoom: 1.0,
        panX: 0.0,
        panY: 0.0,
        virtualBounds: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      },
      backdrop: this.backdropRenderer.getBackdrop() || this.defaultBackdrop,
      elements,
    };
  }

  public applyState(state: CanvasStateSchema): void {
    if (!state || !state.elements) return;

    if (state.backdrop) {
      this.backdropRenderer.setBackdrop(state.backdrop);
    }

    const strokes: StrokeElement[] = [];
    const images: ImageElement[] = [];
    const textNotes: TextNoteElement[] = [];

    for (const el of state.elements) {
      if (el.type === 'stroke') {
        strokes.push(el as StrokeElement);
      } else if (el.type === 'image') {
        images.push(el as ImageElement);
      } else if (el.type === 'textNote') {
        textNotes.push(el as TextNoteElement);
      }
    }

    this.inkEngine.setStrokes(strokes);
    this.mediaManager.setImages(images);
    this.textNotesManager.setNotes(textNotes);
  }

  public markDirty(): void {
    if (this.saveDebounceTimer !== null) {
      window.clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = window.setTimeout(async () => {
      this.saveDebounceTimer = null;
      await this.saveImmediately();
    }, 1500);
  }

  public async saveImmediately(): Promise<void> {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      const state = this.serialize();
      await saveCanvas(state);
      console.log('Canvas state autosaved successfully.');
    } catch (err) {
      console.warn('Canvas save fallback (browser/test mode):', err);
    } finally {
      this.isSaving = false;
    }
  }

  public async loadInitialState(): Promise<void> {
    try {
      const res = await loadCanvas();
      if (res && res.state) {
        this.applyState(res.state);
      }
    } catch (err) {
      console.warn('Canvas load fallback (browser/test mode):', err);
    }
  }

  public renderCompositeRaster(targetWidth?: number, targetHeight?: number): string {
    const width = targetWidth && targetWidth > 0 ? targetWidth : window.innerWidth;
    const height = targetHeight && targetHeight > 0 ? targetHeight : window.innerHeight;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return '';

    this.backdropRenderer.renderTo(ctx, width, height);

    // Ensure any stroke in progress is committed before capturing snapshot
    this.inkEngine.commitCurrentStroke();

    // 1. Render images below ink at 1:1 scale
    const imagesBelow = this.mediaManager.getImages().filter((i) => !i.aboveInk);
    for (const imgEl of imagesBelow) {
      const imgSource = (imgEl as any).imgElement as HTMLImageElement | undefined;
      if (imgSource && imgSource.complete && imgSource.naturalWidth > 0) {
        ctx.save();
        const cx = imgEl.transform.x + imgEl.transform.width / 2;
        const cy = imgEl.transform.y + imgEl.transform.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((imgEl.transform.rotation * Math.PI) / 180);
        ctx.drawImage(imgSource, -imgEl.transform.width / 2, -imgEl.transform.height / 2, imgEl.transform.width, imgEl.transform.height);
        ctx.restore();
      }
    }

    // 2. Render ink vector strokes at 1:1 scale (no bitmap stretching)
    const strokes = this.inkEngine.getStrokes();
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.globalCompositeOperation = stroke.blendMode === 'multiply' ? 'multiply' : 'source-over';
      ctx.globalAlpha = stroke.opacity;
      ctx.fillStyle = stroke.color;

      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        const r = Math.max(stroke.width / 2, 1.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const outline = computeStrokeOutline(stroke.points, stroke.width, stroke.tool);
        renderOutlineOnCanvas(ctx, outline);
      }
      ctx.restore();
    }

    // 3. Render images above ink at 1:1 scale
    const imagesAbove = this.mediaManager.getImages().filter((i) => i.aboveInk);
    for (const imgEl of imagesAbove) {
      const imgSource = (imgEl as any).imgElement as HTMLImageElement | undefined;
      if (imgSource && imgSource.complete && imgSource.naturalWidth > 0) {
        ctx.save();
        const cx = imgEl.transform.x + imgEl.transform.width / 2;
        const cy = imgEl.transform.y + imgEl.transform.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((imgEl.transform.rotation * Math.PI) / 180);
        ctx.drawImage(imgSource, -imgEl.transform.width / 2, -imgEl.transform.height / 2, imgEl.transform.width, imgEl.transform.height);
        ctx.restore();
      }
    }

    const notes = this.textNotesManager.getNotes();
    for (const note of notes) {
      if (!note.content || note.content.trim() === '') {
        continue;
      }

      const { x, y, width: nw, height: nh } = note.dimensions;
      const isTransparent = !note.stickyStyle?.backgroundColor || note.stickyStyle.backgroundColor === 'transparent';
      const r = note.stickyStyle?.cornerRadius || 10;

      ctx.save();

      if (!isTransparent && note.stickyStyle) {
        ctx.fillStyle = note.stickyStyle.backgroundColor;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, nw, nh, r);
        } else {
          ctx.rect(x, y, nw, nh);
        }
        ctx.fill();
        ctx.shadowColor = 'transparent';

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, nw, 28, [r, r, 0, 0]);
        } else {
          ctx.rect(x, y, nw, 28);
        }
        ctx.fill();
      }

      ctx.save();
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, nw, nh, r);
      } else {
        ctx.rect(x, y, nw, nh);
      }
      ctx.clip();

      ctx.fillStyle = note.typography?.color || '#F3F4F6';
      const fontSize = note.typography?.fontSize || 16;
      ctx.font = `${note.typography?.fontWeight || 400} ${fontSize}px "${note.typography?.fontFamily || 'Segoe UI'}", sans-serif`;
      ctx.textBaseline = 'top';

      if (isTransparent) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
      }

      const paddingX = 14;
      const paddingTop = 38;
      const maxWidth = nw - (paddingX * 2);
      const rawText = note.content;
      const paragraphs = rawText.split('\n');
      const lines: string[] = [];

      for (const para of paragraphs) {
        if (para === '') {
          lines.push('');
          continue;
        }
        const words = para.split(' ');
        let curLine = '';
        for (const word of words) {
          const testWithCur = curLine ? `${curLine} ${word}` : word;
          if (ctx.measureText(testWithCur).width <= maxWidth) {
            curLine = testWithCur;
          } else {
            if (curLine) {
              lines.push(curLine);
              curLine = '';
            }
            if (ctx.measureText(word).width <= maxWidth) {
              curLine = word;
            } else {
              for (let i = 0; i < word.length; i++) {
                const char = word[i];
                if (ctx.measureText(curLine + char).width > maxWidth) {
                  if (curLine) lines.push(curLine);
                  curLine = char;
                } else {
                  curLine += char;
                }
              }
            }
          }
        }
        if (curLine) {
          lines.push(curLine);
        }
      }

      let lineY = y + paddingTop;
      const lineHeight = fontSize * 1.45;
      for (const line of lines) {
        if (lineY > y + nh - 4) break;
        ctx.fillText(line, x + paddingX, lineY);
        lineY += lineHeight;
      }

      ctx.restore();
      ctx.restore();
    }

    return offscreen.toDataURL('image/png');
  }
}
