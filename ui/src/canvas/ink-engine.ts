import {
  BrushSettings,
  computeStrokeOutline,
  generateUUID,
  renderOutlineOnCanvas,
  StrokeElement,
  StrokePoint,
  ToolType,
} from './stroke';

export interface InkEngineOptions {
  canvas: HTMLCanvasElement;
  onStrokeChange?: (strokes: StrokeElement[]) => void;
}

export class InkingEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: StrokeElement[] = [];
  private undoStack: StrokeElement[][] = [];
  private redoStack: StrokeElement[][] = [];
  private currentStroke: StrokePoint[] | null = null;
  private isDrawing: boolean = false;
  private enabled: boolean = false;

  private brushSettings: BrushSettings = {
    tool: 'pen',
    color: '#F5F5F7',
    width: 4,
    opacity: 1.0,
  };

  private onStrokeChange?: (strokes: StrokeElement[]) => void;

  constructor(options: InkEngineOptions) {
    this.canvas = options.canvas;
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('Failed to get 2D context from ink canvas');
    }
    this.ctx = context;
    this.onStrokeChange = options.onStrokeChange;

    this.bindEvents();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.canvas.style.pointerEvents = 'auto';
    } else {
      this.canvas.style.pointerEvents = 'none';
      this.currentStroke = null;
      this.isDrawing = false;
    }
  }

  public setTool(tool: ToolType): void {
    this.brushSettings.tool = tool;
  }

  public setColor(color: string): void {
    this.brushSettings.color = color;
  }

  public setWidth(width: number): void {
    this.brushSettings.width = Math.max(1, Math.min(64, width));
  }

  public setOpacity(opacity: number): void {
    this.brushSettings.opacity = Math.max(0, Math.min(1, opacity));
  }

  public getBrushSettings(): BrushSettings {
    return { ...this.brushSettings };
  }

  public resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redrawAll();
  }

  public undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.strokes)));
    this.strokes = this.undoStack.pop() || [];
    this.redrawAll();
    this.notifyChange();
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.parse(JSON.stringify(this.strokes)));
    this.strokes = this.redoStack.pop() || [];
    this.redrawAll();
    this.notifyChange();
  }

  public clear(): void {
    if (this.strokes.length === 0) return;
    this.saveUndoState();
    this.strokes = [];
    this.redrawAll();
    this.notifyChange();
  }

  public getStrokes(): StrokeElement[] {
    return [...this.strokes];
  }

  public setStrokes(strokes: StrokeElement[]): void {
    this.strokes = [...strokes];
    this.redrawAll();
  }

  private selectedStrokeIds: Set<string> = new Set();

  public selectStrokes(ids: string[]): void {
    this.selectedStrokeIds = new Set(ids);
    this.redrawAll();
  }

  public clearSelection(): void {
    if (this.selectedStrokeIds.size > 0) {
      this.selectedStrokeIds.clear();
      this.redrawAll();
    }
  }

  public hasSelection(): boolean {
    return this.selectedStrokeIds.size > 0;
  }

  public getSelectedStrokes(): StrokeElement[] {
    return this.strokes.filter((s) => this.selectedStrokeIds.has(s.id));
  }

  public hitTest(x: number, y: number, tolerance: number = 10): StrokeElement | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      const maxDist = Math.max(tolerance, stroke.width / 2 + 6);
      for (const p of stroke.points) {
        if (Math.hypot(p.x - x, p.y - y) <= maxDist) {
          return stroke;
        }
      }
    }
    return null;
  }

  public hitTestBox(box: { left: number; top: number; right: number; bottom: number }): StrokeElement[] {
    const matched: StrokeElement[] = [];
    for (const stroke of this.strokes) {
      let inside = false;
      const r = stroke.width / 2;
      for (const p of stroke.points) {
        if (
          p.x >= box.left - r &&
          p.x <= box.right + r &&
          p.y >= box.top - r &&
          p.y <= box.bottom + r
        ) {
          inside = true;
          break;
        }
      }
      if (inside) {
        matched.push(stroke);
      }
    }
    return matched;
  }

  public getBoundingBox(targetStrokes?: StrokeElement[]): { x: number; y: number; width: number; height: number } | null {
    const list = targetStrokes || this.getSelectedStrokes();
    if (list.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stroke of list) {
      const pad = stroke.width / 2 + 4;
      for (const p of stroke.points) {
        if (p.x - pad < minX) minX = p.x - pad;
        if (p.y - pad < minY) minY = p.y - pad;
        if (p.x + pad > maxX) maxX = p.x + pad;
        if (p.y + pad > maxY) maxY = p.y + pad;
      }
    }

    if (!isFinite(minX) || !isFinite(minY)) return null;

    return {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.max(20, Math.round(maxX - minX)),
      height: Math.max(20, Math.round(maxY - minY)),
    };
  }

  public moveSelectedStrokes(dx: number, dy: number): void {
    if (this.selectedStrokeIds.size === 0 || (dx === 0 && dy === 0)) return;

    for (const stroke of this.strokes) {
      if (this.selectedStrokeIds.has(stroke.id)) {
        for (const p of stroke.points) {
          p.x += dx;
          p.y += dy;
        }
      }
    }

    this.redrawAll();
  }

  public deleteSelectedStrokes(): void {
    if (this.selectedStrokeIds.size === 0) return;
    this.saveUndoState();
    this.strokes = this.strokes.filter((s) => !this.selectedStrokeIds.has(s.id));
    this.selectedStrokeIds.clear();
    this.redrawAll();
    this.notifyChange();
  }

  public saveUndoState(): void {
    this.undoStack.push(JSON.parse(JSON.stringify(this.strokes)));
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel.bind(this));
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0 || this.brushSettings.tool === 'select') return;
    this.canvas.setPointerCapture(e.pointerId);

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    this.isDrawing = true;

    if (this.brushSettings.tool === 'eraser') {
      this.saveUndoState();
      this.eraseAtPoint(x, y, this.brushSettings.width * 2);
      return;
    }

    this.currentStroke = [{ x, y, pressure }];
    this.renderActiveStroke();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.isDrawing) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (this.brushSettings.tool === 'eraser') {
      this.eraseAtPoint(x, y, this.brushSettings.width * 2);
      return;
    }

    if (!this.currentStroke) return;

    const last = this.currentStroke[this.currentStroke.length - 1];
    const dist = Math.hypot(x - last.x, y - last.y);
    if (dist < 1.5) return;

    this.currentStroke.push({ x, y, pressure });
    this.redrawAll();
    this.renderActiveStroke();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
    }

    if (this.brushSettings.tool === 'eraser' || this.brushSettings.tool === 'select') {
      this.notifyChange();
      return;
    }

    if (this.currentStroke && this.currentStroke.length >= 2) {
      this.saveUndoState();
      const newElement: StrokeElement = {
        id: generateUUID(),
        type: 'stroke',
        tool: this.brushSettings.tool as 'pen' | 'highlighter',
        points: [...this.currentStroke],
        color: this.brushSettings.color,
        width: this.brushSettings.width,
        opacity: this.brushSettings.tool === 'highlighter' ? 0.4 : this.brushSettings.opacity,
        blendMode: this.brushSettings.tool === 'highlighter' ? 'multiply' : 'normal',
        zIndex: this.strokes.length + 1,
      };

      this.strokes.push(newElement);
      this.currentStroke = null;
      this.redrawAll();
      this.notifyChange();
    } else {
      this.currentStroke = null;
      this.redrawAll();
    }
  }

  private handlePointerCancel(_e: PointerEvent): void {
    this.isDrawing = false;
    this.currentStroke = null;
    this.redrawAll();
  }

  private eraseAtPoint(x: number, y: number, radius: number): void {
    const prevCount = this.strokes.length;
    this.strokes = this.strokes.filter((stroke) => {
      for (const p of stroke.points) {
        if (Math.hypot(p.x - x, p.y - y) <= radius + stroke.width / 2) {
          return false;
        }
      }
      return true;
    });

    if (this.strokes.length !== prevCount) {
      this.redrawAll();
    }
  }



  private notifyChange(): void {
    if (this.onStrokeChange) {
      this.onStrokeChange(this.getStrokes());
    }
  }

  private renderActiveStroke(): void {
    if (!this.currentStroke || this.currentStroke.length < 2) return;

    this.ctx.save();
    const isHighlighter = this.brushSettings.tool === 'highlighter';
    this.ctx.globalCompositeOperation = isHighlighter ? 'multiply' : 'source-over';
    this.ctx.globalAlpha = isHighlighter ? 0.4 : this.brushSettings.opacity;
    this.ctx.fillStyle = this.brushSettings.color;

    const outline = computeStrokeOutline(
      this.currentStroke,
      this.brushSettings.width,
      this.brushSettings.tool as 'pen' | 'highlighter' | 'eraser'
    );
    renderOutlineOnCanvas(this.ctx, outline);

    this.ctx.restore();
  }

  public redrawAll(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    this.ctx.clearRect(0, 0, width, height);

    for (const stroke of this.strokes) {
      this.renderSingleStroke(stroke);
    }
  }

  private renderSingleStroke(stroke: StrokeElement): void {
    if (stroke.points.length < 2) return;

    this.ctx.save();
    this.ctx.globalCompositeOperation = stroke.blendMode === 'multiply' ? 'multiply' : 'source-over';
    this.ctx.globalAlpha = stroke.opacity;
    this.ctx.fillStyle = stroke.color;

    if (this.selectedStrokeIds.has(stroke.id)) {
      this.ctx.shadowColor = '#5B8CFF';
      this.ctx.shadowBlur = 10;
    }

    const outline = computeStrokeOutline(stroke.points, stroke.width, stroke.tool);
    renderOutlineOnCanvas(this.ctx, outline);

    this.ctx.restore();
  }
}
