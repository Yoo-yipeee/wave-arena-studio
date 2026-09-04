import * as THREE from 'three';

/**
 * Touch — let the viewer disturb the pond.
 *
 * A pointer position is projected onto the water plane and becomes a source in
 * exactly the same impulse buffer the music uses, so a ripple thrown by hand
 * and a ripple thrown by a kick drum are the same kind of thing and interfere
 * with each other properly. Nothing about the water engine needed to change to
 * accept this, which is the payoff for the music placing sources rather than
 * drawing shapes.
 *
 * Dragging is rate-limited: a pointer moves every frame, and emitting on every
 * frame would flood the eight impulse slots and starve the music of its own.
 */
const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const MIN_GAP = 0.075;     // seconds between emitted ripples while dragging

export class Touch {
  constructor(canvas, camera, choreo, arenaRadius) {
    this.camera = camera;
    this.choreo = choreo;
    this.radius = arenaRadius;
    this.enabled = true;

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._last = 0;
    this._down = false;
    this._prev = null;
    this.onRipple = null;

    const pos = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      if (!t) return null;
      const r = canvas.getBoundingClientRect();
      this._ndc.set(
        ((t.clientX - r.left) / r.width) * 2 - 1,
        -((t.clientY - r.top) / r.height) * 2 + 1,
      );
      this._ray.setFromCamera(this._ndc, this.camera);
      return this._ray.ray.intersectPlane(PLANE, this._hit) ? this._hit : null;
    };

    const strike = (ev, hard) => {
      if (!this.enabled) return;
      const p = pos(ev);
      if (!p) return;
      const r = Math.hypot(p.x, p.z);
      if (r > this.radius * 1.05) return;          // outside the pool
      const now = performance.now() / 1000;
      if (!hard && now - this._last < MIN_GAP) return;

      // Dragging fast throws a bigger stone than resting the pointer.
      let speed = 0;
      if (this._prev) speed = Math.hypot(p.x - this._prev.x, p.z - this._prev.z);
      this._prev = { x: p.x, z: p.z };
      this._last = now;

      const strength = hard ? 1.15 : 0.42 + Math.min(0.85, speed * 0.28);
      this.choreo.emit(p.x, p.z, strength, 7.0, 3.0 + strength * 2.4, 0);
      if (this.onRipple) this.onRipple(p, strength);
    };

    canvas.addEventListener('pointerdown', (ev) => {
      this._down = true; this._prev = null; strike(ev, true);
    });
    canvas.addEventListener('pointermove', (ev) => { if (this._down) strike(ev, false); });
    window.addEventListener('pointerup', () => { this._down = false; this._prev = null; });
    canvas.addEventListener('pointerleave', () => { this._down = false; });

    canvas.addEventListener('touchstart', (ev) => { ev.preventDefault(); strike(ev, true); }, { passive: false });
    canvas.addEventListener('touchmove', (ev) => { ev.preventDefault(); strike(ev, false); }, { passive: false });
  }
}
