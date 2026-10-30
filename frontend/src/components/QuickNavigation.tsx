import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { AppTab } from "./Navbar";

interface Destination { id: AppTab; label: string }
interface Props { destinations: Destination[]; activeTab: AppTab; onSelect: (tab: AppTab) => void }

export function QuickNavigation({ destinations, activeTab, onSelect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const id = useId();
  const results = destinations.filter(item => item.label.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")));
  function open() {
    // Never stack a shortcut window over another active modal.
    if (document.querySelector("dialog[open], [aria-modal='true']")) return;
    setQuery("");
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyK" && !event.altKey && !event.isComposing) {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close(); else open();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return <>
    <button ref={trigger} type="button" className="quick-navigation-trigger" aria-haspopup="dialog" onClick={open}><Search size={17} aria-hidden="true" /><span>Найти раздел</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} className="quick-navigation-dialog" aria-labelledby={id} onClose={() => trigger.current?.focus()} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("[data-destination]") ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown") items[Math.min(index + 1, items.length - 1)]?.focus();
      else if (index <= 0) input.current?.focus(); else items[index - 1]?.focus();
    }}>
      <div className="quick-navigation-heading"><h2 id={id}>Быстрый переход</h2><button type="button" aria-label="Закрыть быстрый переход" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div>
      <label className="quick-navigation-search"><Search size={20} aria-hidden="true" /><input ref={input} type="search" aria-label="Поиск раздела" placeholder="Куда перейти?" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && results[0]) { event.preventDefault(); dialog.current?.close(); onSelect(results[0].id); } }} /></label>
      <nav aria-label="Результаты поиска разделов" className="quick-navigation-results">{results.map(item => <button data-destination type="button" key={item.id} onClick={() => { dialog.current?.close(); onSelect(item.id); }}><span>{item.label}</span>{item.id === activeTab ? <small>Вы здесь</small> : <ArrowUpRight size={17} aria-hidden="true" />}</button>)}{results.length === 0 && <p role="status">Раздел не найден. Попробуйте другое название.</p>}</nav>
      <footer>↑ ↓ выбор раздела <span>Enter — перейти</span><span>Esc — закрыть</span></footer>
    </dialog>
  </>;
}
