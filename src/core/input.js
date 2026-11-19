// Mouse (pointer-lock) + keyboard input with per-frame edge detection.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.dx = 0; this.dy = 0;
    this.buttons = 0;
    this.keys = new Set();
    this.pressed = new Set();
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;

    this.settle = 0; // movement events to drop just after the lock (Chromium's first ones can be a huge jump)
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (this.settle > 0) { this.settle--; return; }
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons |= 1 << e.button;
      this.pressed.add('Mouse' + e.button);
    });
    document.addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab', 'AltLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.buttons = 0;
      else this.settle = 2;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  mouse(btn) { return (this.buttons & (1 << btn)) !== 0; }

  endFrame() {
    this.dx = 0; this.dy = 0;
    this.pressed.clear();
  }
}
