import { BackdropRenderer } from './canvas/backdrop';
import { InkingEngine } from './canvas/ink-engine';
import { MediaManager } from './canvas/media-manager';
import { SceneGraphManager } from './canvas/scene-graph';
import { FloatingTextNotesManager } from './canvas/text-notes';
import { TransformGizmo } from './canvas/transform-gizmo';
import { FloatingToolbarHUD } from './hud/toolbar';
import {
  applyWallpaperSnapshot, getDisplayBounds, getSettings,
  onDisplayBoundsChanged, onModeChanged, onRequestToggleMode, onShowWizard, toggleFullscreen, toggleMode, updateSettings,
} from './ipc-client';
import { BackdropSchema, DisplayTopology, SettingsSchema } from './types/schema';
import { StrokeElement } from './canvas/stroke';
import { SetupWizard } from './wizard/setup-wizard';

async function initApp() {
  const appEl = document.getElementById('app') as HTMLElement;
  const backdropCanvas = document.getElementById('backdropCanvas') as HTMLCanvasElement;
  const inkCanvas = document.getElementById('inkCanvas') as HTMLCanvasElement;
  const notesLayer = document.getElementById('notesLayer') as HTMLElement;
  const gizmoLayer = document.getElementById('gizmoLayer') as HTMLElement;
  const hudContainer = document.getElementById('hudContainer') as HTMLElement;
  const wizardContainer = document.getElementById('wizardContainer') as HTMLElement;
  const modeIndicator = document.getElementById('modeIndicator') as HTMLElement;
  const modeDot = document.getElementById('modeDot') as HTMLElement;
  const modeText = document.getElementById('modeText') as HTMLElement;

  let currentMode: 'wallpaper' | 'edit' = 'wallpaper';
  let settings: SettingsSchema;
  let inkClipboard: StrokeElement[] = [];
  let pasteOffsetCount = 0;

  const defaultBackdrop: BackdropSchema = {
    type: 'gradient',
    gradient: {
      kind: 'linear',
      angleDegrees: 135,
      stops: [
        { offset: 0, color: '#18191C' },
        { offset: 1, color: '#282A2E' },
      ],
    },
    overlay: {
      kind: 'none',
      spacing: 32,
      opacity: 0.15,
    },
  };

  try {
    const res = await getSettings();
    settings = res.settings;
  } catch (err) {
    console.warn('Could not fetch settings via Tauri IPC. Using defaults.', err);
    settings = {
      schemaVersion: 1,
      theme: 'dark',
      geometryMode: 'continuous',
      backdrop: defaultBackdrop,
      autostart: false,
      hotkey: 'Ctrl+Alt+D',
      firstRunCompleted: false,
    };
  }

  document.documentElement.setAttribute('data-theme', settings.theme);

  const backdropRenderer = new BackdropRenderer(backdropCanvas, settings.backdrop || defaultBackdrop);
  const gizmo = new TransformGizmo(gizmoLayer);

  let sceneGraph: SceneGraphManager;
  let toolbarHUD: FloatingToolbarHUD;

  const inkEngine = new InkingEngine({
    canvas: inkCanvas,
    onStrokeChange: () => {
      if (gizmo.isAttached() && !inkEngine.hasSelection() && !mediaManager.hasSelection()) {
        gizmo.detach();
      }
      sceneGraph?.markDirty();
    },
  });

  const mediaManager = new MediaManager({
    container: appEl,
    gizmo,
    onChange: () => sceneGraph?.markDirty(),
  });

  const textNotesManager = new FloatingTextNotesManager({
    container: notesLayer,
    onChange: () => sceneGraph?.markDirty(),
  });

  sceneGraph = new SceneGraphManager({
    backdropRenderer,
    inkEngine,
    mediaManager,
    textNotesManager,
    defaultBackdrop: settings.backdrop || defaultBackdrop,
  });

  await sceneGraph.loadInitialState();

  toolbarHUD = new FloatingToolbarHUD({
    container: hudContainer,
    inkEngine,
    backdropRenderer,
    onToggleMode: async () => {
      await handleToggleMode();
    },
    onAddNote: () => {
      textNotesManager.createNoteAt(window.innerWidth / 2 - 110, window.innerHeight / 2 - 80);
      sceneGraph.markDirty();
    },
    onAddImage: async (file) => {
      await mediaManager.importImageFile(file);
      sceneGraph.markDirty();
    },
    onUpdateBackdrop: async (backdrop) => {
      settings.backdrop = backdrop;
      backdropRenderer.setBackdrop(backdrop);
      sceneGraph.markDirty();
      try {
        await updateSettings({ backdrop });
      } catch (err) {
        console.warn('Failed to persist backdrop update:', err);
      }
    },
    onOpenWizard: async () => {
      await openWizard();
    },
    onToolChange: (tool) => {
      if (tool !== 'select') {
        gizmo.detach();
        mediaManager.deselect();
        inkEngine.clearSelection();
      }
    },
  });

  const updateModeUI = async (mode: 'wallpaper' | 'edit') => {
    const prevMode = currentMode;
    currentMode = mode;
    const isEdit = mode === 'edit';

    backdropCanvas.style.opacity = '1';

    if (isEdit) {
      modeDot.className = 'mode-dot edit';
      modeText.innerText = 'Edit Mode';
      inkEngine.setEnabled(true);
      mediaManager.setEnabled(true);
      textNotesManager.setEnabled(true);
      toolbarHUD.show();
      resizeAll();
    } else {
      modeDot.className = 'mode-dot';
      modeText.innerText = 'Wallpaper Mode';
      inkEngine.setEnabled(false);
      mediaManager.setEnabled(false);
      textNotesManager.setEnabled(false);
      gizmo.detach();
      inkEngine.clearSelection();
      mediaManager.deselect();
      toolbarHUD.hide();

      if (prevMode === 'edit') {
        await sceneGraph.saveImmediately();
      }
    }
  };

  const handleToggleMode = async (forceTarget?: 'wallpaper' | 'edit') => {
    try {
      const nextMode = forceTarget || (currentMode === 'edit' ? 'wallpaper' : 'edit');
      if (nextMode === 'wallpaper') {
        try {
          inkEngine.commitCurrentStroke();
          await sceneGraph.saveImmediately();
          let topology: DisplayTopology | null = null;
          try {
            topology = await getDisplayBounds();
          } catch (err) {
            console.warn('Topology fetch fallback:', err);
          }
          const targetW = topology?.virtualWidth || window.innerWidth;
          const targetH = topology?.virtualHeight || window.innerHeight;
          const png = sceneGraph.renderCompositeRaster(targetW, targetH);
          if (png) {
            await applyWallpaperSnapshot(png);
          }
        } catch (err) {
          console.warn('Failed to export wallpaper snapshot:', err);
        }
      }
      const res = await toggleMode(nextMode);
      await updateModeUI(res.mode as 'wallpaper' | 'edit');
    } catch {
      const nextMode = currentMode === 'wallpaper' ? 'edit' : 'wallpaper';
      await updateModeUI(nextMode);
    }
  };

  let marqueeBoxEl: HTMLElement | null = null;
  let isMarqueeDragging = false;
  let marqueeStartX = 0;
  let marqueeStartY = 0;

  const removeMarqueeBox = () => {
    if (marqueeBoxEl && marqueeBoxEl.parentNode) {
      marqueeBoxEl.parentNode.removeChild(marqueeBoxEl);
    }
    marqueeBoxEl = null;
    isMarqueeDragging = false;
  };

  const selectInkStrokes = (ids: string[]) => {
    inkEngine.selectStrokes(ids);
    const bbox = inkEngine.getBoundingBox();
    if (!bbox) {
      gizmo.detach();
      return;
    }

    let snapshotStrokes = inkEngine.cloneSelectedStrokes();
    let initBbox = { ...bbox };
    let rotCenterX = bbox.x + bbox.width / 2;
    let rotCenterY = bbox.y + bbox.height / 2;

    gizmo.attach(
      {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        rotation: 0,
      },
      {
        onTransformStart: (_handle) => {
          inkEngine.saveUndoState();
          const curBbox = inkEngine.getBoundingBox();
          if (curBbox) {
            initBbox = { ...curBbox };
            rotCenterX = curBbox.x + curBbox.width / 2;
            rotCenterY = curBbox.y + curBbox.height / 2;
          }
          snapshotStrokes = inkEngine.cloneSelectedStrokes();
        },
        onTransformChange: (t, handle) => {
          inkEngine.transformSelectedStrokes(
            snapshotStrokes,
            initBbox,
            t,
            handle,
            { x: rotCenterX, y: rotCenterY }
          );
        },
        onTransformEnd: () => {
          const newBbox = inkEngine.getBoundingBox();
          if (newBbox) {
            initBbox = { ...newBbox };
            rotCenterX = newBbox.x + newBbox.width / 2;
            rotCenterY = newBbox.y + newBbox.height / 2;
            gizmo.updateTransform({
              x: newBbox.x,
              y: newBbox.y,
              width: newBbox.width,
              height: newBbox.height,
              rotation: 0,
            });
          }
          inkEngine.notifyChange();
          sceneGraph.markDirty();
        },
        onDelete: () => {
          inkEngine.deleteSelectedStrokes();
          gizmo.detach();
          sceneGraph.markDirty();
        },
      },
      false, // isAboveInk
      false, // showLayerButtons
      true,  // showTransformHandles
      false  // showRotateOnly (false allows both corner/edge resize handles and top rotation pin)
    );
  };

  inkCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (currentMode !== 'edit') return;
    if (inkEngine.isStylusEraser(e)) return;

    const isSelectButton = inkEngine.isStylusSelect(e);
    const tool = inkEngine.getBrushSettings().tool;

    const isSelectionAction = (tool === 'select' && e.button === 0) || isSelectButton;

    if (!isSelectionAction) {
      if (gizmo.isAttached() || inkEngine.hasSelection()) {
        mediaManager.deselect();
        inkEngine.clearSelection();
        gizmo.detach();
      }
      return;
    }

    const hitAbove = mediaManager.hitTestAboveInk(e.clientX, e.clientY);
    if (hitAbove) {
      inkEngine.clearSelection();
      mediaManager.selectImage(hitAbove.id);
      return;
    }

    const hitStroke = inkEngine.hitTest(e.clientX, e.clientY);
    if (hitStroke) {
      mediaManager.deselect();
      selectInkStrokes([hitStroke.id]);
      return;
    }

    const hitBelow = mediaManager.hitTestBelowInk(e.clientX, e.clientY);
    if (hitBelow) {
      inkEngine.clearSelection();
      mediaManager.selectImage(hitBelow.id);
      return;
    }

    mediaManager.deselect();
    inkEngine.clearSelection();
    gizmo.detach();

    isMarqueeDragging = true;
    marqueeStartX = e.clientX;
    marqueeStartY = e.clientY;

    marqueeBoxEl = document.createElement('div');
    marqueeBoxEl.className = 'marquee-selection-box';
    marqueeBoxEl.style.left = `${marqueeStartX}px`;
    marqueeBoxEl.style.top = `${marqueeStartY}px`;
    marqueeBoxEl.style.width = '0px';
    marqueeBoxEl.style.height = '0px';
    appEl.appendChild(marqueeBoxEl);

    const onPointerMove = (ev: PointerEvent) => {
      if (!isMarqueeDragging || !marqueeBoxEl) return;
      const curX = ev.clientX;
      const curY = ev.clientY;

      const left = Math.min(marqueeStartX, curX);
      const top = Math.min(marqueeStartY, curY);
      const width = Math.abs(curX - marqueeStartX);
      const height = Math.abs(curY - marqueeStartY);

      marqueeBoxEl.style.left = `${left}px`;
      marqueeBoxEl.style.top = `${top}px`;
      marqueeBoxEl.style.width = `${width}px`;
      marqueeBoxEl.style.height = `${height}px`;
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (!isMarqueeDragging) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      const curX = ev.clientX;
      const curY = ev.clientY;
      const left = Math.min(marqueeStartX, curX);
      const top = Math.min(marqueeStartY, curY);
      const width = Math.abs(curX - marqueeStartX);
      const height = Math.abs(curY - marqueeStartY);

      removeMarqueeBox();

      if (width >= 6 && height >= 6) {
        const box = { left, top, right: left + width, bottom: top + height };
        const matchingStrokes = inkEngine.hitTestBox(box);
        const matchingImages = mediaManager.hitTestBox(box);

        if (matchingStrokes.length > 0) {
          mediaManager.deselect();
          selectInkStrokes(matchingStrokes.map((s) => s.id));
        } else if (matchingImages.length > 0) {
          inkEngine.clearSelection();
          const topImage = matchingImages[matchingImages.length - 1];
          mediaManager.selectImage(topImage.id);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  modeIndicator.addEventListener('click', () => {
    handleToggleMode();
  });

  const fullscreenToggleBtn = document.getElementById('fullscreenToggleBtn');
  const fsIconExpand = document.getElementById('fsIconExpand');
  const fsIconCompress = document.getElementById('fsIconCompress');

  const updateFullscreenIcons = (isFullscreen: boolean) => {
    if (isFullscreen) {
      fsIconExpand?.classList.add('hidden');
      fsIconCompress?.classList.remove('hidden');
    } else {
      fsIconExpand?.classList.remove('hidden');
      fsIconCompress?.classList.add('hidden');
    }
  };

  fullscreenToggleBtn?.addEventListener('click', async () => {
    try {
      const isFs = await toggleFullscreen();
      updateFullscreenIcons(isFs);
      resizeAll();
    } catch (err) {
      console.warn('Toggle fullscreen failed:', err);
    }
  });

  const closeToWallpaperBtn = document.getElementById('closeToWallpaperBtn');
  closeToWallpaperBtn?.addEventListener('click', () => {
    handleToggleMode('wallpaper');
  });

  let clickCount = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let tripleClickTimer: number | null = null;

  inkCanvas.addEventListener('click', (e) => {
    if (currentMode !== 'edit' || e.button !== 0) return;

    if (e.detail === 3) {
      textNotesManager.createNoteAt(e.clientX - 100, e.clientY - 40);
      sceneGraph.markDirty();
      clickCount = 0;
      return;
    }

    const dist = Math.hypot(e.clientX - lastClickX, e.clientY - lastClickY);
    lastClickX = e.clientX;
    lastClickY = e.clientY;

    if (dist < 25) {
      clickCount++;
      if (clickCount === 3) {
        textNotesManager.createNoteAt(e.clientX - 100, e.clientY - 40);
        sceneGraph.markDirty();
        clickCount = 0;
        if (tripleClickTimer) clearTimeout(tripleClickTimer);
        return;
      }
    } else {
      clickCount = 1;
    }

    if (tripleClickTimer) clearTimeout(tripleClickTimer);
    tripleClickTimer = window.setTimeout(() => {
      clickCount = 0;
    }, 450);
  });

  const isTypingActive = (): boolean => {
    const activeEl = document.activeElement as HTMLElement | null;
    return !!(
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.classList.contains('note-content') ||
        activeEl.getAttribute('contenteditable') === 'true')
    );
  };

  window.addEventListener('keydown', async (e) => {
    const isTyping = isTypingActive();

    if (e.key === 'Escape') {
      if (gizmo.isAttached() || inkEngine.hasSelection()) {
        gizmo.detach();
        mediaManager.deselect();
        inkEngine.clearSelection();
        return;
      }
      if (currentMode === 'edit') {
        e.preventDefault();
        handleToggleMode();
      }
    }
    if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      handleToggleMode();
    }
    if (e.key === 'F8') {
      e.preventDefault();
      handleToggleMode();
    }
    if (e.key === 'F11') {
      e.preventDefault();
      try {
        const isFs = await toggleFullscreen();
        updateFullscreenIcons(isFs);
        resizeAll();
      } catch (err) {
        console.warn('Toggle fullscreen failed:', err);
      }
    }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      if (gizmo.isAttached() || inkEngine.hasSelection()) {
        gizmo.detach();
        mediaManager.deselect();
        inkEngine.clearSelection();
      }
      if (e.shiftKey) {
        inkEngine.redo();
      } else {
        inkEngine.undo();
      }
      sceneGraph.markDirty();
    }
    if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
      if (gizmo.isAttached() || inkEngine.hasSelection()) {
        gizmo.detach();
        mediaManager.deselect();
        inkEngine.clearSelection();
      }
      inkEngine.redo();
      sceneGraph.markDirty();
    }
    if (e.key === 'Delete') {
      if (!isTyping && gizmo.isAttached()) {
        if (inkEngine.hasSelection()) {
          inkEngine.deleteSelectedStrokes();
          gizmo.detach();
          sceneGraph.markDirty();
        } else {
          mediaManager.deleteSelected();
          sceneGraph.markDirty();
        }
      }
    }
    // Copy selected ink
    if (!isTyping && e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (inkEngine.hasSelection()) {
        e.preventDefault();
        inkClipboard = inkEngine.cloneSelectedStrokes();
        pasteOffsetCount = 0;
        try {
          const payload = JSON.stringify({
            type: 'desktop-canvas-ink',
            version: 1,
            strokes: inkClipboard,
          });
          navigator.clipboard.writeText(payload);
        } catch {}
      }
    }

    // Cut selected ink
    if (!isTyping && e.ctrlKey && !e.altKey && (e.key === 'x' || e.key === 'X')) {
      if (inkEngine.hasSelection()) {
        e.preventDefault();
        inkClipboard = inkEngine.cloneSelectedStrokes();
        pasteOffsetCount = 0;
        try {
          const payload = JSON.stringify({
            type: 'desktop-canvas-ink',
            version: 1,
            strokes: inkClipboard,
          });
          navigator.clipboard.writeText(payload);
        } catch {}
        inkEngine.deleteSelectedStrokes();
        gizmo.detach();
        sceneGraph.markDirty();
      }
    }

    // Paste copied ink
    if (!isTyping && e.ctrlKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      if (inkClipboard.length > 0) {
        e.preventDefault();
        pasteOffsetCount += 1;
        const offset = { x: 24 * pasteOffsetCount, y: 24 * pasteOffsetCount };
        const pastedStrokes = inkEngine.pasteStrokes(inkClipboard, offset);
        if (pastedStrokes.length > 0) {
          mediaManager.deselect();
          selectInkStrokes(pastedStrokes.map((s) => s.id));
          sceneGraph.markDirty();
        }
      }
    }

    if (!isTyping && currentMode === 'edit' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'e') {
        const curTool = inkEngine.getBrushSettings().tool;
        const nextTool = curTool === 'eraser' ? 'pen' : 'eraser';
        toolbarHUD.selectTool(nextTool);
      } else if (k === 'p' || k === 'b') {
        toolbarHUD.selectTool('pen');
      } else if (k === 'h') {
        toolbarHUD.selectTool('highlighter');
      } else if (k === 's' || k === 'v') {
        toolbarHUD.selectTool('select');
      }
    }
  });

  window.addEventListener('paste', async (e: ClipboardEvent) => {
    if (isTypingActive()) return;
    const text = e.clipboardData?.getData('text');
    if (text && text.includes('desktop-canvas-ink')) {
      try {
        const data = JSON.parse(text);
        if (data && data.type === 'desktop-canvas-ink' && Array.isArray(data.strokes)) {
          e.preventDefault();
          e.stopPropagation();
          pasteOffsetCount += 1;
          const offset = { x: 24 * pasteOffsetCount, y: 24 * pasteOffsetCount };
          const pastedStrokes = inkEngine.pasteStrokes(data.strokes, offset);
          if (pastedStrokes.length > 0) {
            mediaManager.deselect();
            selectInkStrokes(pastedStrokes.map((s) => s.id));
            sceneGraph.markDirty();
          }
        }
      } catch {}
    }
  });

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  const resizeAll = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    backdropRenderer.resize(w, h);
    mediaManager.resize(w, h);
    inkEngine.resize(w, h);
  };
  window.addEventListener('resize', resizeAll);
  resizeAll();

  try {
    await onModeChanged(async (mode) => {
      await updateModeUI(mode as 'wallpaper' | 'edit');
    });
  } catch (e) {
    console.warn('Mode change listener registration skipped (browser mode):', e);
  }

  try {
    await onDisplayBoundsChanged((_topology) => {
      resizeAll();
    });
  } catch (e) {
    console.warn('Display bounds listener registration skipped (browser mode):', e);
  }

  try {
    await onRequestToggleMode(async () => {
      await handleToggleMode();
    });
  } catch (e) {
    console.warn('Request-toggle-mode listener registration skipped:', e);
  }

  const openWizard = async () => {
    wizardContainer.classList.remove('hidden');

    let topology: DisplayTopology = {
      virtualX: 0,
      virtualY: 0,
      virtualWidth: window.innerWidth,
      virtualHeight: window.innerHeight,
      monitors: [],
    };

    try {
      topology = await getDisplayBounds();
    } catch (e) {
      console.warn('Display topology fetch fallback:', e);
    }

    new SetupWizard({
      container: wizardContainer,
      initialSettings: settings,
      topology,
      backdropRenderer,
      onComplete: async (updatedSettings) => {
        settings = updatedSettings;
        document.documentElement.setAttribute('data-theme', settings.theme);
        backdropRenderer.setBackdrop(settings.backdrop);
        wizardContainer.classList.add('hidden');
        await updateModeUI('edit');
      },
    });
  };

  try {
    await onShowWizard(async () => {
      await updateModeUI('edit');
      await openWizard();
    });
  } catch (e) {
    console.warn('Show-wizard event listener skipped (browser mode):', e);
  }

  await updateModeUI('edit');

  if (!settings.firstRunCompleted) {
    await openWizard();
  }
}

window.addEventListener('error', (e) => {
  console.error('Frontend runtime error:', e.error || e.message);
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
