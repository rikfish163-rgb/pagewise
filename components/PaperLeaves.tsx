'use client';

import { useEffect, useRef } from 'react';

type LeafKind = 'maple' | 'ginkgo' | 'willow' | 'petal' | 'osmanthus' | 'fleck';

export const DEFAULT_LEAF_COUNT = 48;
export const MIN_LEAF_COUNT = 12;
export const MAX_LEAF_COUNT = 120;

export const DEFAULT_LEAF_SIZE = 12;
export const MIN_LEAF_SIZE = 7;
export const MAX_LEAF_SIZE = 24;

export function clampLeafCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LEAF_COUNT;
  return Math.round(Math.min(MAX_LEAF_COUNT, Math.max(MIN_LEAF_COUNT, parsed)));
}

export function clampLeafSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LEAF_SIZE;
  return Math.round(Math.min(MAX_LEAF_SIZE, Math.max(MIN_LEAF_SIZE, parsed)) * 2) / 2;
}

const AUTUMN_PALETTES: Record<LeafKind, { base: string; tip: string; vein: string }[]> = {
  maple: [
    { base: '#c4493a', tip: '#9e352a', vein: 'rgba(54, 20, 14, 0.22)' },
    { base: '#d0653a', tip: '#b2462d', vein: 'rgba(58, 24, 14, 0.20)' },
    { base: '#cf8d42', tip: '#b85735', vein: 'rgba(62, 30, 16, 0.19)' },
    { base: '#a7b06a', tip: '#c46b3a', vein: 'rgba(52, 38, 18, 0.18)' },
    { base: '#b03a32', tip: '#872923', vein: 'rgba(44, 14, 12, 0.22)' },
  ],
  ginkgo: [
    { base: '#e2bf4e', tip: '#c29234', vein: 'rgba(68, 44, 14, 0.15)' },
    { base: '#d8ae3a', tip: '#b3832c', vein: 'rgba(64, 42, 14, 0.16)' },
    { base: '#c79a45', tip: '#9e7330', vein: 'rgba(60, 38, 14, 0.16)' },
    { base: '#b9bf5a', tip: '#c99e3e', vein: 'rgba(56, 46, 16, 0.15)' },
  ],
  willow: [
    { base: '#c29653', tip: '#996a38', vein: 'rgba(58, 36, 16, 0.18)' },
    { base: '#b5784a', tip: '#8e5132', vein: 'rgba(54, 26, 14, 0.19)' },
    { base: '#a38a57', tip: '#7f663c', vein: 'rgba(48, 34, 16, 0.17)' },
    { base: '#b88a3c', tip: '#916429', vein: 'rgba(56, 36, 14, 0.18)' },
  ],
  petal: [
    { base: '#c87d55', tip: '#a15338', vein: 'rgba(58, 26, 16, 0.15)' },
    { base: '#d49b58', tip: '#ad7236', vein: 'rgba(62, 36, 16, 0.14)' },
    { base: '#b86348', tip: '#8f432f', vein: 'rgba(52, 22, 14, 0.16)' },
  ],
  osmanthus: [
    { base: '#e0a63b', tip: '#bd7c24', vein: 'rgba(68, 42, 12, 0.14)' },
    { base: '#d99230', tip: '#b36b1e', vein: 'rgba(64, 36, 12, 0.14)' },
    { base: '#e5b84b', tip: '#c48d2c', vein: 'rgba(70, 46, 14, 0.13)' },
  ],
  fleck: [
    { base: '#b2603c', tip: '#97452f', vein: 'rgba(52, 24, 14, 0.12)' },
    { base: '#c88a3a', tip: '#a66d29', vein: 'rgba(58, 36, 14, 0.12)' },
    { base: '#cfa14a', tip: '#ab7e32', vein: 'rgba(60, 40, 14, 0.12)' },
  ],
};

function createRng(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawMapleLeaf(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: { base: string; tip: string; vein: string }
) {
  const a = 0.5 * size;
  const lobes: [number, number][] = [
    [-202, 0.45],
    [-166, 0.68],
    [-128, 0.88],
    [-90, 1.0],
    [-52, 0.88],
    [-14, 0.68],
    [22, 0.45],
  ];
  const polar = (deg: number, r: number): [number, number] => [
    Math.cos((deg * Math.PI) / 180) * a * r,
    Math.sin((deg * Math.PI) / 180) * a * r,
  ];

  const grad = ctx.createLinearGradient(0, 0.25 * a, 0, -a);
  grad.addColorStop(0, palette.base);
  grad.addColorStop(1, palette.tip);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, 0.12 * a);
  lobes.forEach(([deg, len], idx) => {
    const prevMid = idx === 0 ? deg - 34 : (lobes[idx - 1][0] + deg) / 2;
    const nextMid = idx === lobes.length - 1 ? deg + 34 : (lobes[idx + 1][0] + deg) / 2;
    const valleyIn = polar(prevMid, 0.39);
    const tip = polar(deg, len);
    const bulge = polar(deg - 90, 0.14 * len);
    const valleyOut = polar(nextMid, 0.39);

    ctx.lineTo(valleyIn[0], valleyIn[1]);
    ctx.quadraticCurveTo(
      (valleyIn[0] + tip[0]) / 2 + bulge[0],
      (valleyIn[1] + tip[1]) / 2 + bulge[1],
      tip[0],
      tip[1]
    );
    ctx.quadraticCurveTo(
      (valleyOut[0] + tip[0]) / 2 - bulge[0],
      (valleyOut[1] + tip[1]) / 2 - bulge[1],
      valleyOut[0],
      valleyOut[1]
    );
  });
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = palette.vein;
  ctx.lineWidth = Math.max(0.45, size * 0.026);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [deg, len] of lobes) {
    const end = polar(deg, 0.82 * len);
    ctx.moveTo(0, 0.04 * a);
    ctx.lineTo(end[0], end[1]);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = palette.tip;
  ctx.lineWidth = Math.max(0.7, size * 0.034);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0.1 * a);
  ctx.quadraticCurveTo(0.03 * a, 0.36 * a, 0.1 * a, 0.58 * a);
  ctx.stroke();
  ctx.restore();
}

function drawGinkgoLeaf(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: { base: string; tip: string; vein: string }
) {
  const a = 0.54 * size;
  const grad = ctx.createLinearGradient(0, 0.1 * a, 0, -a);
  grad.addColorStop(0, palette.base);
  grad.addColorStop(0.78, palette.base);
  grad.addColorStop(1, palette.tip);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-0.34 * a, -0.2 * a, -0.88 * a, -0.62 * a);
  ctx.quadraticCurveTo(-0.58 * a, -1.04 * a, -0.07 * a, -0.96 * a);
  ctx.lineTo(0, -0.78 * a);
  ctx.lineTo(0.07 * a, -0.96 * a);
  ctx.quadraticCurveTo(0.58 * a, -1.04 * a, 0.88 * a, -0.62 * a);
  ctx.quadraticCurveTo(0.34 * a, -0.2 * a, 0, 0);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = palette.vein;
  ctx.lineWidth = Math.max(0.4, size * 0.022);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const rad = ((-150 + 15 * i) * Math.PI) / 180;
    ctx.moveTo(0, -0.04 * a);
    ctx.lineTo(Math.cos(rad) * a * 0.86, Math.sin(rad) * a * 0.86);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = palette.tip;
  ctx.lineWidth = Math.max(0.7, size * 0.036);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(0.02 * a, 0.24 * a, 0.06 * a, 0.46 * a);
  ctx.stroke();
  ctx.restore();
}

function drawWillowLeaf(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: { base: string; tip: string; vein: string }
) {
  const h = 0.54 * size;
  const w = 0.23 * size;
  const grad = ctx.createLinearGradient(0, h, 0, -h);
  grad.addColorStop(0, palette.base);
  grad.addColorStop(1, palette.tip);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  ctx.bezierCurveTo(-w * 1.15, h * 0.34, -w * 0.96, -h * 0.38, 0.08 * w, -h);
  ctx.bezierCurveTo(w * 0.92, -h * 0.32, w * 1.05, h * 0.36, 0, h * 0.78);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = palette.vein;
  ctx.lineWidth = Math.max(0.42, size * 0.024);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.76);
  ctx.quadraticCurveTo(-0.06 * w, 0, 0.06 * w, -h * 0.88);
  for (const t of [-0.35, -0.05, 0.25, 0.5]) {
    const y = h * t;
    const span = w * (1 - Math.abs(t) * 0.75) * 0.65;
    ctx.moveTo(0, y);
    ctx.lineTo(-span, y - span * 0.55);
    ctx.moveTo(0, y);
    ctx.lineTo(span, y - span * 0.5);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = palette.tip;
  ctx.lineWidth = Math.max(0.65, size * 0.032);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.76);
  ctx.quadraticCurveTo(0.08 * w, h * 0.94, 0.18 * w, h * 1.08);
  ctx.stroke();
  ctx.restore();
}

function drawAutumnPetal(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: { base: string; tip: string; vein: string }
) {
  const a = 0.35 * size;
  const r = 0.5 * size;
  const grad = ctx.createLinearGradient(0, r, 0, -r);
  grad.addColorStop(0, palette.tip);
  grad.addColorStop(0.45, palette.base);
  grad.addColorStop(1, palette.tip);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.bezierCurveTo(1.15 * a, 0.55 * r, 1.05 * a, -0.82 * r, 0.34 * a, -r);
  ctx.lineTo(0, -0.76 * r);
  ctx.lineTo(-0.34 * a, -r);
  ctx.bezierCurveTo(-1.05 * a, -0.82 * r, -1.15 * a, 0.55 * r, 0, r);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = palette.vein;
  ctx.lineWidth = Math.max(0.38, size * 0.022);
  ctx.beginPath();
  for (const offset of [-0.36, 0, 0.36]) {
    ctx.moveTo(0, 0.78 * r);
    ctx.quadraticCurveTo(offset * a, 0, offset * a * 0.7, -0.72 * r);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSukiFleck(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: { base: string; tip: string; vein: string },
  seed: number
) {
  const rng = createRng(seed);
  const r = 0.44 * size;
  const aspect = 0.56 + 0.36 * rng();
  ctx.fillStyle = palette.base;
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2;
    const rad = r * (0.64 + 0.46 * rng());
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad * aspect;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawOsmanthusCluster(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: { base: string; tip: string; vein: string },
  seed: number
) {
  const rng = createRng(seed);
  ctx.fillStyle = palette.base;
  ctx.save();
  ctx.rotate(rng() * Math.PI);
  for (let a = 0; a < 4; a++) {
    ctx.save();
    ctx.rotate((a * Math.PI) / 2);
    ctx.beginPath();
    ctx.ellipse(0, -0.14 * size, 0.11 * size, 0.155 * size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = palette.tip;
  ctx.beginPath();
  ctx.arc(0, 0, 0.055 * size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

type LeafPhase = 'perched' | 'detach' | 'falling';

interface SpriteEntry {
  canvas: HTMLCanvasElement;
  halfSize: number;
  baseRenderSize: number;
}

interface FallingLeafParticle {
  kind: LeafKind;
  spriteIndex: number;
  phase: LeafPhase;
  x: number;
  y: number;
  originX: number;
  originY: number;
  sizeFactor: number;
  depth: number;
  baseAlpha: number;
  vy: number;
  vxDrift: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  flutterFreq: number;
  flutterPhase: number;
  baseAngle: number;
  spinSpeed: number;
  bankAmp: number;
  flip: 1 | -1;
  releaseDelay: number;
  detachElapsed: number;
  elapsed: number;
  fadeInDuration: number;
  seed: number;
}

export default function PaperLeaves({active,paused}:{active:boolean;paused:boolean}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activity = useRef({active,paused});
  const syncPlayback = useRef<(() => void) | null>(null);
  useEffect(()=>{
    activity.current={active,paused};
    syncPlayback.current?.();
  },[active,paused]);

  useEffect(() => {
    try {
      document.documentElement.dataset.backgroundMotion =
        localStorage.getItem('pagewise:background-motion') === 'off' ? 'off' : 'on';
      const storedCount = localStorage.getItem('pagewise:leaf-count');
      const storedSize = localStorage.getItem('pagewise:leaf-size');
      document.documentElement.dataset.leafCount = String(
        storedCount != null ? clampLeafCount(storedCount) : DEFAULT_LEAF_COUNT
      );
      document.documentElement.dataset.leafSize = String(
        storedSize != null ? clampLeafSize(storedSize) : DEFAULT_LEAF_SIZE
      );
    } catch {}
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wideScreen = window.matchMedia('(min-width: 1024px)');
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let disposed = false;
    let isDark = document.documentElement.dataset.theme === 'dark';
    let motionOff =
      document.documentElement.dataset.backgroundMotion === 'off' || reducedMotionQuery.matches;
    let targetCount = clampLeafCount(
      document.documentElement.dataset.leafCount ??
        (() => {
          try {
            return localStorage.getItem('pagewise:leaf-count');
          } catch {
            return null;
          }
        })()
    );
    let avgLeafSize = clampLeafSize(
      document.documentElement.dataset.leafSize ??
        (() => {
          try {
            return localStorage.getItem('pagewise:leaf-size');
          } catch {
            return null;
          }
        })()
    );

    const spriteDefs: { kind: LeafKind; paletteIdx: number; seed: number }[] = [
      { kind: 'maple', paletteIdx: 0, seed: 101 },
      { kind: 'maple', paletteIdx: 1, seed: 102 },
      { kind: 'maple', paletteIdx: 2, seed: 103 },
      { kind: 'maple', paletteIdx: 3, seed: 104 },
      { kind: 'maple', paletteIdx: 4, seed: 105 },
      { kind: 'ginkgo', paletteIdx: 0, seed: 201 },
      { kind: 'ginkgo', paletteIdx: 1, seed: 202 },
      { kind: 'ginkgo', paletteIdx: 2, seed: 203 },
      { kind: 'ginkgo', paletteIdx: 3, seed: 204 },
      { kind: 'willow', paletteIdx: 0, seed: 301 },
      { kind: 'willow', paletteIdx: 1, seed: 302 },
      { kind: 'willow', paletteIdx: 2, seed: 303 },
      { kind: 'willow', paletteIdx: 3, seed: 304 },
      { kind: 'petal', paletteIdx: 0, seed: 401 },
      { kind: 'petal', paletteIdx: 1, seed: 402 },
      { kind: 'petal', paletteIdx: 2, seed: 403 },
      { kind: 'osmanthus', paletteIdx: 0, seed: 451 },
      { kind: 'osmanthus', paletteIdx: 1, seed: 452 },
      { kind: 'osmanthus', paletteIdx: 2, seed: 453 },
      { kind: 'fleck', paletteIdx: 0, seed: 501 },
      { kind: 'fleck', paletteIdx: 1, seed: 502 },
      { kind: 'fleck', paletteIdx: 2, seed: 503 },
    ];

    let sprites: SpriteEntry[] = [];
    const buildSprites = (scale: number) => {
      const baseRenderSize = 36;
      const box = 54;
      sprites = spriteDefs.map((def) => {
        const off = document.createElement('canvas');
        off.width = Math.round(box * scale);
        off.height = Math.round(box * scale);
        const octx = off.getContext('2d');
        if (octx) {
          octx.setTransform(scale, 0, 0, scale, (box * scale) / 2, (box * scale) / 2);
          const original = AUTUMN_PALETTES[def.kind][def.paletteIdx % AUTUMN_PALETTES[def.kind].length];
          const base = def.kind==='maple' ? (isDark?'#c28071':'#af6358') : (isDark?'#bc9750':'#c8a752');
          const tip = def.kind==='maple' ? (isDark?'#af705f':'#a4574d') : (isDark?'#a88744':'#bd9b48');
          const pal = {base,tip,vein:original.vein};
          if (def.kind === 'maple') drawMapleLeaf(octx, baseRenderSize, pal);
          else if (def.kind === 'ginkgo') drawGinkgoLeaf(octx, baseRenderSize, pal);
          else if (def.kind === 'willow') drawWillowLeaf(octx, baseRenderSize, pal);
          else if (def.kind === 'petal') drawAutumnPetal(octx, baseRenderSize, pal);
          else if (def.kind === 'osmanthus') drawOsmanthusCluster(octx, baseRenderSize * 0.72, pal, def.seed);
          else drawSukiFleck(octx, baseRenderSize * 0.55, pal, def.seed);
        }
        return { canvas: off, halfSize: box / 2, baseRenderSize };
      });
    };

    let particles: FallingLeafParticle[] = [];

    const createParticle = (
      index: number,
      rng: () => number,
      mode: 'initial' | 'recycle' | 'live-add'
    ): FallingLeafParticle => {
      const isFleck = index % 3 === 2;
      const leafRoll = rng();
      const kind: LeafKind = isFleck
        ? rng() < 0.45 ? 'osmanthus' : 'fleck'
        : leafRoll < 0.45
          ? 'maple'
          : leafRoll < 0.90
            ? 'ginkgo'
            : leafRoll < 0.95
              ? 'willow'
              : leafRoll < 0.98
                ? 'petal'
                : 'osmanthus';

      const matchingSprites: number[] = [];
      spriteDefs.forEach((d, idx) => {
        if (d.kind === kind) matchingSprites.push(idx);
      });
      const spriteIndex = matchingSprites[Math.floor(rng() * matchingSprites.length)];

      const depth = isFleck ? 0.15 + 0.35 * rng() : Math.pow(rng(), 1.15);
      const sizeFactor = isFleck
        ? 0.14 + 0.22 * rng()
        : kind === 'maple'
          ? 0.74 + depth * 1.13 + (rng() - 0.5) * 0.15
          : kind === 'ginkgo'
            ? 0.70 + depth * 1.06 + (rng() - 0.5) * 0.14
            : kind === 'willow'
              ? 0.74 + depth * 0.48 + (rng() - 0.5) * 0.14
              : kind === 'osmanthus'
                ? 0.54 + depth * 0.34
                : 0.64 + depth * 0.40;

      const baseAlpha = isFleck
        ? 0.10 + 0.09 * depth
        : 0.16 + 0.23 * depth;

      const vy = isFleck ? 14 + 13 * depth + 5 * rng() : 19 + 18 * depth + 7 * rng();
      const vxDrift = (rng() - 0.33) * (11 + 13 * depth);
      const swayAmp =
        isFleck ? 12 + 16 * rng() : 20 + 30 * (0.4 + 0.6 * depth) * (0.65 + 0.6 * rng());
      const swayFreq = 0.52 + 0.58 * rng();
      const swayPhase = rng() * Math.PI * 2;
      const flutterFreq = 0.85 + 1.15 * rng();
      const flutterPhase = rng() * Math.PI * 2;
      const baseAngle = (rng() - 0.5) * 1.1;
      const spinSpeed = (rng() - 0.5) * (isFleck ? 0.55 : 0.32);
      const bankAmp = 0.38 + 0.36 * rng();
      const flip: 1 | -1 = rng() < 0.5 ? 1 : -1;

      let xNorm = rng();
      if (!isFleck && rng() < 0.24) {
        xNorm = rng() < 0.5 ? 0.02 + 0.26 * rng() : 0.72 + 0.26 * rng();
      }
      const x = xNorm * Math.max(width, 320);
      const approxPx = sizeFactor * avgLeafSize;

      let phase: LeafPhase = 'falling';
      let y = -approxPx - 10 - rng() * 36;
      let releaseDelay = 0;
      let fadeInDuration = 1.2;

      if (mode === 'initial') {
        y = (0.03 + 0.87 * rng()) * height;
      } else if (mode === 'live-add') {
        if (rng() < 0.65) {
          y = (0.05 + 0.78 * rng()) * Math.max(height, 480);
          releaseDelay = rng() * 0.25;
          fadeInDuration = 0.55;
        } else {
          phase = 'perched';
          y = (0.04 + 0.42 * rng()) * Math.max(height, 480);
          releaseDelay = 0.4 + rng() * 3.2;
          fadeInDuration = 0.55;
        }
      } else {
        if (!isFleck && rng() < 0.22) {
          phase = 'perched';
          y = (0.03 + 0.28 * rng()) * Math.max(height, 480);
          releaseDelay = 0.8 + rng() * 2.6;
          fadeInDuration = 0.9;
        } else {
          releaseDelay = rng() * 0.5;
          y = -approxPx - 8 - rng() * 24;
        }
      }

      return {
        kind,
        spriteIndex,
        phase,
        x,
        y,
        originX: x,
        originY: y,
        sizeFactor,
        depth,
        baseAlpha,
        vy,
        vxDrift,
        swayAmp,
        swayFreq,
        swayPhase,
        flutterFreq,
        flutterPhase,
        baseAngle,
        spinSpeed,
        bankAmp,
        flip,
        releaseDelay,
        detachElapsed: 0,
        elapsed: mode === 'initial' ? fadeInDuration + rng() * 3 : 0,
        fadeInDuration,
        seed: Math.floor(rng() * 100000),
      };
    };

    const recycleRng = createRng(918273);

    const syncParticleCount = (desiredTotal: number, initial: boolean) => {
      if (initial) {
        const rng = createRng(20261122);
        particles = Array.from({ length: desiredTotal }, (_, i) => {
          let leaf = createParticle(i,rng,'initial');
          for(let attempt=0;attempt<6&&contentOpacity(leaf.x,leaf.y,avgLeafSize)<0.75;attempt++){
            leaf=createParticle(i,rng,'initial');
          }
          return leaf;
        });
        particles.sort((a, b) => a.depth - b.depth);
        return;
      }
      if (particles.length < desiredTotal) {
        const startLen = particles.length;
        for (let i = startLen; i < desiredTotal; i++) {
          particles.push(createParticle(i, recycleRng, 'live-add'));
        }
        particles.sort((a, b) => a.depth - b.depth);
      } else if (particles.length > desiredTotal) {
        const excess = particles.length - desiredTotal;
        for (let r = 0; r < excess; r++) {
          const removeIdx = Math.floor(((r + 0.5) / excess) * particles.length);
          particles.splice(Math.min(particles.length - 1, removeIdx), 1);
        }
      }
    };

    const initScene = () => {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.round(rect.width || window.innerWidth));
      const nextH = Math.max(1, Math.round(rect.height || window.innerHeight - 48));
      const nextDpr = Math.min(2, window.devicePixelRatio || 1);
      const firstInit = particles.length === 0;

      if (nextDpr !== dpr || sprites.length === 0) {
        dpr = nextDpr;
        buildSprites(dpr * 2);
      }

      width = nextW;
      height = nextH;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      if (firstInit) {
        measureBackground();
        syncParticleCount(targetCount, true);
      }
    };

    let clock = 0;
    let lastTime = performance.now();
    let targetSize = avgLeafSize;
    let protectedAreas: DOMRect[] = [];
    let canvasBounds: DOMRect;
    let dirtyLayout = true;
    let modalOpen = !!document.querySelector('dialog[open]');
    function allowDrawing(){
      return !disposed&&activity.current.active&&!activity.current.paused&&!modalOpen&&wideScreen.matches&&!motionOff&&document.visibilityState==='visible';
    }
    function refreshPlayback(){
      if(!allowDrawing()){
        window.cancelAnimationFrame(rafId);
        rafId=0;
        return;
      }
      if(rafId)return;
      if(!particles.length)initScene();
      dirtyLayout=true;
      lastTime=performance.now();
      rafId=window.requestAnimationFrame(renderFrame);
    }
    function contentOpacity(x:number,y:number,radius:number){
      const screenX=x+canvasBounds.left;
      const screenY=y+canvasBounds.top;
      const fade=radius+14;
      let opacity=1;
      for(const rect of protectedAreas){
        const dx=Math.max(rect.left-screenX,screenX-rect.right,0);
        const dy=Math.max(rect.top-screenY,screenY-rect.bottom,0);
        opacity=Math.min(opacity,Math.hypot(dx,dy)/fade);
        if(opacity===0)break;
      }
      return opacity;
    }

    function measureBackground(){
      if(!canvas)return;
      canvasBounds=canvas.getBoundingClientRect();
      const surface=canvas.closest('.workspace');
      protectedAreas=Array.from(surface?.querySelectorAll('.masthead button,.brand,.sh-sidebar,.sh-header,.sh-resume,.sh-material-row,.sh-empty-icon,.sh-empty h2,.sh-empty p,.sh-empty small,.sh-sample')??[])
        .map(element=>element.getBoundingClientRect())
        .filter(rect=>rect.width>0&&rect.height>0);
      dirtyLayout=false;
    }

    function renderFrame(now:number){
      rafId=0;
      if(!allowDrawing()||!canvas||!ctx)return;
      rafId = window.requestAnimationFrame(renderFrame);
      if(dirtyLayout)measureBackground();

      const dt = Math.min(0.064, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      clock += dt;
      avgLeafSize+=(targetSize-avgLeafSize)*Math.min(1,dt*8);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const globalBreeze =
        7.5 * Math.sin(clock * 0.21) +
        4.5 * Math.cos(clock * 0.09 + 1.2) +
        3.2 * Math.sin(clock * 0.43);
      const themeAlphaMul = isDark ? 0.85 : 1.0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const sprite = sprites[p.spriteIndex];
        const currentSize = p.sizeFactor * avgLeafSize;
        const baseSpriteSize = sprite ? sprite.baseRenderSize : 36;

        if (p.phase === 'perched') {
          p.elapsed += dt;
          p.releaseDelay -= dt;
          const fadeIn = Math.min(1, p.elapsed / p.fadeInDuration);
          const breathe = Math.sin(clock * 1.1 + p.swayPhase);
          const perchedAlpha = p.baseAlpha * 0.46 * themeAlphaMul * fadeIn * contentOpacity(p.x,p.y,currentSize/2);
          if (sprite && perchedAlpha > 0.008) {
            const renderScale = currentSize / baseSpriteSize;
            ctx.save();
            ctx.globalAlpha = perchedAlpha;
            ctx.translate(
              p.originX + breathe * 0.8,
              p.originY + Math.cos(clock * 0.9 + p.swayPhase) * 0.5
            );
            ctx.rotate(p.baseAngle + 0.03 * breathe);
            ctx.scale(renderScale * p.flip, renderScale);
            ctx.drawImage(
              sprite.canvas,
              -sprite.halfSize,
              -sprite.halfSize,
              sprite.halfSize * 2,
              sprite.halfSize * 2
            );
            ctx.restore();
          }
          if (p.releaseDelay <= 0) {
            p.phase = 'detach';
            p.detachElapsed = 0;
          }
          continue;
        }

        if (p.phase === 'detach') {
          p.detachElapsed += dt;
          const t = Math.min(1, p.detachElapsed / 0.9);
          const smoothT = t * t * (3 - 2 * t);
          const liftX = p.originX + 2.5 * Math.sin(t * Math.PI * 1.5 + p.swayPhase) * smoothT;
          const liftY = p.originY - 2.2 * Math.sin(t * Math.PI * 0.5);
          const liftAngle = p.baseAngle + 0.08 * Math.sin(t * Math.PI * 3);
          const liftScale = (currentSize / baseSpriteSize) * (1 + 0.06 * smoothT);
          const liftAlpha = p.baseAlpha * (0.46 + 0.54 * smoothT) * themeAlphaMul * contentOpacity(p.x,p.y,currentSize/2);

          if (sprite && liftAlpha > 0.008) {
            ctx.save();
            ctx.globalAlpha = liftAlpha;
            ctx.translate(liftX, liftY);
            ctx.rotate(liftAngle);
            ctx.scale(liftScale * p.flip, liftScale);
            ctx.drawImage(
              sprite.canvas,
              -sprite.halfSize,
              -sprite.halfSize,
              sprite.halfSize * 2,
              sprite.halfSize * 2
            );
            ctx.restore();
          }

          if (t >= 1) {
            p.phase = 'falling';
            p.x = liftX - p.swayAmp * Math.sin(p.swayPhase);
            p.y = liftY - (p.kind === 'fleck' ? 1.5 : 4.5) * Math.cos(p.swayPhase * 2);
            p.elapsed = p.fadeInDuration;
          }
          continue;
        }

        if (p.releaseDelay > 0) {
          p.releaseDelay -= dt;
          continue;
        }

        p.elapsed += dt;
        const swayT = p.elapsed * p.swayFreq + p.swayPhase;
        const flutterT = p.elapsed * p.flutterFreq + p.flutterPhase;

        const pendulumVel = Math.cos(swayT);
        const stallFactor = 0.66 + 0.34 * (0.5 + 0.5 * Math.sin(swayT * 2 - 0.4));
        const localGust =
          Math.sin(p.x * 0.0045 + p.y * 0.003 + clock * 0.36) * (6 + 7 * p.depth);

        p.y += p.vy * stallFactor * dt;
        p.x += (p.vxDrift + (globalBreeze + localGust) * (0.45 + 0.55 * p.depth)) * dt;

        const swayOffset =
          p.swayAmp * Math.sin(swayT) +
          p.swayAmp * 0.24 * Math.sin(swayT * 0.48 + p.seed);
        const bobOffset = (p.kind === 'fleck' ? 1.5 : 4.5) * Math.cos(swayT * 2);

        const drawX = p.x + swayOffset;
        const drawY = p.y + bobOffset;

        const fadeIn = Math.min(1, p.elapsed / p.fadeInDuration);
        const fadeInSmooth = fadeIn * fadeIn * (3 - 2 * fadeIn);
        const bottomProgress = Math.max(0, (drawY - height * 0.8) / (height * 0.22));
        const fadeOut = 1 - Math.min(1, bottomProgress * bottomProgress);
        const alpha = p.baseAlpha * themeAlphaMul * fadeInSmooth * fadeOut * contentOpacity(drawX,drawY,currentSize/2);

        if (alpha > 0.008 && sprite) {
          const angle =
            p.baseAngle +
            p.spinSpeed * p.elapsed +
            p.bankAmp * pendulumVel +
            0.14 * Math.sin(flutterT);

          const squashX =
            p.flip * (0.28 + 0.72 * Math.abs(Math.cos(flutterT * 0.75)));
          const squashY = 0.78 + 0.22 * Math.sin(flutterT * 0.65 + 0.8);
          const renderScale = currentSize / baseSpriteSize;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(drawX, drawY);
          ctx.rotate(angle);
          ctx.scale(renderScale * squashX, renderScale * squashY);
          ctx.drawImage(
            sprite.canvas,
            -sprite.halfSize,
            -sprite.halfSize,
            sprite.halfSize * 2,
            sprite.halfSize * 2
          );
          ctx.restore();
        }

        if (drawY > height + 36 || drawX < -140 || drawX > width + 140) {
          const recycled = createParticle(
            i,
            recycleRng,
            'recycle'
          );
          recycled.depth = p.depth;
          particles[i] = recycled;
        }
      }
    }

    const invalidateLayout=()=>{dirtyLayout=true;};
    const onResize = () => {if(particles.length&&wideScreen.matches)initScene();invalidateLayout();refreshPlayback();};
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll',invalidateLayout,true);
    document.addEventListener('visibilitychange',refreshPlayback);
    wideScreen.addEventListener('change',onResize);
    const layoutObserver=new ResizeObserver(invalidateLayout);
    const main=canvas.closest('.study-home')?.querySelector('.sh-main');
    if(main)layoutObserver.observe(main);
    const overlays=new MutationObserver(()=>{
      modalOpen=!!document.querySelector('dialog[open]');
      refreshPlayback();
    });
    overlays.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});

    const syncPreferences = () => {
      const nextDark=document.documentElement.dataset.theme==='dark';
      if(nextDark!==isDark){isDark=nextDark;if(sprites.length)buildSprites(dpr*2);}
      motionOff =
        document.documentElement.dataset.backgroundMotion === 'off' ||
        reducedMotionQuery.matches;
      const nextCount = clampLeafCount(document.documentElement.dataset.leafCount);
      const nextSize = clampLeafSize(document.documentElement.dataset.leafSize);
      targetSize = nextSize;
      if (nextCount !== targetCount) {
        targetCount = nextCount;
        if(particles.length)syncParticleCount(targetCount,false);
      }
      refreshPlayback();
    };

    const observer = new MutationObserver(() => {
      syncPreferences();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'data-theme',
        'data-background-motion',
        'data-leaf-count',
        'data-leaf-size',
      ],
    });

    const onMotionChange = syncPreferences;
    reducedMotionQuery.addEventListener('change', onMotionChange);
    syncPlayback.current=refreshPlayback;
    refreshPlayback();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll',invalidateLayout,true);
      document.removeEventListener('visibilitychange',refreshPlayback);
      wideScreen.removeEventListener('change',onResize);
      layoutObserver.disconnect();
      overlays.disconnect();
      syncPlayback.current=null;
      observer.disconnect();
      reducedMotionQuery.removeEventListener('change', onMotionChange);
    };
  }, []);

  return <div className="paper-leaves" hidden={!active} aria-hidden="true">
    <canvas ref={canvasRef} className="paper-leaves__canvas"/>
  </div>;
}
