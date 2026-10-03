import { BackdropRenderer } from '../canvas/backdrop';
import { InkingEngine } from '../canvas/ink-engine';
import { ToolType } from '../canvas/stroke';
import { importImage } from '../ipc-client';
import { BackdropSchema } from '../types/schema';
import { Popover } from './popover';

export interface FloatingToolbarOptions {
  container: HTMLElement;
  inkEngine: InkingEngine;
  backdropRenderer?: BackdropRenderer;
  onToggleMode: () => void;
  onAddNote?: () => void;
  onAddImage?: (file: File) => void;
  onUpdateBackdrop?: (backdrop: BackdropSchema) => void;
  onOpenWizard?: () => void;
  onToolChange?: (tool: ToolType) => void;
}

export const PEN_PRESET_COLORS = [
  '#F5F5F7',
  '#5B8CFF',
  '#34D399',
  '#FBBF24',
  '#F87171',
  '#A78BFA',
  '#F472B6',
  '#94A3B8',
];

export const HIGHLIGHTER_PRESET_COLORS = [
  '#FFE600',
  '#4ADE80',
  '#38BDF8',
  '#F472B6',
  '#FB923C',
  '#C084FC',
  '#FBBF24',
  '#A7F3D0',
];

export const PRESET_COLORS = PEN_PRESET_COLORS;

export class FloatingToolbarHUD {
  private container: HTMLElement;
  private hudElement: HTMLElement;
  private inkEngine: InkingEngine;
  private backdropRenderer?: BackdropRenderer;
  private onToggleMode: () => void;
  private onAddNote?: () => void;
  private onAddImage?: (file: File) => void;
  private onUpdateBackdrop?: (backdrop: BackdropSchema) => void;
  private onOpenWizard?: () => void;
  private onToolChange?: (tool: ToolType) => void;
  private activePopover: Popover | null = null;
  private activeTool: ToolType = 'pen';

  constructor(options: FloatingToolbarOptions) {
    this.container = options.container;
    this.inkEngine = options.inkEngine;
    this.backdropRenderer = options.backdropRenderer;
    this.onToggleMode = options.onToggleMode;
    this.onAddNote = options.onAddNote;
    this.onAddImage = options.onAddImage;
    this.onUpdateBackdrop = options.onUpdateBackdrop;
    this.onOpenWizard = options.onOpenWizard;
    this.onToolChange = options.onToolChange;

    this.hudElement = document.createElement('div');
    this.hudElement.className = 'floating-hud';
    this.hudElement.id = 'floatingToolbar';

    this.render();
    this.container.appendChild(this.hudElement);
    window.addEventListener('resize', () => this.clampPosition());
  }

  public show(): void {
    this.hudElement.classList.remove('hidden');
  }

  public hide(): void {
    this.hudElement.classList.add('hidden');
    if (this.activePopover) {
      this.activePopover.close();
      this.activePopover = null;
    }
  }

  public render(): void {
    this.hudElement.innerHTML = `
      <div class="hud-drag-handle" title="Drag to reposition HUD">
        <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor">
          <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
          <circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>
          <circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/>
        </svg>
      </div>

      <div class="hud-group tools-group">
        <button class="hud-tool-btn ${this.activeTool === 'select' ? 'active' : ''}" data-tool="select" title="Select / Transform">
          <span class="tool-icon">▸</span>
          <span class="tool-label">Select</span>
        </button>

        <div class="hud-tool-combo ${this.activeTool === 'pen' ? 'active' : ''}" data-tool="pen">
          <button class="hud-tool-btn ${this.activeTool === 'pen' ? 'active' : ''}" data-tool="pen" title="Pen (Smooth Bézier)">
            <span class="tool-icon">✎</span>
            <span class="tool-label">Pen</span>
          </button>
          <button class="hud-chevron-btn" id="penOptionsBtn" title="Brush Settings">▾</button>
        </div>

        <div class="hud-tool-combo ${this.activeTool === 'highlighter' ? 'active' : ''}" data-tool="highlighter">
          <button class="hud-tool-btn ${this.activeTool === 'highlighter' ? 'active' : ''}" data-tool="highlighter" title="Highlighter (Multiply Blend)">
            <span class="tool-icon">▮</span>
            <span class="tool-label">Highlight</span>
          </button>
          <button class="hud-chevron-btn" id="highlighterOptionsBtn" title="Highlighter Settings">▾</button>
        </div>

        <button class="hud-tool-btn ${this.activeTool === 'eraser' ? 'active' : ''}" data-tool="eraser" title="Eraser">
          <span class="tool-icon">⌫</span>
          <span class="tool-label">Erase</span>
        </button>
      </div>

      <div class="hud-divider"></div>

      <div class="hud-group content-group">
        <button class="hud-action-btn" id="addNoteBtn" title="Add Note (or double-click canvas)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5z"/>
            <path d="M15 3v5h5"/>
            <line x1="9" y1="13" x2="15" y2="13"/>
            <line x1="9" y1="17" x2="13" y2="17"/>
          </svg>
        </button>
        <label class="hud-action-btn file-label" title="Add Image (or Ctrl+V / drop file)">
          <input type="file" id="imageFileInput" accept="image/*" style="display: none;" />
          <span>🖼</span>
        </label>
        <button class="hud-action-btn has-label" id="backdropBtn" title="Change Canvas Background & Grid">
          <span>🎨</span>
          <span class="btn-text">Canvas</span>
        </button>
      </div>

      <div class="hud-divider"></div>

      <div class="hud-group action-group">
        <button class="hud-action-btn" id="undoBtn" title="Undo (Ctrl+Z)">↩</button>
        <button class="hud-action-btn" id="redoBtn" title="Redo (Ctrl+Y)">↪</button>
        <button class="hud-action-btn danger" id="clearBtn" title="Clear Canvas">🗑</button>
      </div>

      <div class="hud-divider"></div>

      <div class="hud-group transition-group">
        <button class="hud-mode-btn" id="toggleModeBtn" title="Switch to Wallpaper Mode">
          <span class="mode-icon">⇄</span>
          <span>Wallpaper</span>
        </button>
      </div>
    `;

    this.bindEvents();
    this.bindDrag();
  }

  private bindEvents(): void {
    this.hudElement.querySelectorAll('[data-tool]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.hud-chevron-btn')) return;
        const tool = (el as HTMLElement).dataset.tool as ToolType;
        if (tool) {
          this.selectTool(tool);
        }
      });
    });

    const penOptionsBtn = this.hudElement.querySelector('#penOptionsBtn') as HTMLElement;
    if (penOptionsBtn) {
      penOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectTool('pen');
        this.openBrushPopover(penOptionsBtn);
      });
    }

    const highlighterOptionsBtn = this.hudElement.querySelector('#highlighterOptionsBtn') as HTMLElement;
    if (highlighterOptionsBtn) {
      highlighterOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectTool('highlighter');
        this.openBrushPopover(highlighterOptionsBtn);
      });
    }

    const addNoteBtn = this.hudElement.querySelector('#addNoteBtn');
    if (addNoteBtn) {
      addNoteBtn.addEventListener('click', () => {
        if (this.onAddNote) this.onAddNote();
      });
    }

    const fileInput = this.hudElement.querySelector('#imageFileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files[0] && this.onAddImage) {
          this.onAddImage(files[0]);
          fileInput.value = '';
        }
      });
    }

    const backdropBtn = this.hudElement.querySelector('#backdropBtn') as HTMLElement;
    if (backdropBtn) {
      backdropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCanvasPopover(backdropBtn);
      });
    }

    const undoBtn = this.hudElement.querySelector('#undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', () => this.inkEngine.undo());

    const redoBtn = this.hudElement.querySelector('#redoBtn');
    if (redoBtn) redoBtn.addEventListener('click', () => this.inkEngine.redo());

    const clearBtn = this.hudElement.querySelector('#clearBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => this.inkEngine.clear());

    const toggleModeBtn = this.hudElement.querySelector('#toggleModeBtn');
    if (toggleModeBtn) toggleModeBtn.addEventListener('click', () => this.onToggleMode());
  }

  public selectTool(tool: ToolType): void {
    if (this.activeTool !== tool && this.activePopover) {
      this.activePopover.close();
      this.activePopover = null;
    }
    this.activeTool = tool;
    this.inkEngine.setTool(tool);
    this.updateActiveToolUI();
    if (this.onToolChange) {
      this.onToolChange(tool);
    }
  }

  private updateActiveToolUI(): void {
    const buttons = this.hudElement.querySelectorAll<HTMLElement>('.hud-tool-btn[data-tool]');
    buttons.forEach((btn) => {
      const isCurrent = btn.dataset.tool === this.activeTool;
      btn.classList.toggle('active', isCurrent);
    });

    const combos = this.hudElement.querySelectorAll<HTMLElement>('.hud-tool-combo');
    combos.forEach((combo) => {
      const isCurrent = combo.dataset.tool === this.activeTool;
      combo.classList.toggle('active', isCurrent);
    });
  }

  private openBrushPopover(anchorEl: HTMLElement): void {
    if (this.activePopover) {
      this.activePopover.close();
      this.activePopover = null;
    }

    const isHighlighter = this.activeTool === 'highlighter';
    const settings = this.inkEngine.getBrushSettings();
    const presets = isHighlighter ? HIGHLIGHTER_PRESET_COLORS : PEN_PRESET_COLORS;
    const title = isHighlighter ? 'Highlighter Color' : 'Pen Color';
    const widthLabel = isHighlighter ? 'Highlighter Width' : 'Stroke Width';
    const content = document.createElement('div');
    content.className = 'brush-popover-content';

    content.innerHTML = `
      <div class="popover-section">
        <div class="popover-label">${title}</div>
        <div class="swatches-grid">
          ${presets.map(
            (c) => `
            <button class="color-swatch ${settings.color.toLowerCase() === c.toLowerCase() ? 'active' : ''}" 
                    data-color="${c}" 
                    style="background-color: ${c};"></button>
          `
          ).join('')}
          <label class="color-picker-btn" title="Custom Hex Color">
            <input type="color" id="customColorInput" value="${settings.color}" />
            <span>+</span>
          </label>
        </div>
      </div>

      <div class="popover-section">
        <div class="slider-header">
          <span class="popover-label">${widthLabel}</span>
          <span class="slider-val" id="widthValDisplay">${settings.width}px</span>
        </div>
        <div class="slider-row">
          <input type="range" id="widthSlider" min="1" max="64" value="${settings.width}" />
          <div class="width-preview-dot" id="widthPreviewDot" style="width: ${Math.min(24, Math.max(4, settings.width))}px; height: ${Math.min(24, Math.max(4, settings.width))}px; background-color: ${settings.color}; opacity: ${settings.opacity};"></div>
        </div>
      </div>

      <div class="popover-section">
        <div class="slider-header">
          <span class="popover-label">Opacity</span>
          <span class="slider-val" id="opacityValDisplay">${Math.round(settings.opacity * 100)}%</span>
        </div>
        <input type="range" id="opacitySlider" min="5" max="100" value="${Math.round(settings.opacity * 100)}" />
      </div>
    `;

    content.querySelectorAll('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = (btn as HTMLElement).dataset.color || (isHighlighter ? '#FFE600' : '#F5F5F7');
        this.inkEngine.setColor(color);
        this.openBrushPopover(anchorEl);
      });
    });

    const customColorInput = content.querySelector('#customColorInput') as HTMLInputElement;
    if (customColorInput) {
      customColorInput.addEventListener('input', (e) => {
        const color = (e.target as HTMLInputElement).value;
        this.inkEngine.setColor(color);
        const preview = content.querySelector('#widthPreviewDot') as HTMLElement;
        if (preview) preview.style.backgroundColor = color;
      });
    }

    const widthSlider = content.querySelector('#widthSlider') as HTMLInputElement;
    const widthValDisplay = content.querySelector('#widthValDisplay') as HTMLElement;
    const widthPreviewDot = content.querySelector('#widthPreviewDot') as HTMLElement;

    if (widthSlider && widthValDisplay && widthPreviewDot) {
      widthSlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        this.inkEngine.setWidth(val);
        widthValDisplay.innerText = `${val}px`;
        widthPreviewDot.style.width = `${Math.min(24, Math.max(4, val))}px`;
        widthPreviewDot.style.height = `${Math.min(24, Math.max(4, val))}px`;
      });
    }

    const opacitySlider = content.querySelector('#opacitySlider') as HTMLInputElement;
    const opacityValDisplay = content.querySelector('#opacityValDisplay') as HTMLElement;

    if (opacitySlider && opacityValDisplay) {
      opacitySlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        this.inkEngine.setOpacity(val / 100);
        opacityValDisplay.innerText = `${val}%`;
        const preview = content.querySelector('#widthPreviewDot') as HTMLElement;
        if (preview) preview.style.opacity = `${val / 100}`;
      });
    }

    this.activePopover = new Popover({
      anchorEl,
      content,
      onClose: () => {
        this.activePopover = null;
      },
    });
  }

  private openCanvasPopover(anchorEl: HTMLElement): void {
    if (this.activePopover) {
      this.activePopover.close();
      this.activePopover = null;
    }

    const currentBackdrop: BackdropSchema = this.backdropRenderer
      ? this.backdropRenderer.getBackdrop()
      : { type: 'solid', solid: { color: '#18191C' } };

    const content = document.createElement('div');
    content.className = 'canvas-popover-content';

    const isGrad = currentBackdrop.type === 'gradient';
    const isSolid = currentBackdrop.type === 'solid';
    const isImage = currentBackdrop.type === 'image';
    const firstStop = currentBackdrop.gradient?.stops?.[0]?.color?.toLowerCase();
    const solidColor = currentBackdrop.solid?.color?.toLowerCase();
    const overlayKind = currentBackdrop.overlay?.kind || 'none';
    const imageFitMode = currentBackdrop.image?.fitMode || 'cover';
    const imagePreviewSrc = currentBackdrop.image?.dataUrl || currentBackdrop.image?.localFilePath || '';

    content.innerHTML = `
      <div class="popover-section">
        <div class="popover-label">Color & Gradient Presets</div>
        <div class="canvas-preset-grid">
          <button class="canvas-preset-card ${isGrad && firstStop === '#18191c' ? 'active' : ''}" data-preset="gradient-dark" title="Obsidian (Dark Gradient)">
            <span class="canvas-preset-preview" style="background: linear-gradient(135deg, #18191C, #282A2E);"></span>
            <span class="canvas-preset-name">Obsidian</span>
          </button>
          <button class="canvas-preset-card ${isGrad && firstStop === '#0f172a' ? 'active' : ''}" data-preset="gradient-blue" title="Deep Azure (Navy Gradient)">
            <span class="canvas-preset-preview" style="background: linear-gradient(135deg, #0F172A, #1E293B, #0F3854);"></span>
            <span class="canvas-preset-name">Azure</span>
          </button>
          <button class="canvas-preset-card ${isGrad && firstStop === '#1f1d2b' ? 'active' : ''}" data-preset="gradient-sunset" title="Twilight Studio">
            <span class="canvas-preset-preview" style="background: linear-gradient(135deg, #1F1D2B, #3B2A4A, #1A1A2E);"></span>
            <span class="canvas-preset-name">Twilight</span>
          </button>
          <button class="canvas-preset-card ${isSolid && solidColor === '#1e1f22' ? 'active' : ''}" data-preset="solid-dark" title="Charcoal Solid">
            <span class="canvas-preset-preview" style="background: #1E1F22;"></span>
            <span class="canvas-preset-name">Charcoal</span>
          </button>
          <button class="canvas-preset-card ${isSolid && solidColor === '#000000' ? 'active' : ''}" data-preset="solid-black" title="Pure Black">
            <span class="canvas-preset-preview" style="background: #000000; border: 1px solid #333;"></span>
            <span class="canvas-preset-name">Black</span>
          </button>
          <button class="canvas-preset-card ${isSolid && solidColor === '#f4f1ea' ? 'active' : ''}" data-preset="solid-paper" title="Warm Paper (Cream)">
            <span class="canvas-preset-preview" style="background: #F4F1EA;"></span>
            <span class="canvas-preset-name">Paper</span>
          </button>
          <button class="canvas-preset-card ${isSolid && solidColor === '#ffffff' ? 'active' : ''}" data-preset="solid-white" title="Pure White">
            <span class="canvas-preset-preview" style="background: #FFFFFF; border: 1px solid #ddd;"></span>
            <span class="canvas-preset-name">White</span>
          </button>
          <label class="canvas-preset-card custom-color-picker" title="Pick Custom Solid Color">
            <span class="canvas-preset-preview" id="customColorPreview" style="background: ${isSolid ? solidColor : '#2A2D34'};">🎨</span>
            <input type="color" id="customCanvasColorInput" value="${isSolid && solidColor?.startsWith('#') ? solidColor : '#1E1F22'}" />
            <span class="canvas-preset-name">Custom</span>
          </label>
        </div>
      </div>

      <div class="popover-section">
        <div class="popover-label">Image Background</div>
        ${isImage && imagePreviewSrc ? `
          <div class="canvas-image-active-card">
            <div class="canvas-image-row">
              <img class="canvas-image-thumbnail" src="${imagePreviewSrc}" alt="Background Preview" />
              <div class="canvas-image-btn-col">
                <button class="btn-chip" id="changeBgImageBtn" title="Choose a new background image">Change...</button>
                <button class="btn-chip danger" id="removeBgImageBtn" title="Remove image and return to gradient">Remove</button>
              </div>
            </div>
            <div class="fit-mode-section">
              <div class="fit-mode-title">Fit Mode</div>
              <div class="fit-mode-row">
                <button class="btn-chip ${imageFitMode === 'cover' ? 'active' : ''}" data-fit="cover" title="Cover entire canvas (recommended for wallpaper)">Cover</button>
                <button class="btn-chip ${imageFitMode === 'contain' ? 'active' : ''}" data-fit="contain" title="Fit within canvas without cropping">Contain</button>
                <button class="btn-chip ${imageFitMode === 'center' ? 'active' : ''}" data-fit="center" title="Original size centered">Center</button>
                <button class="btn-chip ${imageFitMode === 'tile' ? 'active' : ''}" data-fit="tile" title="Repeat pattern">Tile</button>
              </div>
            </div>
          </div>
        ` : `
          <button class="canvas-image-upload-card" id="uploadBgImageBtn" title="Set a custom wallpaper or photo as your canvas background">
            <span class="upload-icon">🖼️</span>
            <div class="upload-info">
              <span class="upload-main-text">Upload Custom Image...</span>
              <span class="upload-sub-text">PNG, JPG, or WebP wallpaper</span>
            </div>
          </button>
        `}
        <input type="file" id="canvasBgFileInput" accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp" style="display:none;" />
      </div>

      <div class="popover-section">
        <div class="popover-label">Grid Overlay</div>
        <div class="grid-buttons-row">
          <button class="btn-chip ${overlayKind === 'none' ? 'active' : ''}" data-overlay="none">None</button>
          <button class="btn-chip ${overlayKind === 'dots' ? 'active' : ''}" data-overlay="dots">Dots</button>
          <button class="btn-chip ${overlayKind === 'grid' ? 'active' : ''}" data-overlay="grid">Grid (32px)</button>
        </div>
      </div>

      <div class="popover-divider"></div>

      <button class="wizard-link-btn" id="openWizardBtn" title="Open Multi-Display & Geometry Wizard">
        ⚙ Setup Wizard (Display Geometry)...
      </button>
    `;

    const applyBackdropChange = (updated: BackdropSchema) => {
      if (this.backdropRenderer) {
        this.backdropRenderer.setBackdrop(updated);
      }
      if (this.onUpdateBackdrop) {
        this.onUpdateBackdrop(updated);
      }
    };

    content.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = (btn as HTMLElement).dataset.preset;
        const cur = this.backdropRenderer ? this.backdropRenderer.getBackdrop() : currentBackdrop;
        let updated: BackdropSchema = { ...cur };
        delete updated.image;

        if (preset === 'gradient-dark') {
          updated.type = 'gradient';
          updated.gradient = {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#18191C' }, { offset: 1, color: '#282A2E' }],
          };
        } else if (preset === 'gradient-blue') {
          updated.type = 'gradient';
          updated.gradient = {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#0F172A' }, { offset: 0.5, color: '#1E293B' }, { offset: 1, color: '#0F3854' }],
          };
        } else if (preset === 'gradient-sunset') {
          updated.type = 'gradient';
          updated.gradient = {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#1F1D2B' }, { offset: 0.5, color: '#3B2A4A' }, { offset: 1, color: '#1A1A2E' }],
          };
        } else if (preset === 'solid-dark') {
          updated.type = 'solid';
          updated.solid = { color: '#1E1F22' };
        } else if (preset === 'solid-black') {
          updated.type = 'solid';
          updated.solid = { color: '#000000' };
        } else if (preset === 'solid-paper') {
          updated.type = 'solid';
          updated.solid = { color: '#F4F1EA' };
        } else if (preset === 'solid-white') {
          updated.type = 'solid';
          updated.solid = { color: '#FFFFFF' };
        }

        applyBackdropChange(updated);
        this.openCanvasPopover(anchorEl);
      });
    });

    const customColorInput = content.querySelector('#customCanvasColorInput') as HTMLInputElement;
    if (customColorInput) {
      customColorInput.addEventListener('input', (e) => {
        const color = (e.target as HTMLInputElement).value;
        const cur = this.backdropRenderer ? this.backdropRenderer.getBackdrop() : currentBackdrop;
        const updated: BackdropSchema = {
          ...cur,
          type: 'solid',
          solid: { color },
        };
        delete updated.image;
        const preview = content.querySelector('#customColorPreview') as HTMLElement;
        if (preview) preview.style.backgroundColor = color;
        applyBackdropChange(updated);
      });
    }

    const fileInput = content.querySelector('#canvasBgFileInput') as HTMLInputElement;
    const triggerFileInput = () => {
      if (fileInput) fileInput.click();
    };

    const uploadBtn = content.querySelector('#uploadBgImageBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', triggerFileInput);
    }

    const changeBtn = content.querySelector('#changeBgImageBtn');
    if (changeBtn) {
      changeBtn.addEventListener('click', triggerFileInput);
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files || files.length === 0) return;
        const file = files[0];

        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target?.result as string;
          if (!dataUrl) return;

          let localFilePath: string | undefined;
          let assetHash: string | undefined;

          try {
            const res = await importImage(dataUrl, file.type || 'image/png');
            localFilePath = res.localFilePath;
            assetHash = res.assetHash;
          } catch (err) {
            console.warn('Backend image asset persistence fallback:', err);
          }

          const cur = this.backdropRenderer ? this.backdropRenderer.getBackdrop() : currentBackdrop;
          const updated: BackdropSchema = {
            ...cur,
            type: 'image',
            image: {
              dataUrl,
              localFilePath,
              assetHash,
              fitMode: cur.image?.fitMode || 'cover',
            },
          };

          applyBackdropChange(updated);
          this.openCanvasPopover(anchorEl);
        };
        reader.readAsDataURL(file);
      });
    }

    const removeBtn = content.querySelector('#removeBgImageBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const cur = this.backdropRenderer ? this.backdropRenderer.getBackdrop() : currentBackdrop;
        const updated: BackdropSchema = {
          ...cur,
          type: 'gradient',
          gradient: {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#18191C' }, { offset: 1, color: '#282A2E' }],
          },
        };
        delete updated.image;
        applyBackdropChange(updated);
        this.openCanvasPopover(anchorEl);
      });
    }

    content.querySelectorAll('[data-fit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fit = (btn as HTMLElement).dataset.fit as 'cover' | 'contain' | 'tile' | 'center';
        const cur = this.backdropRenderer ? this.backdropRenderer.getBackdrop() : currentBackdrop;
        if (cur.image) {
          const updated: BackdropSchema = {
            ...cur,
            type: 'image',
            image: {
              ...cur.image,
              fitMode: fit,
            },
          };
          applyBackdropChange(updated);
          this.openCanvasPopover(anchorEl);
        }
      });
    });

    content.querySelectorAll('[data-overlay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = (btn as HTMLElement).dataset.overlay as 'none' | 'dots' | 'grid';
        const cur = this.backdropRenderer ? this.backdropRenderer.getBackdrop() : currentBackdrop;
        const updated: BackdropSchema = {
          ...cur,
          overlay: {
            kind,
            spacing: 32,
            opacity: kind === 'none' ? 0 : 0.15,
          },
        };
        applyBackdropChange(updated);
        this.openCanvasPopover(anchorEl);
      });
    });

    const wizardBtn = content.querySelector('#openWizardBtn');
    if (wizardBtn) {
      wizardBtn.addEventListener('click', () => {
        if (this.activePopover) {
          this.activePopover.close();
          this.activePopover = null;
        }
        if (this.onOpenWizard) {
          this.onOpenWizard();
        }
      });
    }

    this.activePopover = new Popover({
      anchorEl,
      content,
      onClose: () => {
        this.activePopover = null;
      },
    });
  }

  private bindDrag(): void {
    const handle = this.hudElement.querySelector('.hud-drag-handle') as HTMLElement;
    if (!handle) return;

    let isDragging = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;

      e.preventDefault();

      const deltaX = e.clientX - startPointerX;
      const deltaY = e.clientY - startPointerY;

      let newX = startLeft + deltaX;
      let newY = startTop + deltaY;

      const rect = this.hudElement.getBoundingClientRect();
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(8, window.innerHeight - rect.height - 8);

      newX = Math.max(8, Math.min(maxX, newX));
      newY = Math.max(8, Math.min(maxY, newY));

      this.hudElement.style.left = `${Math.round(newX)}px`;
      this.hudElement.style.top = `${Math.round(newY)}px`;
      this.hudElement.style.transform = 'none';
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;

      this.hudElement.classList.remove('dragging');
      document.body.style.userSelect = '';

      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
      }

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startPointerX = e.clientX;
      startPointerY = e.clientY;

      const rect = this.hudElement.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      this.hudElement.style.left = `${Math.round(startLeft)}px`;
      this.hudElement.style.top = `${Math.round(startTop)}px`;
      this.hudElement.style.transform = 'none';

      this.hudElement.classList.add('dragging');
      document.body.style.userSelect = 'none';

      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
      }

      if (this.activePopover) {
        this.activePopover.close();
        this.activePopover = null;
      }

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    handle.addEventListener('pointerdown', onPointerDown);
  }

  public clampPosition(): void {
    if (this.hudElement.style.transform === 'none') {
      const rect = this.hudElement.getBoundingClientRect();
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(8, window.innerHeight - rect.height - 8);
      const curLeft = parseFloat(this.hudElement.style.left) || rect.left;
      const curTop = parseFloat(this.hudElement.style.top) || rect.top;
      const clampedX = Math.max(8, Math.min(maxX, curLeft));
      const clampedY = Math.max(8, Math.min(maxY, curTop));
      this.hudElement.style.left = `${Math.round(clampedX)}px`;
      this.hudElement.style.top = `${Math.round(clampedY)}px`;
    }
  }
}
