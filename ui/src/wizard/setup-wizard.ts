import { BackdropRenderer } from '../canvas/backdrop';
import { updateSettings } from '../ipc-client';
import { DisplayTopology, SettingsSchema } from '../types/schema';

export interface SetupWizardOptions {
  container: HTMLElement;
  initialSettings: SettingsSchema;
  topology: DisplayTopology;
  backdropRenderer: BackdropRenderer;
  onComplete: (updatedSettings: SettingsSchema) => void;
}

export class SetupWizard {
  private container: HTMLElement;
  private currentStep: number = 1;
  private totalSteps: number = 4;
  private settings: SettingsSchema;
  private topology: DisplayTopology;
  private backdropRenderer: BackdropRenderer;
  private onComplete: (updatedSettings: SettingsSchema) => void;

  constructor(options: SetupWizardOptions) {
    this.container = options.container;
    this.settings = JSON.parse(JSON.stringify(options.initialSettings));
    this.topology = options.topology;
    this.backdropRenderer = options.backdropRenderer;
    this.onComplete = options.onComplete;
    this.render();
  }

  public render(): void {
    this.container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'wizard-card';

    const header = document.createElement('div');
    header.className = 'wizard-header';

    const stepDots = document.createElement('div');
    stepDots.className = 'step-indicator';
    for (let i = 1; i <= this.totalSteps; i++) {
      const dot = document.createElement('span');
      dot.className = `step-dot ${i === this.currentStep ? 'active' : ''} ${i < this.currentStep ? 'completed' : ''}`;
      stepDots.appendChild(dot);
    }

    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn-text';
    actionBtn.innerText = this.settings.firstRunCompleted ? '✕ Close' : 'Skip';
    actionBtn.title = this.settings.firstRunCompleted ? 'Close Reconfiguration' : 'Skip Setup';
    actionBtn.onclick = () => this.finishWizard();

    header.appendChild(stepDots);
    header.appendChild(actionBtn);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'wizard-body';

    switch (this.currentStep) {
      case 1:
        this.renderStep1(body);
        break;
      case 2:
        this.renderStep2(body);
        break;
      case 3:
        this.renderStep3(body);
        break;
      case 4:
        this.renderStep4(body);
        break;
    }
    card.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'wizard-footer';

    if (this.currentStep > 1) {
      const backBtn = document.createElement('button');
      backBtn.className = 'btn-secondary';
      backBtn.innerText = 'Back';
      backBtn.onclick = () => {
        this.currentStep--;
        this.render();
      };
      footer.appendChild(backBtn);
    } else {
      footer.appendChild(document.createElement('div'));
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn-primary';
    nextBtn.innerText = this.currentStep === this.totalSteps ? 'Finish & Launch' : 'Next →';
    nextBtn.onclick = () => {
      if (this.currentStep === this.totalSteps) {
        this.finishWizard();
      } else {
        this.currentStep++;
        this.render();
      }
    };
    footer.appendChild(nextBtn);

    card.appendChild(footer);
    this.container.appendChild(card);
  }

  private renderStep1(body: HTMLElement): void {
    body.innerHTML = `
      <h2>Set up canvas geometry</h2>
      <p class="wizard-desc">Choose how Desktop Canvas maps across your display setup.</p>
      <div class="options-group">
        <label class="radio-card ${this.settings.geometryMode === 'continuous' ? 'selected' : ''}">
          <input type="radio" name="geometry" value="continuous" ${this.settings.geometryMode === 'continuous' ? 'checked' : ''} />
          <div class="radio-content">
            <strong>One continuous canvas across all displays</strong>
            <span>Canvas spans seamlessly across monitor boundaries.</span>
          </div>
        </label>
        <label class="radio-card ${this.settings.geometryMode === 'per-monitor' ? 'selected' : ''}">
          <input type="radio" name="geometry" value="per-monitor" ${this.settings.geometryMode === 'per-monitor' ? 'checked' : ''} />
          <div class="radio-content">
            <strong>Independent canvas per display</strong>
            <span>Each display operates with an isolated coordinate system.</span>
          </div>
        </label>
      </div>
      <div class="monitor-preview-box">
        <div class="monitor-list-title">Detected Displays (${this.topology.monitors.length || 1})</div>
        <div class="monitor-arrangement">
          ${(this.topology.monitors.length > 0 ? this.topology.monitors : [{ id: '1', name: 'Primary Display', width: 1920, height: 1080, scaleFactor: 1.0, isPrimary: true }])
            .map((m) => `
              <div class="monitor-chip ${m.isPrimary ? 'primary' : ''}">
                <div class="mon-screen">${m.width}×${m.height}</div>
                <div class="mon-label">${m.name} (${Math.round(m.scaleFactor * 100)}% DPI)</div>
              </div>
            `).join('')}
        </div>
      </div>
    `;

    body.querySelectorAll('input[name="geometry"]').forEach((el) => {
      el.addEventListener('change', (e) => {
        this.settings.geometryMode = (e.target as HTMLInputElement).value as 'continuous' | 'per-monitor';
        this.render();
      });
    });
  }

  private renderStep2(body: HTMLElement): void {
    body.innerHTML = `
      <h2>Choose app theme</h2>
      <p class="wizard-desc">Select the theme for toolbar chrome, HUD panels, and system popovers.</p>
      <div class="options-grid">
        <div class="theme-card ${this.settings.theme === 'dark' ? 'selected' : ''}" data-theme="dark">
          <div class="theme-preview dark-theme-preview">
            <div class="sample-hud dark-hud"></div>
          </div>
          <span>Dark Theme (Recommended)</span>
        </div>
        <div class="theme-card ${this.settings.theme === 'light' ? 'selected' : ''}" data-theme="light">
          <div class="theme-preview light-theme-preview">
            <div class="sample-hud light-hud"></div>
          </div>
          <span>Light Theme</span>
        </div>
        <div class="theme-card ${this.settings.theme === 'auto' ? 'selected' : ''}" data-theme="auto">
          <div class="theme-preview auto-theme-preview">
            <div class="sample-hud auto-hud"></div>
          </div>
          <span>Follow Windows Theme</span>
        </div>
      </div>
    `;

    body.querySelectorAll('.theme-card').forEach((el) => {
      el.addEventListener('click', () => {
        const theme = (el as HTMLElement).dataset.theme as 'dark' | 'light' | 'auto';
        this.settings.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.render();
      });
    });
  }

  private renderStep3(body: HTMLElement): void {
    const backdrop = this.settings.backdrop;
    body.innerHTML = `
      <h2>Select desktop backdrop</h2>
      <p class="wizard-desc">Customize your background color, gradient, and grid layout with live preview.</p>
      <div class="backdrop-controls">
        <div class="segmented-control">
          <button class="seg-btn ${backdrop.type === 'gradient' ? 'active' : ''}" data-type="gradient">Gradient</button>
          <button class="seg-btn ${backdrop.type === 'solid' ? 'active' : ''}" data-type="solid">Solid Color</button>
        </div>

        <div class="preset-swatches">
          <div class="swatch-label">Backdrop Presets:</div>
          <div class="swatches-row">
            <button class="swatch-preset" data-bg="gradient-dark" title="Obsidian Night" style="background: linear-gradient(135deg, #18191C, #282A2E);"></button>
            <button class="swatch-preset" data-bg="gradient-blue" title="Deep Azure" style="background: linear-gradient(135deg, #0F172A, #1E293B, #0F3854);"></button>
            <button class="swatch-preset" data-bg="gradient-sunset" title="Twilight Studio" style="background: linear-gradient(135deg, #1F1D2B, #3B2A4A, #1A1A2E);"></button>
            <button class="swatch-preset" data-bg="solid-dark" title="Charcoal Solid" style="background: #1E1F22;"></button>
            <button class="swatch-preset" data-bg="solid-midnight" title="Midnight Navy" style="background: #0B0F19;"></button>
          </div>
        </div>

        <div class="overlay-toggle-group">
          <div class="swatch-label">Grid / Alignment Overlay:</div>
          <div class="overlay-buttons">
            <button class="btn-chip ${backdrop.overlay?.kind === 'none' ? 'active' : ''}" data-overlay="none">None</button>
            <button class="btn-chip ${backdrop.overlay?.kind === 'grid' ? 'active' : ''}" data-overlay="grid">Grid (32px)</button>
            <button class="btn-chip ${backdrop.overlay?.kind === 'dots' ? 'active' : ''}" data-overlay="dots">Dot Matrix</button>
          </div>
        </div>
      </div>
    `;

    body.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.type as 'solid' | 'gradient';
        this.settings.backdrop.type = type;
        this.backdropRenderer.setBackdrop(this.settings.backdrop);
        this.render();
      });
    });

    body.querySelectorAll('.swatch-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bg = (btn as HTMLElement).dataset.bg;
        if (bg === 'gradient-dark') {
          this.settings.backdrop.type = 'gradient';
          this.settings.backdrop.gradient = {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#18191C' }, { offset: 1, color: '#282A2E' }],
          };
        } else if (bg === 'gradient-blue') {
          this.settings.backdrop.type = 'gradient';
          this.settings.backdrop.gradient = {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#0F172A' }, { offset: 0.5, color: '#1E293B' }, { offset: 1, color: '#0F3854' }],
          };
        } else if (bg === 'gradient-sunset') {
          this.settings.backdrop.type = 'gradient';
          this.settings.backdrop.gradient = {
            kind: 'linear',
            angleDegrees: 135,
            stops: [{ offset: 0, color: '#1F1D2B' }, { offset: 0.5, color: '#3B2A4A' }, { offset: 1, color: '#1A1A2E' }],
          };
        } else if (bg === 'solid-dark') {
          this.settings.backdrop.type = 'solid';
          this.settings.backdrop.solid = { color: '#1E1F22' };
        } else if (bg === 'solid-midnight') {
          this.settings.backdrop.type = 'solid';
          this.settings.backdrop.solid = { color: '#0B0F19' };
        }
        this.backdropRenderer.setBackdrop(this.settings.backdrop);
        this.render();
      });
    });

    body.querySelectorAll('[data-overlay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = (btn as HTMLElement).dataset.overlay as 'none' | 'grid' | 'dots';
        if (!this.settings.backdrop.overlay) {
          this.settings.backdrop.overlay = { kind: 'none', spacing: 32, opacity: 0.15 };
        }
        this.settings.backdrop.overlay.kind = kind;
        this.backdropRenderer.setBackdrop(this.settings.backdrop);
        this.render();
      });
    });
  }

  private renderStep4(body: HTMLElement): void {
    body.innerHTML = `
      <h2>Ready to initialize canvas</h2>
      <p class="wizard-desc">Your desktop workspace is configured and ready to use.</p>
      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">Canvas Geometry:</span>
          <span class="summary-value">${this.settings.geometryMode === 'continuous' ? 'Single Continuous Canvas' : 'Per-Monitor Canvas'}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">HUD Theme:</span>
          <span class="summary-value">${this.settings.theme.toUpperCase()}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Backdrop:</span>
          <span class="summary-value">${this.settings.backdrop.type.toUpperCase()} (${this.settings.backdrop.overlay?.kind !== 'none' ? this.settings.backdrop.overlay?.kind : 'No overlay'})</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Global Toggle Hotkey:</span>
          <span class="summary-value"><code>${this.settings.hotkey}</code></span>
        </div>
      </div>
      <p class="wizard-note">Press <code>${this.settings.hotkey}</code> at any time or click the tray icon to switch between Wallpaper and Edit Mode.</p>
    `;
  }

  private async finishWizard(): Promise<void> {
    this.settings.firstRunCompleted = true;
    try {
      await updateSettings(this.settings);
    } catch (e) {
      console.error('Failed to save wizard settings:', e);
    }
    this.onComplete(this.settings);
  }
}
