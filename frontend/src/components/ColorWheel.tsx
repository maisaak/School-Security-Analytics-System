import React, { useEffect, useRef, useState } from "react";

function toHsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
function toHex(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0"); };
  return `#${f(5)}${f(3)}${f(1)}`;
}

export function ColorWheel({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const initial = /^#[0-9a-f]{6}$/i.test(value) ? value : "#6366f1";
  const [hsv, setHsv] = useState(() => toHsv(initial));
  const [hex, setHex] = useState(initial);
  const emitted = useRef(initial);
  useEffect(() => {
    if (/^#[0-9a-f]{6}$/i.test(value) && value !== emitted.current) { setHsv(toHsv(value)); setHex(value); emitted.current = value; }
  }, [value]);
  const update = (next: typeof hsv) => { setHsv(next); const color = toHex(next.h, next.s, next.v); setHex(color); emitted.current = color; onChange(color); };
  const pointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const h = (Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2) * 180 / Math.PI + 90 + 360) % 360;
    update({ ...hsv, h });
  };
  const color = toHex(hsv.h, hsv.s, hsv.v);
  return <div className="color-wheel-picker">
    <div className="interactive-wheel" role="slider" tabIndex={0} aria-label="Оттенок цвета" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hsv.h) % 360}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pointer(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pointer(e); }}
      onKeyDown={e => { if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(e.key)) { e.preventDefault(); update({ ...hsv, h: e.key === "Home" ? 0 : e.key === "End" ? 359 : (hsv.h + (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1) + 360) % 360 }); } }}>
      <div className="wheel-preview" style={{ background: color }} />
      <span className="wheel-marker" style={{ transform: `rotate(${hsv.h}deg) translateY(-69px)` }} />
    </div>
    <div className="wheel-controls">
      <label>Насыщенность <input className="modern-range" type="range" min={0} max={100} value={Math.round(hsv.s * 100)} onChange={e => update({ ...hsv, s: +e.target.value / 100 })} style={{ background: `linear-gradient(to right, #888, ${toHex(hsv.h, 1, 1)})` }} /></label>
      <label>Яркость <input className="modern-range" type="range" min={0} max={100} value={Math.round(hsv.v * 100)} onChange={e => update({ ...hsv, v: +e.target.value / 100 })} style={{ background: `linear-gradient(to right, #000, ${toHex(hsv.h, hsv.s, 1)})` }} /></label>
      <label>HEX-код <input className="custom-input" value={hex} aria-invalid={!/^#[0-9a-f]{6}$/i.test(hex)} maxLength={7} onChange={e => { const next = e.target.value; setHex(next); if (/^#[0-9a-f]{6}$/i.test(next)) { setHsv(toHsv(next)); emitted.current = next; onChange(next); } }} onBlur={() => setHex(color)} /></label>
    </div>
  </div>;
}
