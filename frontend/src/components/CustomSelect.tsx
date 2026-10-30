import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

interface CustomSelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const expanded = open && !disabled;
  const selected = options.find((option) => option.value === value) ?? options[0];
  const focusOption = (index: number) => {
    const items = root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (items?.length) items[Math.max(0, Math.min(index, items.length - 1))].focus();
  };
  useEffect(() => {
    if (expanded) focusOption(Math.max(0, options.findIndex(option => option.value === value)));
  }, [expanded]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <div ref={root} className={`custom-select ${expanded ? "is-open" : ""} ${className}`} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!expanded) { setOpen(true); return; }
        const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        focusOption(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : current + (event.key === "ArrowDown" ? 1 : -1));
      }
    }}>
      <button
        ref={trigger}
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-value">
          <span>{selected?.label ?? "Выберите значение"}</span>
          {selected?.hint && <small>{selected.hint}</small>}
        </span>
        <ChevronDown className="custom-select-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div id={id} className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                role="option"
                 aria-selected={active}
                 tabIndex={-1}
                key={String(option.value)}
                className={`custom-select-option ${active ? "is-selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                   setOpen(false);
                   trigger.current?.focus();
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.hint && <small>{option.hint}</small>}
                </span>
                {active && <Check className="w-4 h-4" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
