import { generateUUID } from './stroke';
import { TextNoteElement } from '../types/schema';

export const STICKY_PRESETS = [
  { name: 'Transparent', bg: 'transparent', color: '#F3F4F6', radius: 10 },
  { name: 'Dark Acrylic', bg: '#25272D', color: '#F3F4F6', radius: 12 },
  { name: 'Soft Amber', bg: '#FEF3C7', color: '#78350F', radius: 12 },
  { name: 'Soft Sage', bg: '#DCFCE7', color: '#14532D', radius: 12 },
  { name: 'Soft Sky', bg: '#E0F2FE', color: '#075985', radius: 12 },
  { name: 'Soft Lavender', bg: '#F3E8FF', color: '#581C87', radius: 12 },
  { name: 'Frosted Glass', bg: 'rgba(255, 255, 255, 0.12)', color: '#FFFFFF', radius: 12 },
];

export interface TextNotesOptions {
  container: HTMLElement;
  onChange?: (notes: TextNoteElement[]) => void;
}

export class FloatingTextNotesManager {
  private container: HTMLElement;
  private notes: TextNoteElement[] = [];
  private activeNoteId: string | null = null;
  private onChange?: (notes: TextNoteElement[]) => void;
  private enabled: boolean = false;

  constructor(options: TextNotesOptions) {
    this.container = options.container;
    this.onChange = options.onChange;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.querySelectorAll('.text-note-container').forEach((el) => {
      (el as HTMLElement).style.pointerEvents = enabled ? 'auto' : 'none';
    });
  }

  public getNotes(): TextNoteElement[] {
    return [...this.notes];
  }

  public setNotes(notes: TextNoteElement[]): void {
    this.notes = notes.map((n) => {
      if (!n.stickyStyle || n.stickyStyle.backgroundColor === '#25272D') {
        return {
          ...n,
          stickyStyle: {
            backgroundColor: 'transparent',
            cornerRadius: 10,
          },
        };
      }
      return { ...n };
    });
    this.renderAll();
  }

  public createNoteAt(x: number, y: number): TextNoteElement {
    const newNote: TextNoteElement = {
      id: generateUUID(),
      type: 'textNote',
      content: '',
      typography: {
        fontFamily: 'Segoe UI',
        fontSize: 16,
        color: '#F3F4F6',
        fontWeight: 400,
      },
      stickyStyle: {
        backgroundColor: 'transparent',
        cornerRadius: 10,
      },
      dimensions: {
        x: Math.round(x),
        y: Math.round(y),
        width: 240,
        height: 180,
      },
      zIndex: this.notes.length + 10,
    };

    this.notes.push(newNote);
    this.renderAll();
    this.focusNote(newNote.id);
    this.notify();
    return newNote;
  }

  public removeNote(id: string): void {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.renderAll();
    this.notify();
  }

  public renderAll(): void {
    this.container.innerHTML = '';
    for (const note of this.notes) {
      this.renderNoteDom(note);
    }
  }

  private renderNoteDom(note: TextNoteElement): void {
    const bg = note.stickyStyle ? note.stickyStyle.backgroundColor : 'transparent';
    const isTransparent = !bg || bg === 'transparent';
    const radius = note.stickyStyle ? note.stickyStyle.cornerRadius : 10;

    const el = document.createElement('div');
    el.className = `text-note-container ${this.activeNoteId === note.id ? 'active' : ''} ${isTransparent ? 'is-transparent' : ''}`;
    el.id = `note-${note.id}`;

    const { x, y, width, height } = note.dimensions;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.zIndex = `${note.zIndex}`;
    el.style.pointerEvents = this.enabled ? 'auto' : 'none';
    el.style.backgroundColor = isTransparent ? 'transparent' : bg;
    el.style.borderRadius = `${radius}px`;

    el.innerHTML = `
      <div class="note-header">
        <div class="note-drag-handle" title="Drag to move">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="note-header-icon">
            <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5z"/>
            <path d="M15 3v5h5"/>
          </svg>
          <span class="note-handle-dots">⠿</span>
        </div>
        <div class="note-font-controls">
          <button class="font-btn font-down" title="Decrease font size">A-</button>
          <button class="font-btn font-up" title="Increase font size">A+</button>
        </div>
        <div class="note-presets">
          ${STICKY_PRESETS.map(
            (p) => `
            <button class="preset-dot" style="background-color: ${p.bg};" data-preset="${p.name}" title="${p.name}"></button>
          `
          ).join('')}
        </div>
        <button class="note-close-btn" title="Delete Note">✕</button>
      </div>
      <div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="Take a note..." style="font-family: ${note.typography.fontFamily}; font-size: ${note.typography.fontSize}px; color: ${note.typography.color}; font-weight: ${note.typography.fontWeight};">${note.content}</div>
      <div class="note-resize-handle" title="Drag to resize">⋱</div>
    `;

    const contentEl = el.querySelector('.note-content') as HTMLElement;
    contentEl.addEventListener('input', () => {
      note.content = contentEl.innerText;
      this.notify();
    });

    contentEl.addEventListener('focus', () => {
      this.activeNoteId = note.id;
    });

    el.querySelectorAll('.preset-dot').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pName = (btn as HTMLElement).dataset.preset;
        const preset = STICKY_PRESETS.find((p) => p.name === pName);
        if (preset) {
          note.stickyStyle = {
            backgroundColor: preset.bg,
            cornerRadius: preset.radius,
          };
          note.typography.color = preset.color;
          this.renderAll();
          this.notify();
        }
      });
    });

    const fontDownBtn = el.querySelector('.font-down');
    if (fontDownBtn) {
      fontDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        note.typography.fontSize = Math.max(12, (note.typography.fontSize || 16) - 2);
        contentEl.style.fontSize = `${note.typography.fontSize}px`;
        this.notify();
      });
    }

    const fontUpBtn = el.querySelector('.font-up');
    if (fontUpBtn) {
      fontUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        note.typography.fontSize = Math.min(36, (note.typography.fontSize || 16) + 2);
        contentEl.style.fontSize = `${note.typography.fontSize}px`;
        this.notify();
      });
    }

    const closeBtn = el.querySelector('.note-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeNote(note.id);
      });
    }

    const handle = el.querySelector('.note-drag-handle') as HTMLElement;
    this.bindNoteDrag(el, handle, note);

    const resizeHandle = el.querySelector('.note-resize-handle') as HTMLElement;
    if (resizeHandle) {
      this.bindNoteResize(el, resizeHandle, note);
    }

    this.container.appendChild(el);
  }

  private focusNote(id: string): void {
    this.activeNoteId = id;
    const noteEl = document.getElementById(`note-${id}`);
    if (noteEl) {
      const contentEl = noteEl.querySelector('.note-content') as HTMLElement;
      if (contentEl) {
        contentEl.focus();
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  private bindNoteDrag(noteEl: HTMLElement, handle: HTMLElement, note: TextNoteElement): void {
    let isDragging = false;
    let offset = { x: 0, y: 0 };

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      isDragging = true;
      const rect = noteEl.getBoundingClientRect();
      offset.x = e.clientX - rect.left;
      offset.y = e.clientY - rect.top;
      noteEl.setPointerCapture(e.pointerId);
      noteEl.classList.add('dragging');
      this.activeNoteId = note.id;
    });

    noteEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isDragging) return;
      let newX = e.clientX - offset.x;
      let newY = e.clientY - offset.y;

      newX = Math.max(8, Math.min(window.innerWidth - note.dimensions.width - 8, newX));
      newY = Math.max(8, Math.min(window.innerHeight - note.dimensions.height - 8, newY));

      note.dimensions.x = Math.round(newX);
      note.dimensions.y = Math.round(newY);
      noteEl.style.left = `${note.dimensions.x}px`;
      noteEl.style.top = `${note.dimensions.y}px`;
    });

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      noteEl.classList.remove('dragging');
      try {
        noteEl.releasePointerCapture(e.pointerId);
      } catch {
      }
      this.notify();
    };

    noteEl.addEventListener('pointerup', onPointerUp);
    noteEl.addEventListener('pointercancel', onPointerUp);
  }

  private bindNoteResize(noteEl: HTMLElement, resizeHandle: HTMLElement, note: TextNoteElement): void {
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = note.dimensions.width;
      startH = note.dimensions.height;
      resizeHandle.setPointerCapture(e.pointerId);
      noteEl.classList.add('resizing');
      this.activeNoteId = note.id;
    });

    resizeHandle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isResizing) return;
      e.stopPropagation();
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      const newW = Math.max(160, Math.min(window.innerWidth - note.dimensions.x - 16, startW + deltaX));
      const newH = Math.max(110, Math.min(window.innerHeight - note.dimensions.y - 16, startH + deltaY));

      note.dimensions.width = Math.round(newW);
      note.dimensions.height = Math.round(newH);
      noteEl.style.width = `${note.dimensions.width}px`;
      noteEl.style.height = `${note.dimensions.height}px`;
    });

    const onPointerUp = (e: PointerEvent) => {
      if (!isResizing) return;
      isResizing = false;
      noteEl.classList.remove('resizing');
      try {
        resizeHandle.releasePointerCapture(e.pointerId);
      } catch {
      }
      this.notify();
    };

    resizeHandle.addEventListener('pointerup', onPointerUp);
    resizeHandle.addEventListener('pointercancel', onPointerUp);
  }

  private notify(): void {
    if (this.onChange) {
      this.onChange(this.getNotes());
    }
  }
}
