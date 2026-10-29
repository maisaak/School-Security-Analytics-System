import React from "react";
import { Check } from "lucide-react";

type Accent = "indigo" | "blue" | "emerald" | "violet" | "rose";

interface ColorWheelProps {
  value: Accent;
  onChange: (value: Accent) => void;
}

const colors: Array<{ value: Accent; label: string; color: string }> = [
  { value: "indigo", label: "Индиго", color: "#6366f1" },
  { value: "blue", label: "Синий", color: "#3b82f6" },
  { value: "emerald", label: "Изумрудный", color: "#10b981" },
  { value: "rose", label: "Розовый", color: "#f43f5e" },
  { value: "violet", label: "Фиолетовый", color: "#8b5cf6" },
];

export function ColorWheel({ value, onChange }: ColorWheelProps) {
  const selected = colors.find((color) => color.value === value) ?? colors[0];

  return (
    <div className="color-wheel-picker">
      <div className="color-wheel" role="radiogroup" aria-label="Акцентный цвет">
        {colors.map((color, index) => {
          const angle = index * (360 / colors.length) - 90;
          const radians = (angle * Math.PI) / 180;
          const x = 50 + Math.cos(radians) * 34;
          const y = 50 + Math.sin(radians) * 34;
          const active = color.value === value;
          return (
            <button
              type="button"
              role="radio"
              aria-label={color.label}
              aria-checked={active}
              key={color.value}
              className={`color-wheel-swatch ${active ? "is-selected" : ""}`}
              style={{ left: `${x}%`, top: `${y}%`, backgroundColor: color.color }}
              onClick={() => onChange(color.value)}
            >
              {active && <Check aria-hidden="true" />}
            </button>
          );
        })}
        <div className="color-wheel-center" style={{ borderColor: selected.color, color: selected.color }}>
          <span style={{ backgroundColor: selected.color }} />
          <strong>{selected.label}</strong>
        </div>
      </div>
      <div className="color-wheel-caption"><span>Выберите акцент интерфейса</span><b style={{ color: selected.color }}>{selected.label}</b></div>
    </div>
  );
}
