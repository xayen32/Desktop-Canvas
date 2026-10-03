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
  private isStylusErasing: boolean = false;
  private enabled: boolean = false;

  private penSettings = {
    color: '#F5F5F7',
    width: 4,
    opacity: 1.0,
  };

  private highlighterSettings = {
    color: '#FFE600',
    width: 24,
    opacity: 0.4,
  };

  private eraserSettings = {
    width: 24,
  };

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
    if (tool === 'pen') {
      this.brushSettings.color = this.penSettings.color;
      this.brushSettings.width = this.penSettings.width;
      this.brushSettings.opacity = this.penSettings.opacity;
    } else if (tool === 'highlighter') {
      this.brushSettings.color = this.highlighterSettings.color;
      this.brushSettings.width = this.highlighterSettings.width;
      this.brushSettings.opacity = this.highlighterSettings.opacity;
    } else if (tool === 'eraser') {
      this.brushSettings.width = this.eraserSettings.width;
    }
  }

  public setColor(color: string): void {
    this.brushSettings.color = color;
    if (this.brushSettings.tool === 'pen') {
      this.penSettings.color = color;
    } else if (this.brushSettings.tool === 'highlighter') {
      this.highlighterSettings.color = color;
    }
  }

  public setWidth(width: number): void {
    const w = Math.max(1, Math.min(64, width));
    this.brushSettings.width = w;
    if (this.brushSettings.tool === 'pen') {
      this.penSettings.width = w;
    } else if (this.brushSettings.tool === 'highlighter') {
      this.highlighterSettings.width = w;
    } else if (this.brushSettings.tool === 'eraser') {
      this.eraserSettings.width = w;
    }
  }

  public setOpacity(opacity: number): void {
    const op = Math.max(0.05, Math.min(1.0, opacity));
    this.brushSettings.opacity = op;
    if (this.brushSettings.tool === 'pen') {
      this.penSettings.opacity = op;
    } else if (this.brushSettings.tool === 'highlighter') {
      this.highlighterSettings.opacity = op;
    }
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
    this.selectedStrokeIds.clear();
    this.redrawAll();
    this.notifyChange();
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.parse(JSON.stringify(this.strokes)));
    this.strokes = this.redoStack.pop() || [];
    this.selectedStrokeIds.clear();
    this.redrawAll();
    this.notifyChange();
  }

  public clear(): void {
    if (this.strokes.length === 0) return;
    this.saveUndoState();
    this.strokes = [];
    this.selectedStrokeIds.clear();
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

  public rotateSelectedStrokes(angleDeltaRad: number, center?: { x: number; y: number }): void {
    if (this.selectedStrokeIds.size === 0 || angleDeltaRad === 0) return;

    let cx = 0;
    let cy = 0;
    if (center) {
      cx = center.x;
      cy = center.y;
    } else {
      const bbox = this.getBoundingBox();
      if (!bbox) return;
      cx = bbox.x + bbox.width / 2;
      cy = bbox.y + bbox.height / 2;
    }

    const cos = Math.cos(angleDeltaRad);
    const sin = Math.sin(angleDeltaRad);

    for (const stroke of this.strokes) {
      if (this.selectedStrokeIds.has(stroke.id)) {
        for (const p of stroke.points) {
          const dx = p.x - cx;
          const dy = p.y - cy;
          p.x = cx + dx * cos - dy * sin;
          p.y = cy + dx * sin + dy * cos;
        }
      }
    }

    this.redrawAll();
  }

  public transformSelectedStrokes(
    snapshot: StrokeElement[],
    initBbox: { x: number; y: number; width: number; height: number },
    target: { x: number; y: number; width: number; height: number; rotation: number },
    handle?: string | null,
    rotCenter?: { x: number; y: number }
  ): void {
    if (snapshot.length === 0 || !initBbox) return;

    const isRotate = handle === 'rotate' || (handle === undefined && target.rotation !== 0);

    const strokeMap = new Map<string, StrokeElement>();
    for (const s of this.strokes) {
      if (this.selectedStrokeIds.has(s.id)) {
        strokeMap.set(s.id, s);
      }
    }

    if (isRotate) {
      const cx = rotCenter ? rotCenter.x : initBbox.x + initBbox.width / 2;
      const cy = rotCenter ? rotCenter.y : initBbox.y + initBbox.height / 2;
      const rad = (target.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      for (const orig of snapshot) {
        const cur = strokeMap.get(orig.id);
        if (!cur) continue;
        cur.width = orig.width;
        if (cur.points.length !== orig.points.length) {
          cur.points = orig.points.map((p) => ({ ...p }));
        }
        for (let i = 0; i < orig.points.length; i++) {
          const op = orig.points[i];
          const dx = op.x - cx;
          const dy = op.y - cy;
          cur.points[i].x = cx + dx * cos - dy * sin;
          cur.points[i].y = cy + dx * sin + dy * cos;
        }
      }
    } else {
      const scaleX = initBbox.width > 0 ? target.width / initBbox.width : 1;
      const scaleY = initBbox.height > 0 ? target.height / initBbox.height : 1;
      const avgScale = Math.sqrt(Math.abs(scaleX * scaleY));

      for (const orig of snapshot) {
        const cur = strokeMap.get(orig.id);
        if (!cur) continue;
        cur.width = Math.max(1, Math.min(64, Math.round(orig.width * avgScale * 10) / 10));
        if (cur.points.length !== orig.points.length) {
          cur.points = orig.points.map((p) => ({ ...p }));
        }
        for (let i = 0; i < orig.points.length; i++) {
          const op = orig.points[i];
          const u = initBbox.width > 0 ? (op.x - initBbox.x) / initBbox.width : 0;
          const v = initBbox.height > 0 ? (op.y - initBbox.y) / initBbox.height : 0;
          cur.points[i].x = target.x + u * target.width;
          cur.points[i].y = target.y + v * target.height;
        }
      }
    }

    this.redrawAll();
  }

  public cloneSelectedStrokes(): StrokeElement[] {
    const selected = this.getSelectedStrokes();
    return JSON.parse(JSON.stringify(selected));
  }

  public pasteStrokes(strokesToPaste: StrokeElement[], offset: { x: number; y: number } = { x: 24, y: 24 }): StrokeElement[] {
    if (strokesToPaste.length === 0) return [];
    this.saveUndoState();

    const newStrokes: StrokeElement[] = strokesToPaste.map((orig) => {
      const copy: StrokeElement = JSON.parse(JSON.stringify(orig));
      copy.id = generateUUID();
      copy.zIndex = this.strokes.length + 1;
      for (const p of copy.points) {
        p.x += offset.x;
        p.y += offset.y;
      }
      return copy;
    });

    this.strokes.push(...newStrokes);
    this.selectedStrokeIds = new Set(newStrokes.map((s) => s.id));
    this.redrawAll();
    this.notifyChange();
    return newStrokes;
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

  public isStylusEraser(e: PointerEvent): boolean {
    return e.pointerType === 'eraser';
  }

  public isStylusSelect(e: PointerEvent): boolean {
    return e.button === 2 || (e.buttons & 2) !== 0;
  }

  public commitCurrentStroke(): void {
    if (!this.currentStroke || this.currentStroke.length === 0) return;
    this.saveUndoState();
    const isHighlighter = this.brushSettings.tool === 'highlighter';
    const tool = isHighlighter ? 'highlighter' : 'pen';
    const color = isHighlighter ? this.highlighterSettings.color : this.penSettings.color;
    const width = isHighlighter ? this.highlighterSettings.width : this.penSettings.width;
    const opacity = isHighlighter ? this.highlighterSettings.opacity : this.penSettings.opacity;
    const blendMode = isHighlighter ? 'multiply' : 'normal';

    const newElement: StrokeElement = {
      id: generateUUID(),
      type: 'stroke',
      tool,
      points: [...this.currentStroke],
      color,
      width,
      opacity,
      blendMode,
      zIndex: this.strokes.length + 1,
    };

    this.strokes.push(newElement);
    this.currentStroke = null;
    this.redrawAll();
    this.notifyChange();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel.bind(this));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.enabled || this.brushSettings.tool === 'select') return;

    // Stylus barrel select button is handled by selection system in main.ts
    if (this.isStylusSelect(e)) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (this.isStylusEraser(e)) {
      this.isStylusErasing = true;
      this.isDrawing = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {}
      this.saveUndoState();
      this.eraseAtPoint(x, y, Math.max(16, this.eraserSettings.width * 2.5));
      return;
    }

    if (e.button !== 0) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}

    this.isDrawing = true;
    this.isStylusErasing = false;

    if (this.brushSettings.tool === 'eraser') {
      this.saveUndoState();
      this.eraseAtPoint(x, y, Math.max(16, this.eraserSettings.width * 2.5));
      return;
    }

    this.currentStroke = [{ x, y, pressure }];
    this.renderActiveStroke();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.isDrawing) return;
    if (this.isStylusSelect(e)) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (this.isStylusErasing || this.isStylusEraser(e)) {
      this.isStylusErasing = true;
      this.eraseAtPoint(x, y, Math.max(16, this.eraserSettings.width * 2.5));
      return;
    }

    if (this.brushSettings.tool === 'eraser') {
      this.eraseAtPoint(x, y, Math.max(16, this.eraserSettings.width * 2.5));
      return;
    }

    if (!this.currentStroke) return;

    const last = this.currentStroke[this.currentStroke.length - 1];
    const dist = Math.hypot(x - last.x, y - last.y);
    if (dist < 0.5) return;

    this.currentStroke.push({ x, y, pressure });
    this.redrawAll();
    this.renderActiveStroke();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {}

    if (this.isStylusErasing) {
      this.isStylusErasing = false;
      this.notifyChange();
      return;
    }

    if (this.brushSettings.tool === 'eraser' || this.brushSettings.tool === 'select') {
      this.notifyChange();
      return;
    }

    if (this.currentStroke && this.currentStroke.length >= 1) {
      this.commitCurrentStroke();
    } else {
      this.currentStroke = null;
      this.redrawAll();
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.isStylusErasing = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {}

    if (this.currentStroke && this.currentStroke.length >= 1) {
      this.commitCurrentStroke();
    } else {
      this.currentStroke = null;
      this.redrawAll();
    }
  }

  private distToSegmentSquared(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) {
      const dpx = px - x1;
      const dpy = py - y1;
      return dpx * dpx + dpy * dpy;
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const dX = px - projX;
    const dY = py - projY;
    return dX * dX + dY * dY;
  }

  private eraseAtPoint(x: number, y: number, radius: number): void {
    const prevCount = this.strokes.length;
    const r = Math.max(16, radius);
    this.strokes = this.strokes.filter((stroke) => {
      const pad = r + stroke.width / 2;
      const padSq = pad * pad;
      if (stroke.points.length === 0) return false;
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        return Math.hypot(p.x - x, p.y - y) > pad;
      }
      for (let i = 0; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i];
        const p2 = stroke.points[i + 1];
        if (this.distToSegmentSquared(x, y, p1.x, p1.y, p2.x, p2.y) <= padSq) {
          return false;
        }
      }
      return true;
    });

    if (this.strokes.length !== prevCount) {
      this.redrawAll();
      this.notifyChange();
    }
  }

  public notifyChange(): void {
    if (this.onStrokeChange) {
      this.onStrokeChange(this.getStrokes());
    }
  }

  private renderActiveStroke(): void {
    if (!this.currentStroke || this.currentStroke.length === 0) return;

    this.ctx.save();
    const isHighlighter = this.brushSettings.tool === 'highlighter';
    const color = isHighlighter ? this.highlighterSettings.color : this.penSettings.color;
    const width = isHighlighter ? this.highlighterSettings.width : this.penSettings.width;
    const opacity = isHighlighter ? this.highlighterSettings.opacity : this.penSettings.opacity;

    this.ctx.globalCompositeOperation = isHighlighter ? 'multiply' : 'source-over';
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = color;

    if (this.currentStroke.length === 1) {
      const p = this.currentStroke[0];
      const r = Math.max(width / 2, 1.5);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      const outline = computeStrokeOutline(
        this.currentStroke,
        width,
        isHighlighter ? 'highlighter' : 'pen'
      );
      renderOutlineOnCanvas(this.ctx, outline);
    }

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
    if (stroke.points.length === 0) return;

    this.ctx.save();
    this.ctx.globalCompositeOperation = stroke.blendMode === 'multiply' ? 'multiply' : 'source-over';
    this.ctx.globalAlpha = stroke.opacity;
    this.ctx.fillStyle = stroke.color;

    if (this.selectedStrokeIds.has(stroke.id)) {
      this.ctx.shadowColor = '#5B8CFF';
      this.ctx.shadowBlur = 10;
    }

    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      const r = Math.max(stroke.width / 2, 1.5);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      const outline = computeStrokeOutline(stroke.points, stroke.width, stroke.tool);
      renderOutlineOnCanvas(this.ctx, outline);
    }

    this.ctx.restore();
  }
}
