"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./ink.module.css";
import { FENG_DATA, type InkCharacter, type InkPoint } from "./ink-data";

type DrawPoint = { x: number; y: number };
type Surface = "plain" | "grid" | "scroll";
type Mode = "write" | "trace";

type BrushSettings = {
  weight: number;
  wetness: number;
  speed: number;
  formality: number;
  seed: number;
};

const INITIAL_SETTINGS: BrushSettings = {
  weight: 0.61,
  wetness: 0.1,
  speed: 0.53,
  formality: 0.44,
  seed: 55,
};

const CANVAS_UNITS = 1000;
const GUIDE_MIN = 0;
const GUIDE_SIZE = 1000;
const GUIDE_MAX = GUIDE_MIN + GUIDE_SIZE;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: DrawPoint, b: DrawPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(path: InkPoint[]) {
  return path.slice(1).reduce((sum, point, index) => {
    return sum + Math.hypot(point[0] - path[index][0], point[1] - path[index][1]);
  }, 0);
}

function pointsAtLength(path: InkPoint[], visibleLength: number): DrawPoint[] {
  if (!path.length || visibleLength <= 0) return [];
  const points: DrawPoint[] = [{ x: path[0][0], y: path[0][1] }];
  let remaining = visibleLength;

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const segment = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    if (remaining >= segment) {
      points.push({ x: current[0], y: current[1] });
      remaining -= segment;
      continue;
    }
    const ratio = segment === 0 ? 1 : remaining / segment;
    points.push({
      x: previous[0] + (current[0] - previous[0]) * ratio,
      y: previous[1] + (current[1] - previous[1]) * ratio,
    });
    break;
  }

  return points.length > 1 ? points : [...points, { x: points[0].x + 0.1, y: points[0].y + 0.1 }];
}

function randomGenerator(seed: number) {
  let value = (seed >>> 0) || 1;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function drawPath(ctx: CanvasRenderingContext2D, path: DrawPoint[]) {
  if (path.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function drawBrushStroke(
  ctx: CanvasRenderingContext2D,
  path: DrawPoint[],
  settings: BrushSettings,
  strokeIndex: number,
  opacity = 1,
) {
  if (path.length < 2) return;

  const random = randomGenerator(settings.seed * 97 + strokeIndex * 9973);
  const baseWidth = 24 + settings.weight * 48;
  const speedWidth = 1.08 - settings.speed * 0.25;
  const spread = baseWidth * (0.52 + settings.wetness * 0.65);
  const jitter = (1 - settings.formality) * 8;
  const fibers = 22 + Math.round(settings.weight * 24);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let fiber = 0; fiber < fibers; fiber += 1) {
    const offset = (fiber / Math.max(1, fibers - 1) - 0.5) * spread;
    const fiberPath: DrawPoint[] = [];

    path.forEach((point, index) => {
      const previous = path[Math.max(0, index - 1)];
      const next = path[Math.min(path.length - 1, index + 1)];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy) || 1;
      const normalX = -dy / length;
      const normalY = dx / length;
      const localJitter = (random() - 0.5) * jitter;
      const taper = Math.sin((index / (path.length - 1)) * Math.PI) * 0.45 + 0.55;
      fiberPath.push({
        x: point.x + normalX * (offset * taper + localJitter),
        y: point.y + normalY * (offset * taper + localJitter),
      });
    });

    ctx.strokeStyle = `rgba(31, 28, 23, ${(0.18 + settings.wetness * 0.05) * opacity})`;
    ctx.lineWidth = Math.max(0.8, baseWidth * (0.022 + random() * 0.06) * speedWidth);
    drawPath(ctx, fiberPath);
  }

  // A translucent body keeps the fibers reading as one loaded brush.
  ctx.strokeStyle = `rgba(30, 27, 22, ${0.39 * opacity})`;
  ctx.lineWidth = baseWidth * (0.28 + settings.wetness * 0.1) * speedWidth;
  drawPath(ctx, path);
  ctx.strokeStyle = `rgba(30, 27, 22, ${0.22 * opacity})`;
  ctx.lineWidth = baseWidth * (0.5 + settings.wetness * 0.08) * speedWidth;
  drawPath(ctx, path);

  // Pooling at the ends sells the slow, wet ink effect.
  const endRadius = baseWidth * (0.18 + settings.wetness * 0.16);
  ctx.fillStyle = `rgba(29, 26, 21, ${0.52 * opacity})`;
  for (const point of [path[0], path[path.length - 1]]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, endRadius * (0.76 + random() * 0.34), 0, Math.PI * 2);
    ctx.fill();
  }

  // Dry bristles split at the terminal point.
  const terminal = path[path.length - 1];
  const beforeTerminal = path[path.length - 2];
  const dx = terminal.x - beforeTerminal.x;
  const dy = terminal.y - beforeTerminal.y;
  const terminalLength = Math.hypot(dx, dy) || 1;
  for (let index = 0; index < 10; index += 1) {
    const spreadAngle = (random() - 0.5) * (0.35 + (1 - settings.wetness) * 0.8);
    const angle = Math.atan2(dy, dx) + spreadAngle;
    const length = baseWidth * (0.25 + random() * (0.25 + (1 - settings.wetness) * 0.45));
    ctx.beginPath();
    ctx.moveTo(terminal.x, terminal.y);
    ctx.lineTo(
      terminal.x + (dx / terminalLength) * length * Math.cos(angle),
      terminal.y + (dy / terminalLength) * length * Math.sin(angle),
    );
    ctx.strokeStyle = `rgba(50, 44, 35, ${(0.015 + (1 - settings.wetness) * 0.03) * opacity})`;
    ctx.lineWidth = 0.8 + random() * 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

function parseCharacterData(value: unknown): InkCharacter | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { strokes?: unknown; medians?: unknown };
  if (!Array.isArray(candidate.strokes) || !Array.isArray(candidate.medians)) return null;
  if (!candidate.strokes.every((stroke) => typeof stroke === "string")) return null;
  if (!candidate.medians.every((median) => Array.isArray(median))) return null;
  return {
    character: "",
    strokes: candidate.strokes,
    medians: candidate.medians as InkPoint[][],
  };
}

function scorePath(actual: DrawPoint[], expected: InkPoint[]) {
  if (actual.length < 2 || expected.length < 2) return null;
  const expectedPoints = expected.map(([x, y]) => ({ x, y }));
  const averageDistance = actual.reduce((sum, point) => {
    return sum + Math.min(...expectedPoints.map((expectedPoint) => distance(point, expectedPoint)));
  }, 0) / actual.length;
  const expectedLength = pathLength(expected);
  const actualLength = actual.slice(1).reduce((sum, point, index) => sum + distance(point, actual[index]), 0);
  const lengthRatio = Math.min(actualLength, expectedLength) / Math.max(actualLength, expectedLength);
  return Math.round(clamp(1 - averageDistance / 85, 0, 1) * lengthRatio * 100);
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display: string;
}) {
  return (
    <label className={styles.rangeControl}>
      <span>{label}</span>
      <output>{display}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function InkPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePathRef = useRef<DrawPoint[] | null>(null);
  const [character, setCharacter] = useState("風");
  const [draftCharacter, setDraftCharacter] = useState("風");
  const [data, setData] = useState<InkCharacter>(FENG_DATA);
  const [settings, setSettings] = useState<BrushSettings>(INITIAL_SETTINGS);
  const [surface, setSurface] = useState<Surface>("grid");
  const [mode, setMode] = useState<Mode>("write");
  const [teach, setTeach] = useState(true);
  const [showInput, setShowInput] = useState(false);
  const [loadingCharacter, setLoadingCharacter] = useState(false);
  const [status, setStatus] = useState("written in a different stroke order · show me");
  const [manualStrokes, setManualStrokes] = useState<DrawPoint[][]>([]);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [revealedLength, setRevealedLength] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [replayKey, setReplayKey] = useState(0);

  const strokeLengths = useMemo(() => data.medians.map(pathLength), [data]);
  const totalLength = useMemo(() => strokeLengths.reduce((sum, length) => sum + length, 0), [strokeLengths]);

  const updateSetting = useCallback(<K extends keyof BrushSettings>(key: K, value: BrushSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const replay = useCallback((clearManual = false) => {
    if (clearManual) {
      setManualStrokes([]);
      setAccuracy(null);
    }
    setRevealedLength(0);
    setPlaying(true);
    setReplayKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!playing || totalLength <= 0) return undefined;
    let frame = 0;
    const startedAt = performance.now();
    const duration = 5600 / (0.7 + settings.speed * 0.7);
    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / duration);
      setRevealedLength(totalLength * progress);
      if (progress >= 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalLength, settings.speed, replayKey]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f4f1e7";
    ctx.fillRect(0, 0, width, height);

    const board = Math.min(width, height);
    const offsetX = (width - board) / 2;
    const offsetY = (height - board) / 2;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    // Hanzi Writer coordinates use a bottom-left origin; Canvas uses a
    // top-left origin. Keep all stroke data in its source coordinate system
    // and flip the drawing space once here.
    ctx.scale(board / CANVAS_UNITS, -board / CANVAS_UNITS);
    ctx.translate(0, -CANVAS_UNITS);

    if (surface === "scroll") {
      ctx.strokeStyle = "rgba(145, 128, 95, .07)";
      ctx.lineWidth = 1;
      for (let line = 90; line < 920; line += 20) {
        ctx.beginPath();
        ctx.moveTo(65, line);
        ctx.lineTo(935, line + Math.sin(line) * 3);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(93, 83, 65, .16)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(GUIDE_MIN, GUIDE_MIN, GUIDE_SIZE, GUIDE_SIZE);
    if (surface === "grid") {
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = "rgba(169, 108, 101, .44)";
      ctx.beginPath();
      ctx.moveTo(500, GUIDE_MIN);
      ctx.lineTo(500, GUIDE_MAX);
      ctx.moveTo(GUIDE_MIN, 500);
      ctx.lineTo(GUIDE_MAX, 500);
      ctx.moveTo(GUIDE_MIN, GUIDE_MIN);
      ctx.lineTo(GUIDE_MAX, GUIDE_MAX);
      ctx.moveTo(GUIDE_MAX, GUIDE_MIN);
      ctx.lineTo(GUIDE_MIN, GUIDE_MAX);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (mode === "trace") {
      ctx.save();
      ctx.strokeStyle = "rgba(174, 105, 97, .45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      data.strokes.forEach((stroke) => ctx.stroke(new Path2D(stroke)));
      ctx.restore();
    }

    let consumed = 0;
    data.medians.forEach((median, index) => {
      const available = revealedLength - consumed;
      const visible = pointsAtLength(median, available);
      if (visible.length > 1) {
        drawBrushStroke(ctx, visible, settings, index, mode === "trace" ? 0.52 : 1);
      }
      if (teach && available > 0) {
        const start = median[0];
        // Text should remain upright even though the drawing space is flipped.
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "rgba(167, 94, 88, .84)";
        ctx.font = "22px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(
          String(index + 1),
          offsetX + (start[0] - 18) * (board / CANVAS_UNITS),
          offsetY + (CANVAS_UNITS - (start[1] - 18)) * (board / CANVAS_UNITS),
        );
        ctx.restore();
      }
      consumed += strokeLengths[index] ?? 0;
    });

    for (const [index, manualStroke] of manualStrokes.entries()) {
      drawBrushStroke(ctx, manualStroke, settings, index + data.medians.length, 0.95);
    }

    ctx.restore();
  }, [data, manualStrokes, mode, revealedLength, settings, strokeLengths, surface, teach]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => drawCanvas());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawCanvas]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): DrawPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const board = Math.min(rect.width, rect.height);
    const offsetX = (rect.width - board) / 2;
    const offsetY = (rect.height - board) / 2;
    const x = ((event.clientX - rect.left - offsetX) / board) * CANVAS_UNITS;
    const y = CANVAS_UNITS - ((event.clientY - rect.top - offsetY) / board) * CANVAS_UNITS;
    if (x < GUIDE_MIN || x > GUIDE_MIN + GUIDE_SIZE || y < GUIDE_MIN || y > GUIDE_MIN + GUIDE_SIZE) return null;
    return { x, y };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePathRef.current = [point];
    setPlaying(false);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const activePath = activePathRef.current;
    const point = pointFromEvent(event);
    if (!activePath || !point) return;
    if (distance(activePath[activePath.length - 1], point) > 3) {
      activePath.push(point);
      drawCanvas();
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const activePath = activePathRef.current;
    activePathRef.current = null;
    if (!activePath || activePath.length < 2) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
    const nextStroke = data.medians[Math.min(manualStrokes.length, data.medians.length - 1)];
    setManualStrokes((strokes) => [...strokes, activePath]);
    if (nextStroke) setAccuracy(scorePath(activePath, nextStroke));
  };

  const loadCharacter = async () => {
    const nextCharacter = [...draftCharacter.trim()][0];
    if (!nextCharacter) return;
    setLoadingCharacter(true);
    setStatus("loading character geometry · please wait");
    try {
      const nextData = nextCharacter === FENG_DATA.character
        ? FENG_DATA
        : parseCharacterData(
            await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(nextCharacter)}.json`).then((response) => {
              if (!response.ok) throw new Error("character not found");
              return response.json();
            }),
          );
      if (!nextData) throw new Error("character data unavailable");
      nextData.character = nextCharacter;
      setCharacter(nextCharacter);
      setData(nextData);
      setManualStrokes([]);
      setAccuracy(null);
      setRevealedLength(0);
      setPlaying(true);
      setReplayKey((key) => key + 1);
      setShowInput(false);
      setStatus("written in a different stroke order · show me");
    } catch {
      setStatus("character not found · try another hanzi");
    } finally {
      setLoadingCharacter(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleLockup}>
          <span className={styles.titleGlyph}>墨</span>
          <h1>Ink Ritual</h1>
        </div>
        <p className={styles.headerNote}>a small study in Chinese brushwork</p>
      </header>

      <section className={styles.workspace}>
        <div className={styles.canvasColumn}>
          <div className={styles.canvasFrame}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              aria-label="Chinese ink canvas"
            />
          </div>
          <div className={styles.canvasFooter}>
            <div className={styles.footerActions}>
              <button type="button" onClick={() => replay(false)}>undo</button>
              <button type="button" onClick={() => replay(true)}>clear</button>
            </div>
            <span className={styles.strokeCount}>{data.medians.length}</span>
            <p>{status} · <button type="button" onClick={() => replay(false)}>show me</button></p>
          </div>
          {showInput ? (
            <form
              className={styles.characterForm}
              onSubmit={(event) => {
                event.preventDefault();
                void loadCharacter();
              }}
            >
              <input
                autoFocus
                value={draftCharacter}
                onChange={(event) => setDraftCharacter(event.target.value)}
                maxLength={2}
                aria-label="输入汉字"
                placeholder="輸入漢字"
              />
              <button type="submit" disabled={loadingCharacter}>{loadingCharacter ? "…" : "draw"}</button>
            </form>
          ) : (
            <button type="button" className={styles.typeButton} onClick={() => setShowInput(true)}>
              {character === "風" ? "或輸入漢字" : character} <span>· or type</span>
            </button>
          )}
        </div>

        <aside className={styles.controls}>
          <div className={styles.controlHeading}>
            <span className={styles.controlGlyph}>墨</span>
            <span>ink</span>
          </div>
          <div className={styles.rule} />

          <RangeControl label="weight" value={settings.weight} min={0.1} max={1} step={0.01} display={settings.weight.toFixed(2)} onChange={(value) => updateSetting("weight", value)} />
          <RangeControl label="wetness" value={settings.wetness} min={0} max={1} step={0.01} display={settings.wetness.toFixed(2)} onChange={(value) => updateSetting("wetness", value)} />
          <RangeControl label="speed" value={settings.speed} min={0.1} max={1} step={0.01} display={settings.speed.toFixed(2)} onChange={(value) => updateSetting("speed", value)} />
          <RangeControl label="formality" value={settings.formality} min={0} max={1} step={0.01} display={settings.formality.toFixed(2)} onChange={(value) => updateSetting("formality", value)} />
          <RangeControl label="seed" value={settings.seed} min={1} max={100} step={1} display={String(Math.round(settings.seed))} onChange={(value) => updateSetting("seed", value)} />

          <div className={styles.controlGroup}>
            <div className={styles.groupLabel}><span>紙</span> surface</div>
            <div className={styles.segmented}>
              {(["plain", "grid", "scroll"] as Surface[]).map((option) => (
                <button key={option} type="button" className={surface === option ? styles.active : ""} onClick={() => setSurface(option)}>{option}</button>
              ))}
            </div>
          </div>

          <div className={styles.controlGroup}>
            <div className={styles.groupLabel}>mode</div>
            <div className={styles.segmented}>
              {(["write", "trace"] as Mode[]).map((option) => (
                <button key={option} type="button" className={mode === option ? styles.active : ""} onClick={() => setMode(option)}>{option}</button>
              ))}
            </div>
          </div>

          <div className={styles.controlGroup}>
            <div className={styles.groupLabel}><span>習</span> teach</div>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={teach} onChange={(event) => setTeach(event.target.checked)} />
              <span>stroke order</span>
            </label>
            {accuracy !== null && <div className={styles.accuracy}>last stroke <strong>{accuracy}%</strong></div>}
          </div>

          <button type="button" className={styles.replayButton} onClick={() => replay(false)}>{playing ? "writing…" : "write again"}</button>
        </aside>
      </section>
    </main>
  );
}
