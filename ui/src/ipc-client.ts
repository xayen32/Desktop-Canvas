import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { BackdropSchema, CanvasStateSchema, DisplayTopology, SettingsPatch, SettingsSchema } from './types/schema';

export async function getSettings(): Promise<{ settings: SettingsSchema }> {
  return await invoke<{ settings: SettingsSchema }>('get_settings');
}

export async function updateSettings(patch: SettingsPatch): Promise<{ settings: SettingsSchema }> {
  return await invoke<{ settings: SettingsSchema }>('update_settings', { patch });
}

export async function setWallpaperBackend(backdrop: BackdropSchema): Promise<{ ok: boolean }> {
  return await invoke<{ ok: boolean }>('set_wallpaper_backend', { backdrop });
}

export async function applyWallpaperSnapshot(base64Png: string): Promise<{ ok: boolean }> {
  return await invoke<{ ok: boolean }>('apply_wallpaper_snapshot', { base64Png });
}

export async function toggleMode(target?: 'wallpaper' | 'edit' | 'auto'): Promise<{ ok: boolean; mode: string }> {
  return await invoke<{ ok: boolean; mode: string }>('toggle_mode', { target });
}

export async function toggleFullscreen(): Promise<boolean> {
  return await invoke<boolean>('toggle_fullscreen');
}

export async function getDisplayBounds(): Promise<DisplayTopology> {
  return await invoke<DisplayTopology>('get_display_bounds');
}

export async function importImage(
  base64Data: string,
  mimeType: string
): Promise<{ assetHash: string; localFilePath: string }> {
  return await invoke<{ assetHash: string; localFilePath: string }>('import_image', {
    base64Data,
    mimeType,
  });
}

export async function saveCanvas(state: CanvasStateSchema): Promise<{ ok: boolean; savedAt: string }> {
  return await invoke<{ ok: boolean; savedAt: string }>('save_canvas', { state });
}

export async function loadCanvas(): Promise<{ state: CanvasStateSchema }> {
  return await invoke<{ state: CanvasStateSchema }>('load_canvas');
}

export async function onModeChanged(callback: (mode: string) => void): Promise<UnlistenFn> {
  return await listen<{ mode: string }>('mode-changed', (event) => {
    callback(event.payload.mode);
  });
}

export async function onDisplayBoundsChanged(callback: (bounds: DisplayTopology) => void): Promise<UnlistenFn> {
  return await listen<DisplayTopology>('display-changed', (event) => {
    callback(event.payload);
  });
}

export async function onShowWizard(callback: () => void): Promise<UnlistenFn> {
  return await listen('show-wizard', () => {
    callback();
  });
}

export async function onRequestToggleMode(callback: () => void): Promise<UnlistenFn> {
  return await listen('request-toggle-mode', () => {
    callback();
  });
}
