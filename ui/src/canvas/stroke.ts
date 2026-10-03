import getStroke from 'perfect-freehand';

export type ToolType = 'select' | 'pen' | 'highlighter' | 'eraser';

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface StrokeElement {
  id: string;
  type: 'stroke';
  tool: 'pen' | 'highlighter' | 'eraser';
  points: StrokePoint[];
  color: string;
  width: number;
  opacity: number;
  blendMode: 'normal' | 'multiply';
  zIndex: number;
}

export interface BrushSettings {
  tool: ToolType;
  color: string;
  width: number;
  opacity: number;
}

/**
 * Computes a smooth, pressure-responsive outline polygon for a stroke using perfect-freehand.
 */
export function computeStrokeOutline(
  points: StrokePoint[],
  width: number,
  tool: 'pen' | 'highlighter' | 'eraser'
): number[][] {
  if (points.length === 0) return [];

  const isHighlighter = tool === 'highlighter';
  const strokeOptions = {
    size: width * (isHighlighter ? 1.8 : 1.0),
    thinning: isHighlighter ? 0.0 : 0.08,
    smoothing: 0.45,
    streamline: 0.22,
    easing: (t: number) => t,
    start: {
      taper: 0,
      cap: true,
    },
    end: {
      taper: 0,
      cap: true,
    },
  };

  const rawPoints = points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  return getStroke(rawPoints, strokeOptions);
}

/**
 * Renders an outline polygon onto a 2D canvas context with quadratic curve smoothing.
 */
export function renderOutlineOnCanvas(
  ctx: CanvasRenderingContext2D,
  outline: number[][]
): void {
  if (outline.length === 0) return;
  if (outline.length < 3) {
    ctx.beginPath();
    ctx.arc(outline[0][0], outline[0][1], 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
