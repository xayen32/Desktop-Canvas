export interface GradientStop {
  offset: number;
  color: string;
}

export interface GradientConfig {
  kind: 'linear' | 'radial';
  angleDegrees: number;
  stops: GradientStop[];
}

export interface SolidConfig {
  color: string;
}

export interface ImageBackdropConfig {
  assetHash?: string;
  localFilePath?: string;
  dataUrl?: string;
  fitMode?: 'cover' | 'contain' | 'tile' | 'center';
}

export interface OverlayConfig {
  kind: 'grid' | 'dots' | 'none';
  spacing: number;
  opacity: number;
}

export interface BackdropSchema {
  type: 'solid' | 'gradient' | 'image';
  solid?: SolidConfig;
  gradient?: GradientConfig;
  image?: ImageBackdropConfig;
  overlay?: OverlayConfig;
}

export interface SettingsSchema {
  schemaVersion: number;
  theme: 'dark' | 'light' | 'auto';
  geometryMode: 'continuous' | 'per-monitor';
  backdrop: BackdropSchema;
  autostart: boolean;
  hotkey: string;
  firstRunCompleted: boolean;
}

export interface SettingsPatch {
  theme?: 'dark' | 'light' | 'auto';
  geometryMode?: 'continuous' | 'per-monitor';
  backdrop?: BackdropSchema;
  autostart?: boolean;
  hotkey?: string;
  firstRunCompleted?: boolean;
}

export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dpi: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface DisplayTopology {
  virtualX: number;
  virtualY: number;
  virtualWidth: number;
  virtualHeight: number;
  monitors: MonitorInfo[];
}

export interface CanvasTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

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

export interface ImageElement {
  id: string;
  type: 'image';
  assetHash: string;
  localFilePath: string;
  src?: string;
  imgElement?: HTMLImageElement;
  transform: CanvasTransform;
  zIndex: number;
  pinned: boolean;
  aboveInk?: boolean;
}

export interface TypographyConfig {
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: 400 | 600 | 700;
}

export interface StickyStyle {
  backgroundColor: string;
  cornerRadius: number;
}

export interface TextNoteElement {
  id: string;
  type: 'textNote';
  content: string;
  typography: TypographyConfig;
  stickyStyle: StickyStyle | null;
  dimensions: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zIndex: number;
}

export type CanvasElement = StrokeElement | ImageElement | TextNoteElement;

export interface ViewportSchema {
  zoom: number;
  panX: number;
  panY: number;
  virtualBounds: {
    width: number;
    height: number;
  };
}

export interface CanvasStateSchema {
  schemaVersion: number;
  viewport: ViewportSchema;
  backdrop: BackdropSchema;
  elements: CanvasElement[];
}
