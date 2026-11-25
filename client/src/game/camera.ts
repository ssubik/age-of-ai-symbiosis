// Câmera 2D ISOMÉTRICA (dimetro 2:1, estilo Age of Empires 2).
// Mantém a MESMA interface pública da câmera antiga, para que input.ts e
// state.pickAt() (que trabalham em coordenadas de mundo/tile) não mudem.
//
// Projeção (tile -> tela), com metades de tile HW e HH (proporção 2:1 => HH = HW/2):
//   isoX = (wx - wy) * HW ;  isoY = (wx + wy) * HH
// A câmera centraliza o alvo (x, y) no meio da viewport e aplica o zoom.
//   screen.x = (wx - wy) * HW*z + cx ;  screen.y = (wx + wy) * HH*z + cy
//   onde cx = viewW/2 - (x - y)*HW*z  e  cy = viewH/2 - (x + y)*HH*z
// A inversa (tela -> mundo) resolve o sistema para permitir clique/seleção.

export const TILE_PX = 32; // legado; mantido só por compatibilidade de imports

// Meia-largura / meia-altura de um tile em pixels (zoom 1). Losango 2:1: HW = 2*HH.
export const ISO_HW = 32;
export const ISO_HH = 16;

// Tactical zoom remains deliberately narrow: enough to read a battle or plan a
// district, never far enough to turn the battlefield into a minimap.
export const VIEW_ZOOM = 1.1;
export const MIN_ZOOM = 0.55;
export const MAX_ZOOM = 1.8;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Camera {
  /** Alvo da câmera no mundo (tile X). */
  x = 0;
  /** Alvo da câmera no mundo (tile Y). */
  y = 0;
  /** Current tactical zoom. Changed only through setZoomAt(). */
  zoom = VIEW_ZOOM;
  /** Tamanho da viewport em pixels CSS. */
  viewW = 1;
  viewH = 1;

  constructor(private mapSize: number) {
    this.x = mapSize / 2;
    this.y = mapSize / 2;
  }

  /** Smooth zoom: the zoom eases toward this target around a fixed screen anchor. */
  private zoomTarget = VIEW_ZOOM;
  private zoomAnchor = { x: 0, y: 0 };
  /** Pan momentum after a drag is released (CSS px per second). */
  private vx = 0;
  private vy = 0;

  /** Aproximação de pixels CSS por tile (largura), para usos legados. */
  get scale(): number {
    return 2 * ISO_HW * this.zoom;
  }

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.clampToMap();
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const hw = ISO_HW * this.zoom;
    const hh = ISO_HH * this.zoom;
    const cx = this.viewW / 2 - (this.x - this.y) * hw;
    const cy = this.viewH / 2 - (this.x + this.y) * hh;
    return { x: (wx - wy) * hw + cx, y: (wx + wy) * hh + cy };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const hw = ISO_HW * this.zoom;
    const hh = ISO_HH * this.zoom;
    const cx = this.viewW / 2 - (this.x - this.y) * hw;
    const cy = this.viewH / 2 - (this.x + this.y) * hh;
    const dx = sx - cx; // = (wx - wy) * hw
    const dy = sy - cy; // = (wx + wy) * hh
    const a = dx / hw; // wx - wy
    const b = dy / hh; // wx + wy
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
    this.clampToMap();
  }

  /** Zoom around a screen-space anchor, keeping the world point under the
   * cursor stable. */
  setZoomAt(next: number, sx = this.viewW / 2, sy = this.viewH / 2): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToMap();
  }

  /** Requests a zoom change that glides there over a few frames. */
  zoomBy(factor: number, sx = this.viewW / 2, sy = this.viewH / 2): void {
    this.zoomTarget = clamp(this.zoomTarget * factor, MIN_ZOOM, MAX_ZOOM);
    this.zoomAnchor = { x: sx, y: sy };
  }

  /** Lets a released drag keep gliding: the map keeps moving the way the hand moved (px/s). */
  fling(vx: number, vy: number): void {
    const speed = Math.hypot(vx, vy);
    const max = 2600;
    const k = speed > max ? max / speed : 1;
    this.vx = vx * k;
    this.vy = vy * k;
  }

  /** Stops any momentum (a new drag or keyboard pan takes over). */
  hold(): void {
    this.vx = 0;
    this.vy = 0;
  }

  /** Advances smooth zoom and pan momentum; call once per frame. */
  update(dt: number): void {
    if (Math.abs(this.zoomTarget - this.zoom) > 0.0005) {
      const k = 1 - Math.exp(-dt * 16);
      this.setZoomAt(this.zoom + (this.zoomTarget - this.zoom) * k, this.zoomAnchor.x, this.zoomAnchor.y);
    }
    if (this.vx !== 0 || this.vy !== 0) {
      this.panPx(this.vx * dt, this.vy * dt);
      const decay = Math.exp(-dt * 5.5);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < 12) this.hold();
    }
  }

  /** Shifts the MAP on screen by (dxPx, dyPx); the view moves the opposite way. */
  panPx(dxPx: number, dyPx: number): void {
    // Converte o deslocamento de tela para deslocamento de mundo e move o alvo.
    const center = this.screenToWorld(this.viewW / 2, this.viewH / 2);
    const shifted = this.screenToWorld(this.viewW / 2 + dxPx, this.viewH / 2 + dyPx);
    this.x += center.x - shifted.x;
    this.y += center.y - shifted.y;
    this.clampToMap();
  }

  clampToMap(): void {
    const m = 4;
    this.x = clamp(this.x, -m, this.mapSize + m);
    this.y = clamp(this.y, -m, this.mapSize + m);
  }
}
