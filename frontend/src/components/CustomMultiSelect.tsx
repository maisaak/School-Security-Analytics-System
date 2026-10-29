import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface Option { value: string; label: string }

export function CustomMultiSelect({ value, options, onChange, disabled = false }: {
  value: string[];
  options: Option[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const expanded = open && !disabled;
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const selected = options.filter(option => value.includes(option.value));
  return <div ref={root} className={`custom-multi-select ${expanded ? "is-open" : ""}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="custom-select-trigger" aria-expanded={expanded} aria-controls={id} disabled={disabled} onClick={() => setOpen(current => !current)}>
      <span className="custom-select-value">
        <span>Разрешения роли · {selected.length} из {options.length}</span>
        <small>{selected.length ? selected.map(option => option.label).join(", ") : "Выберите нужные функции"}</small>
      </span>
      <ChevronDown className="custom-select-chevron" aria-hidden="true" />
    </button>
    {expanded && <fieldset id={id} className="custom-select-menu custom-multi-menu">
      <legend className="sr-only">Разрешения роли</legend>
      <div className="multi-select-actions">
        <button type="button" onClick={() => onChange(options.map(option => option.value))}>Выбрать всё</button>
        <button type="button" onClick={() => onChange([])}>Очистить</button>
      </div>
      {options.map(option => <label className={`multi-select-option ${value.includes(option.value) ? "is-selected" : ""}`} key={option.value}>
        <input className="custom-checkbox" type="checkbox" checked={value.includes(option.value)} onChange={event => onChange(event.target.checked ? [...value, option.value] : value.filter(item => item !== option.value))} />
        <span>{option.label}</span>
      </label>)}
    </fieldset>}
  </div>;
}
