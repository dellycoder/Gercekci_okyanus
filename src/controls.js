// Kamera modları: Yüzme (birinci şahıs, dalgalarla yükselip alçalma, dalış),
// Havadan (serbest uçuş drone), Sinematik (otomatik çekimler).
import * as THREE from 'three';

export const MODES = { SWIM: 'swim', AERIAL: 'aerial', CINEMATIC: 'cinematic' };

export class CameraController {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = MODES.SWIM;
    this.yaw = -0.6;
    this.pitch = 0.02;
    this.pos = new THREE.Vector3(0, 0.3, 0);
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.swimSpeed = 1.6;
    this.flySpeed = 25;
    this.diving = false;
    this.waterH = 0;
    this.waterSlope = [0, 0];
    this.roll = 0;
    this.bob = new THREE.Vector3();
    this.cineT = 0;
    this.lookSensitivity = 0.0022;
    this.touchMove = new THREE.Vector2();
    this.touchVert = 0;
    this.seabed = -25;
    this.onModeChange = null;
    this.bindEvents();
  }

  bindEvents() {
    const el = this.dom;
    let dragging = false, lx = 0, ly = 0, pid = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.target !== el) return;
      dragging = true; lx = e.clientX; ly = e.clientY; pid = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el) {
        this.look(e.movementX, e.movementY);
        return;
      }
      if (!dragging || e.pointerId !== pid) return;
      this.look(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    const up = () => { dragging = false; pid = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', () => { el.requestPointerLock?.(); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === MODES.AERIAL) {
        this.pos.y = THREE.MathUtils.clamp(this.pos.y * Math.exp(e.deltaY * 0.001), 3, 2200);
      } else if (this.mode === MODES.SWIM) {
        this.swimSpeed = THREE.MathUtils.clamp(this.swimSpeed * Math.exp(-e.deltaY * 0.001), 0.5, 8);
      }
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  look(dx, dy) {
    if (this.mode === MODES.CINEMATIC) return;
    this.yaw -= dx * this.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.lookSensitivity, -1.5, 1.5);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === MODES.AERIAL) {
      if (prev === MODES.SWIM) this.pos.y = Math.max(this.pos.y, 45);
      this.pitch = Math.min(this.pitch, -0.25);
    } else if (mode === MODES.SWIM) {
      this.pos.y = this.waterH + 0.3;
      this.diving = false;
      this.pitch = 0.02;
    } else if (mode === MODES.CINEMATIC) {
      this.cineT = 0;
    }
    this.onModeChange?.(mode);
  }

  key(...codes) { return codes.some((c) => this.keys.has(c)); }

  update(dt, time) {
    const cam = this.camera;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const mv = new THREE.Vector3();
    if (this.key('KeyW', 'ArrowUp')) mv.add(fwd);
    if (this.key('KeyS', 'ArrowDown')) mv.sub(fwd);
    if (this.key('KeyD', 'ArrowRight')) mv.add(right);
    if (this.key('KeyA', 'ArrowLeft')) mv.sub(right);
    mv.addScaledVector(fwd, this.touchMove.y).addScaledVector(right, this.touchMove.x);
    let vert = 0;
    if (this.key('Space', 'KeyE')) vert += 1;
    if (this.key('KeyC', 'ControlLeft', 'KeyQ')) vert -= 1;
    vert += this.touchVert;
    const fast = this.key('ShiftLeft', 'ShiftRight');

    if (this.mode === MODES.SWIM) this.updateSwim(dt, time, mv, vert, fast);
    else if (this.mode === MODES.AERIAL) this.updateAerial(dt, mv, vert, fast);
    else if (this.mode === MODES.CINEMATIC) this.updateCinematic(dt, time);
    else this.bob.set(0, 0, 0); // sabit kamera (test/ekran görüntüsü)

    cam.position.copy(this.pos).add(this.bob);
    cam.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    cam.updateMatrixWorld();
  }

  updateSwim(dt, time, mv, vert, fast) {
    const speed = this.swimSpeed * (fast ? 2.5 : 1);
    const surfaceY = this.waterH;
    const atSurface = !this.diving;
    if (atSurface) {
      // Yüzeyde yüzme: dalgalar kamerayı taşır
      if (mv.lengthSq() > 0) mv.normalize();
      const target = mv.multiplyScalar(speed);
      this.vel.x += (target.x - this.vel.x) * (1 - Math.exp(-dt * 2.5));
      this.vel.z += (target.z - this.vel.z) * (1 - Math.exp(-dt * 2.5));
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const eye = surfaceY + 0.42 + Math.sin(time * 1.9) * 0.03;
      this.pos.y += (eye - this.pos.y) * (1 - Math.exp(-dt * 7.0));
      if (vert < 0 || (this.pitch < -0.6 && mv.lengthSq() > 0.01 && this.key('KeyW', 'ArrowUp'))) {
        this.diving = true;
        this.vel.y = -1.2;
      }
      // Dalga eğimiyle hafif yuvarlanma
      const rollT = -this.waterSlope[0] * Math.cos(this.yaw) + this.waterSlope[1] * Math.sin(this.yaw);
      this.roll += (THREE.MathUtils.clamp(rollT * 0.5, -0.25, 0.25) - this.roll) * (1 - Math.exp(-dt * 2));
      const swimBob = (mv.lengthSq() > 0.01 ? 1 : 0.3) * 0.025;
      this.bob.set(0, Math.sin(time * 3.2) * swimBob, 0);
    } else {
      // Dalış: 3B serbest yüzme
      const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const rightV = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).negate();
      const target = new THREE.Vector3();
      if (this.key('KeyW', 'ArrowUp')) target.add(look);
      if (this.key('KeyS', 'ArrowDown')) target.sub(look);
      if (this.key('KeyD', 'ArrowRight')) target.add(rightV);
      if (this.key('KeyA', 'ArrowLeft')) target.sub(rightV);
      target.addScaledVector(look, this.touchMove.y).addScaledVector(rightV, this.touchMove.x);
      target.y += vert;
      if (target.lengthSq() > 1) target.normalize();
      target.multiplyScalar(speed);
      target.y += 0.08; // hafif kaldırma kuvveti
      this.vel.lerp(target, 1 - Math.exp(-dt * 1.8));
      this.pos.addScaledVector(this.vel, dt);
      const floor = this.seabed + 1.2;
      if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(this.vel.y, 0); }
      if (this.pos.y > surfaceY + 0.1) { this.diving = false; this.vel.y = 0; }
      this.roll *= Math.exp(-dt * 2);
      this.bob.set(Math.sin(time * 0.7) * 0.03, Math.sin(time * 0.9) * 0.04, 0);
    }
  }

  updateAerial(dt, mv, vert, fast) {
    const alt = Math.max(this.pos.y - this.waterH, 1);
    const speed = Math.max(8, alt * 0.9) * (fast ? 3 : 1);
    if (mv.lengthSq() > 0) mv.normalize();
    const target = mv.multiplyScalar(speed);
    target.y = vert * Math.max(5, alt * 0.6);
    this.vel.lerp(target, 1 - Math.exp(-dt * 2.2));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, this.waterH + 2.5, 2200);
    this.roll += (-this.vel.dot(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) * 0.004 - this.roll) * (1 - Math.exp(-dt * 2));
    this.roll = THREE.MathUtils.clamp(this.roll, -0.2, 0.2);
    this.bob.set(0, 0, 0);
  }

  // Sinematik: yumuşak geçişli otomatik kamera yolları
  updateCinematic(dt, time) {
    this.cineT += dt;
    const shotLen = 22;
    const shot = Math.floor(this.cineT / shotLen) % 5;
    const t = (this.cineT % shotLen) / shotLen;
    const s = t * t * (3 - 2 * t);
    const buoy = this.buoyPos || new THREE.Vector2(22, -48);
    let p, target;
    switch (shot) {
      case 0: { // Dalgaların üzerinde alçak süzülüş
        p = new THREE.Vector3(-60 + 120 * s, this.waterH + 3.5 + Math.sin(time * 0.5) * 0.5, 40 - 30 * s);
        target = p.clone().add(new THREE.Vector3(Math.sin(0.4 + s * 0.6), -0.12, -Math.cos(0.4 + s * 0.6)));
        break;
      }
      case 1: { // Şamandıra etrafında dönüş
        const a = 0.5 + s * 2.2;
        p = new THREE.Vector3(buoy.x + Math.cos(a) * 14, 2.6 + Math.sin(time * 0.4) * 0.3, buoy.y + Math.sin(a) * 14);
        target = new THREE.Vector3(buoy.x, 1.2, buoy.y);
        break;
      }
      case 2: { // Yükselen havadan çekim
        const h = 8 + 380 * s * s;
        p = new THREE.Vector3(0, h, 80 - 40 * s);
        target = new THREE.Vector3(Math.sin(s * 0.8) * 200, 0, -300);
        break;
      }
      case 3: { // Su yüzeyinde, dalgalar arasında
        p = new THREE.Vector3(10 + 20 * s, this.waterH + 0.25, 20 - 10 * s);
        target = p.clone().add(new THREE.Vector3(Math.cos(1.2 + s), 0.05, Math.sin(1.2 + s) * -1));
        break;
      }
      default: { // Su altı geçişi
        p = new THREE.Vector3(buoy.x - 12 + 20 * s, -4 - 3 * Math.sin(s * Math.PI), buoy.y + 8);
        target = new THREE.Vector3(buoy.x, -1.0 + s * 2, buoy.y);
        break;
      }
    }
    this.pos.copy(p);
    const d = target.clone().sub(p).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    this.roll = Math.sin(time * 0.3) * 0.01;
    this.bob.set(0, 0, 0);
    this.cineFade = Math.min(1, Math.min(t * shotLen, (1 - t) * shotLen) / 1.2);
  }
}
