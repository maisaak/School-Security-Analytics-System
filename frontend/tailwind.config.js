/** @type {import('tailwindcss').Config} */

// Поверхности и текст берём из CSS-переменных, чтобы тема (тёмная / светлая /
// контрастная) переключалась мгновенно, без пересборки классов в JSX.
// Значения — тройки RGB, чтобы работали модификаторы прозрачности Tailwind
// (`bg-slate-900/80`, `border-emerald-500/25` и т.п.).
const slate = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const accent = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const scale = (prefix, keys) =>
  Object.fromEntries(keys.map((key) => [key, `rgb(var(--${prefix}-${key}) / <alpha-value>)`]));

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: scale("slate", slate),
        // Основной цвет интерфейса — выбирается в настройках (акцент).
        brand: scale("accent", accent),
        // Белый текст на цветных кнопках: в светлой теме не инвертируется.
        onaccent: "rgb(var(--on-accent) / <alpha-value>)",
        // «Чернила» поверх поверхностей: text-ink вместо text-white,
        // чтобы заголовки инвертировались вместе с фоном.
        ink: "rgb(var(--ink) / <alpha-value>)",
        white: "rgb(var(--white) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
