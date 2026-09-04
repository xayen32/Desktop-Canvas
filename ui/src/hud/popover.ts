export interface PopoverOptions {
  anchorEl: HTMLElement;
  content: HTMLElement;
  onClose?: () => void;
}

export class Popover {
  private element: HTMLElement;
  private anchorEl: HTMLElement;
  private onClose?: () => void;
  private handleDocumentClick: (e: MouseEvent) => void;
  private handleKeyDown: (e: KeyboardEvent) => void;

  constructor(options: PopoverOptions) {
    this.anchorEl = options.anchorEl;
    this.onClose = options.onClose;

    this.element = document.createElement('div');
    this.element.className = 'hud-popover';
    this.element.appendChild(options.content);

    this.handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!this.element.contains(target) && !this.anchorEl.contains(target)) {
        this.close();
      }
    };

    this.handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };

    this.mount();
  }

  private mount(): void {
    document.body.appendChild(this.element);
    this.reposition();

    setTimeout(() => {
      document.addEventListener('pointerdown', this.handleDocumentClick);
      document.addEventListener('keydown', this.handleKeyDown);
    }, 10);
  }

  public reposition(): void {
    const anchorRect = this.anchorEl.getBoundingClientRect();
    const popoverRect = this.element.getBoundingClientRect();
    const margin = 8;

    let top = anchorRect.bottom + margin;
    let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;

    if (left < 16) left = 16;
    if (left + popoverRect.width > window.innerWidth - 16) {
      left = window.innerWidth - popoverRect.width - 16;
    }

    if (top + popoverRect.height > window.innerHeight - 16) {
      top = anchorRect.top - popoverRect.height - margin;
    }

    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.left = `${Math.round(left)}px`;
  }

  public close(): void {
    document.removeEventListener('pointerdown', this.handleDocumentClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    if (this.onClose) {
      this.onClose();
    }
  }
}
