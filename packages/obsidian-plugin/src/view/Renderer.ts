import { nodeRadius, type ForceSim, type SimEdge, type SimNode } from "./ForceSim.js";

const PULSE_DURATION_MS = 600;
// A struck edge lights up its whole length instantly — no travel time, the
// current has already reached the far end — holds bright for
// IMPULSE_HOLD_FRACTION of this duration so the path actually stays
// visible, then fades out over the rest.
const DIRECTIONAL_PULSE_DURATION_MS = 2600;
const IMPULSE_HOLD_FRACTION = 0.35;
// Deliberately outlives the directional pulse that feeds it, so "pulse
// arrives, node glows, fades" reads as one hop.
const ACTIVATION_RING_DURATION_MS = 2600;
const DEFAULT_EDGE_MAX_AGE_DAYS = 30;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.2;
// Full cycle of the weighted-link ambient glow breathe, in ms — slow and
// calm, meant to read as "alive," not distracting.
const GLOW_BREATHE_PERIOD_MS = 2400;

export type ColorScheme = "default" | "high-contrast";

interface Pulse {
  key: string;
  start: number;
}

function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Cheap non-cryptographic string hash — only used to derive a stable per-edge animation phase, not for anything sensitive. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function resolvedNode(end: string | SimNode): SimNode | null {
  return typeof end === "string" ? null : end;
}

// Weighted links render as a plain white glow (see drawWeightedEdge below)
// rather than a hue gradient, so "color scheme" now controls glow contrast
// instead of hue: high-contrast keeps weak links more visible and pushes
// strong links brighter, for readers who found the old hue palette's
// midtones hard to distinguish.
const GLOW_SCHEME_CONFIG: Record<ColorScheme, { minAlpha: number; glowBoost: number }> = {
  default: { minAlpha: 0.06, glowBoost: 1 },
  "high-contrast": { minAlpha: 0.18, glowBoost: 1.3 },
};

// Fallback only for a cluster index ForceSim hasn't assigned a hue to yet
// (shouldn't normally happen — getClusterHue covers every index in
// 0..clusterCount-1 — but golden-angle spacing keeps it distinct if it does).
const CLUSTER_HUE_FALLBACK_STEP = 137.508;

function clusterColor(hue: number, alpha: number): string {
  return `hsla(${hue}, 60%, 62%, ${alpha})`;
}

/** Deterministic given the same seed — used to jag a struck edge's path once per pulse, not re-rolled every frame (that's what made an earlier attempt read as wobbling rather than a spark). */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const SPARK_SEGMENTS = 5;
const SPARK_AMPLITUDE = 4;

/**
 * Builds a subtle, fixed zigzag path from (x1,y1) to (x2,y2) — seeded so
 * the shape stays constant across frames for a given seed, rather than
 * re-rolling every frame (that's what made an earlier attempt read as
 * wobbling rather than a spark). Both endpoints land exactly on the nodes
 * the edge connects; only the middle jags.
 */
function buildSparkPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amplitude: number,
): [number, number][] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const points: [number, number][] = [[x1, y1]];
  for (let i = 1; i < SPARK_SEGMENTS; i++) {
    const t = i / SPARK_SEGMENTS;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    // taper toward both endpoints so it still lands exactly on the nodes
    // it connects, not drifting off to the side at the tips
    const taper = Math.sin(Math.PI * t);
    const jitter = (pseudoRandom(seed + i) - 0.5) * 2 * amplitude * taper;
    points.push([px + nx * jitter, py + ny * jitter]);
  }
  points.push([x2, y2]);
  return points;
}

function strokeSparkPath(ctx: CanvasRenderingContext2D, points: readonly [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

/**
 * Draws a struck edge: the whole (x1,y1)-(x2,y2) span lights up instantly,
 * thin and bright yellow — current has already reached the far end, no
 * travel animation — and holds/fades with the caller's `fade`.
 */
function drawStruckEdge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fade: number,
  scale: number,
  seed: number,
): void {
  const points = buildSparkPath(x1, y1, x2, y2, seed, SPARK_AMPLITUDE / scale);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 10 * fade;
  ctx.shadowColor = `rgba(255, 200, 60, ${fade})`;
  ctx.strokeStyle = `rgba(255, 225, 110, ${fade})`;
  ctx.lineWidth = 1.3 / scale;
  strokeSparkPath(ctx, points);
  ctx.restore();
}

/**
 * Canvas draw loop consuming ForceSim positions.
 * - Edge thickness ∝ weight (log-scaled)
 * - Edge opacity/color fades toward muted as lastTouched ages, independent of weight
 * - Reinforcement pulse: brief animation when a reinforce event lands
 * - Interaction: click node → open note; hover edge → tooltip (weight, traverseCount, lastTouched)
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private nodes: SimNode[] = [];
  private pulses: Pulse[] = [];
  private directionalPulses: { source: string; target: string; start: number }[] = [];
  private rafHandle: number | null = null;
  private hoveredEdge: SimEdge | null = null;
  private hoveredNode: SimNode | null = null;
  private tooltipEl: HTMLDivElement | null = null;
  private onNodeClick: ((id: string) => void) | null = null;
  private scale = 1;
  private panX = 0;
  private panY = 0;
  private glowScheme = GLOW_SCHEME_CONFIG.default;
  private edgeMaxAgeDays = DEFAULT_EDGE_MAX_AGE_DAYS;
  private primedNotes: ReadonlySet<string> = new Set();

  // drag state: either panning the canvas or dragging a single node
  private dragNode: SimNode | null = null;
  private isPanning = false;
  private dragMoved = false;
  private lastClientX = 0;
  private lastClientY = 0;

  private readonly handleClick = (evt: MouseEvent) => this.onClick(evt);
  private readonly handleMouseDown = (evt: MouseEvent) => this.onMouseDown(evt);
  private readonly handleMouseMove = (evt: MouseEvent) => this.onMouseMove(evt);
  private readonly handleMouseUp = () => this.endDrag();
  private readonly handleMouseLeave = () => this.clearHover();
  private readonly handleWheel = (evt: WheelEvent) => this.onWheel(evt);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: ForceSim,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.sim.onTick((nodes) => {
      this.nodes = nodes;
    });
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    // dragging continues on window so it survives the cursor leaving the canvas
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  onNodeClicked(callback: (id: string) => void): void {
    this.onNodeClick = callback;
  }

  setColorScheme(scheme: ColorScheme): void {
    this.glowScheme = GLOW_SCHEME_CONFIG[scheme];
  }

  setEdgeMaxAgeDays(days: number): void {
    this.edgeMaxAgeDays = days;
  }

  setPrimedNotes(notes: ReadonlySet<string>): void {
    this.primedNotes = notes;
  }

  start(): void {
    this.resizeToDisplaySize();
    const loop = () => {
      this.resizeToDisplaySize();
      this.draw();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.sim.stop();
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }

  pulseEdge(source: string, target: string): void {
    this.pulses.push({ key: edgeKey(source, target), start: performance.now() });
  }

  /** A bright, fixed-color moving point along source→target for live activation events — distinct from the weight-gradient reinforcement pulse above. */
  pulseEdgeDirectional(source: string, target: string): void {
    this.directionalPulses.push({ source, target, start: performance.now() });
  }

  zoomIn(): void {
    this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, 1 / ZOOM_STEP);
  }

  resetView(): void {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
  }

  private zoomAt(screenX: number, screenY: number, factor: number): void {
    const { x: cx, y: cy } = this.center();
    const worldX = (screenX - cx - this.panX) / this.scale;
    const worldY = (screenY - cy - this.panY) / this.scale;

    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.panX = screenX - cx - worldX * newScale;
    this.panY = screenY - cy - worldY * newScale;
    this.scale = newScale;
  }

  private onWheel(evt: WheelEvent): void {
    evt.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const sx = (evt.clientX - rect.left) * ratio;
    const sy = (evt.clientY - rect.top) * ratio;
    const factor = evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.zoomAt(sx, sy, factor);
  }

  private resizeToDisplaySize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private center(): { x: number; y: number } {
    return { x: this.canvas.width / 2, y: this.canvas.height / 2 };
  }

  private draw(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { x: cx, y: cy } = this.center();
    ctx.save();
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.scale, this.scale);

    const now = performance.now();
    this.pulses = this.pulses.filter((p) => now - p.start < PULSE_DURATION_MS);
    this.directionalPulses = this.directionalPulses.filter((p) => now - p.start < DIRECTIONAL_PULSE_DURATION_MS);

    const hoveredId = this.hoveredNode?.id;

    for (const edge of this.sim.getEdges()) {
      const source = resolvedNode(edge.source);
      const target = resolvedNode(edge.target);
      if (!source || !target || source.x === undefined || target.x === undefined) continue;
      if (target.x === undefined || target.y === undefined || source.y === undefined) continue;

      const isHovered = this.hoveredEdge === edge;
      const touchesHoveredNode = hoveredId !== undefined && (source.id === hoveredId || target.id === hoveredId);
      const dimmed = hoveredId !== undefined && !touchesHoveredNode;

      if (edge.kind === "native") {
        const highlighted = isHovered || touchesHoveredNode;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.lineWidth = (highlighted ? 1.2 : 0.5) / this.scale;
        ctx.strokeStyle = highlighted
          ? "rgba(210, 210, 220, 0.6)"
          : dimmed
            ? "rgba(140, 140, 150, 0.04)"
            : "rgba(140, 140, 150, 0.1)";
        ctx.stroke();
        continue;
      }

      const ageDays = (Date.now() - Date.parse(edge.lastTouched)) / 86_400_000;
      const freshness = Math.max(0, 1 - ageDays / this.edgeMaxAgeDays);
      const thickness = Math.max(0.4, Math.log2(edge.weight + 1) * 0.6);
      const pulse = this.pulses.find((p) => p.key === edgeKey(source.id, target.id));
      const pulseBoost = pulse ? 1 - (now - pulse.start) / PULSE_DURATION_MS : 0;

      // Weighted links are a plain white glow whose intensity is driven by
      // weight relative to the strongest edge in view — brighter, wider glow
      // the more it's been used — plus a slow ambient breathe so strong
      // links feel alive rather than static. Phase is keyed off the edge so
      // edges don't all breathe in lockstep.
      const maxWeight = this.sim.getMaxWeight();
      const weightT = maxWeight > 0 ? Math.min(1, edge.weight / maxWeight) : 0;
      const edgeSeed = hashString(edgeKey(source.id, target.id));
      const phase = (edgeSeed % 1000) / 1000 * Math.PI * 2;
      const breathe = 0.5 + 0.5 * Math.sin((now / GLOW_BREATHE_PERIOD_MS) * Math.PI * 2 + phase);
      const glowStrength = Math.min(1, weightT * (0.75 + 0.25 * breathe) * this.glowScheme.glowBoost + pulseBoost);

      const baseAlpha = Math.min(1, this.glowScheme.minAlpha + freshness * 0.35 + pulseBoost * 0.5);
      const alpha = touchesHoveredNode ? 1 : dimmed ? baseAlpha * 0.15 : baseAlpha;

      ctx.lineWidth = (thickness + pulseBoost * 3 + (touchesHoveredNode ? 0.5 : 0)) / this.scale;
      ctx.shadowBlur = 4 + 16 * glowStrength;
      ctx.shadowColor = `rgba(255, 255, 255, ${glowStrength})`;
      ctx.strokeStyle = `rgba(255, 255, 255, ${isHovered ? Math.min(1, alpha + 0.3) : alpha})`;

      // Any weighted link (weight > 0) reads as a spark — a subtle, fixed
      // zigzag rather than a plain straight line — with the jag more
      // pronounced the stronger the edge, same seed-per-edge approach as
      // the activation strike so it stays still, not flickering per frame.
      if (edge.weight > 0) {
        const amplitude = (SPARK_AMPLITUDE * (0.5 + 0.5 * weightT)) / this.scale;
        strokeSparkPath(ctx, buildSparkPath(source.x, source.y, target.x, target.y, edgeSeed, amplitude));
      } else {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // Live activation: current hits the node and every branch it spread
    // through lights up instantly (no travel time) and stays visible,
    // thin and bright yellow, before fading out.
    for (const pulse of this.directionalPulses) {
      const source = this.nodes.find((n) => n.id === pulse.source);
      const target = this.nodes.find((n) => n.id === pulse.target);
      if (!source || !target || source.x === undefined || source.y === undefined) continue;
      if (target.x === undefined || target.y === undefined) continue;

      const t = Math.min(1, (now - pulse.start) / DIRECTIONAL_PULSE_DURATION_MS);
      const fade =
        t < IMPULSE_HOLD_FRACTION ? 1 : Math.max(0, 1 - (t - IMPULSE_HOLD_FRACTION) / (1 - IMPULSE_HOLD_FRACTION));
      drawStruckEdge(ctx, source.x, source.y, target.x, target.y, fade, this.scale, pulse.start);
    }

    for (const node of this.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const isHovered = this.hoveredNode === node;
      const radius = nodeRadius(this.sim.getDegree(node.id), this.sim.getImportance(node.id));

      const nodeLastTouched = this.sim.getLastTouched(node.id);
      const nodeAgeDays = nodeLastTouched ? (Date.now() - Date.parse(nodeLastTouched)) / 86_400_000 : Infinity;
      const nodeFreshness = Math.max(0, 1 - nodeAgeDays / this.edgeMaxAgeDays);
      const nodeAlpha = Math.min(1, 0.35 + nodeFreshness * 0.65);

      const cluster = this.sim.getCluster(node.id);
      const clusterHue = cluster !== undefined ? (this.sim.getClusterHue(cluster) ?? (cluster * CLUSTER_HUE_FALLBACK_STEP) % 360) : undefined;
      const fillStyle = isHovered
        ? "rgba(255, 200, 80, 0.95)"
        : clusterHue !== undefined
          ? clusterColor(clusterHue, nodeAlpha)
          : `rgba(220, 220, 230, ${nodeAlpha})`;

      ctx.beginPath();
      ctx.arc(node.x, node.y, isHovered ? radius * 1.2 : radius, 0, Math.PI * 2);
      ctx.fillStyle = fillStyle;
      ctx.fill();

      if (this.sim.getConsolidatedScore(node.id) > 0) {
        ctx.save();
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeStyle = "rgba(230, 190, 60, 0.95)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4 / this.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (this.primedNotes.has(node.id)) {
        ctx.save();
        ctx.setLineDash([4 / this.scale, 3 / this.scale]);
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeStyle = "rgba(255, 170, 60, 0.9)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8 / this.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const activating = this.sim.getActivating(node.id);
      if (activating && now - activating.start < ACTIVATION_RING_DURATION_MS) {
        const fade = 1 - (now - activating.start) / ACTIVATION_RING_DURATION_MS;
        ctx.save();
        ctx.lineWidth = 2 / this.scale;
        ctx.strokeStyle = `rgba(120, 200, 255, ${fade})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 12 / this.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (isHovered) {
        const title = node.id.split("/").pop() ?? node.id;
        ctx.font = `${13 / this.scale}px var(--font-interface, sans-serif)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(235, 235, 245, 0.95)";
        ctx.fillText(title, node.x, node.y + radius + 4 / this.scale);
      }
    }

    ctx.restore();
  }

  private eventToWorld(evt: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const { x: cx, y: cy } = this.center();
    return {
      x: ((evt.clientX - rect.left) * ratio - cx - this.panX) / this.scale,
      y: ((evt.clientY - rect.top) * ratio - cy - this.panY) / this.scale,
    };
  }

  private hitTestNode(worldX: number, worldY: number): SimNode | null {
    for (const node of this.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      const threshold = nodeRadius(this.sim.getDegree(node.id), this.sim.getImportance(node.id)) + 3;
      if (dx * dx + dy * dy <= threshold ** 2) return node;
    }
    return null;
  }

  private hitTestEdge(worldX: number, worldY: number): SimEdge | null {
    const threshold = 5;
    for (const edge of this.sim.getEdges()) {
      const source = resolvedNode(edge.source);
      const target = resolvedNode(edge.target);
      if (!source || !target) continue;
      if (source.x === undefined || source.y === undefined) continue;
      if (target.x === undefined || target.y === undefined) continue;

      const dist = distanceToSegment(worldX, worldY, source.x, source.y, target.x, target.y);
      if (dist <= threshold) return edge;
    }
    return null;
  }

  private isOverCanvas(evt: MouseEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return (
      evt.clientX >= rect.left && evt.clientX <= rect.right && evt.clientY >= rect.top && evt.clientY <= rect.bottom
    );
  }

  private onClick(evt: MouseEvent): void {
    if (this.dragMoved) return; // suppress the click that follows a drag
    const { x, y } = this.eventToWorld(evt);
    const node = this.hitTestNode(x, y);
    if (node) this.onNodeClick?.(node.id);
  }

  private onMouseDown(evt: MouseEvent): void {
    const { x, y } = this.eventToWorld(evt);
    const node = this.hitTestNode(x, y);
    this.dragMoved = false;
    this.lastClientX = evt.clientX;
    this.lastClientY = evt.clientY;

    if (node) {
      this.dragNode = node;
      node.fx = node.x;
      node.fy = node.y;
      this.sim.reheat();
    } else {
      this.isPanning = true;
      this.canvas.style.cursor = "grabbing";
    }
  }

  private onMouseMove(evt: MouseEvent): void {
    if (this.dragNode) {
      const dx = evt.clientX - this.lastClientX;
      const dy = evt.clientY - this.lastClientY;
      if (dx !== 0 || dy !== 0) this.dragMoved = true;
      const { x, y } = this.eventToWorld(evt);
      this.dragNode.fx = x;
      this.dragNode.fy = y;
      this.lastClientX = evt.clientX;
      this.lastClientY = evt.clientY;
      return;
    }

    if (this.isPanning) {
      const ratio = window.devicePixelRatio || 1;
      const dx = (evt.clientX - this.lastClientX) * ratio;
      const dy = (evt.clientY - this.lastClientY) * ratio;
      if (dx !== 0 || dy !== 0) this.dragMoved = true;
      this.panX += dx;
      this.panY += dy;
      this.lastClientX = evt.clientX;
      this.lastClientY = evt.clientY;
      return;
    }

    if (!this.isOverCanvas(evt)) {
      this.clearHover();
      return;
    }

    const { x, y } = this.eventToWorld(evt);
    const node = this.hitTestNode(x, y);
    const edge = node ? null : this.hitTestEdge(x, y);
    this.hoveredNode = node;
    this.hoveredEdge = edge;
    this.canvas.style.cursor = node ? "grab" : "default";

    // node titles are drawn directly on the canvas next to the dot; the
    // floating tooltip is only needed for edges, which carry more detail
    // than fits comfortably along a line.
    if (!edge) {
      this.tooltipEl?.remove();
      this.tooltipEl = null;
      return;
    }

    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement("div");
      this.tooltipEl.addClass("vault-neural-links-tooltip");
      this.canvas.parentElement?.appendChild(this.tooltipEl);
    }

    const source = resolvedNode(edge.source);
    const target = resolvedNode(edge.target);
    this.tooltipEl.setText(
      edge.kind === "native"
        ? `${source?.id ?? "?"} ↔ ${target?.id ?? "?"}\n(native wikilink)`
        : `${source?.id ?? "?"} ↔ ${target?.id ?? "?"}\nweight: ${edge.weight.toFixed(2)}\nlast touched: ${edge.lastTouched}`,
    );
    this.tooltipEl.style.left = `${evt.clientX + 12}px`;
    this.tooltipEl.style.top = `${evt.clientY + 12}px`;
  }

  private endDrag(): void {
    if (this.dragNode) {
      this.dragNode.fx = null;
      this.dragNode.fy = null;
      this.dragNode = null;
    }
    this.isPanning = false;
    this.canvas.style.cursor = this.hoveredNode ? "grab" : "default";
  }

  private clearHover(): void {
    this.hoveredNode = null;
    this.hoveredEdge = null;
    this.canvas.style.cursor = "default";
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}
