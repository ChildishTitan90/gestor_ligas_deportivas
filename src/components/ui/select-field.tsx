"use client";

import { useEffect, useId, useRef, useState, type AriaAttributes, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption = { value: string; label: string; description?: string; disabled?: boolean };
type Position = { left: number; width: number; edge: number; maxHeight: number; above: boolean };
type Props = Pick<AriaAttributes, "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  id?: string;
  name?: string;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  icon?: ReactNode;
  searchable?: boolean;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

/** Selección cerrada: buscar no envía texto libre ni cambia el valor confirmado. */
export function SelectField({ id: suppliedId, name, options, value, defaultValue = "", onValueChange,
  disabled = false, required = false, placeholder = "Selecciona una opción", searchPlaceholder = "Buscar opción…",
  className = "", icon, searchable = true, ...aria }: Props) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const listId = `${id}-options`;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(defaultValue);
  const [position, setPosition] = useState<Position | null>(null);
  const [popupContainer, setPopupContainer] = useState<Element | null>(null);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const selected = options.find(option => option.value === (value ?? localValue));
  const submittedValue = selected && !selected.disabled ? selected.value : "";
  const open = position !== null && !disabled;
  if (disabled && position !== null) setPosition(null);
  const search = normalize(query);
  const filtered = options.filter(option => normalize(`${option.label} ${option.description ?? ""}`).includes(search));
  const enabled = filtered.filter(option => !option.disabled);
  const active = enabled.find(option => option.value === activeValue) ?? enabled.find(option => option.value === submittedValue) ?? enabled[0];
  const optionId = (option: SelectOption) => `${listId}-${options.indexOf(option)}`;
  const activeId = active ? optionId(active) : undefined;

  function measure(): Position | null {
    if (!root.current) return null;
    const rect = root.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const availableBelow = bottom - rect.bottom - 12;
    const availableAbove = rect.top - top - 12;
    const above = availableBelow < 240 && availableAbove > availableBelow;
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    return { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width,
      edge: above ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
      maxHeight: Math.max(40, Math.min(320, above ? availableAbove : availableBelow)), above };
  }
  function show(initialQuery = "", last = false) {
    if (disabled || input.current?.matches(":disabled")) return;
    setQuery(initialQuery);
    setPopupContainer(root.current?.closest("dialog, [role='dialog']") ?? document.body);
    setActiveValue(last ? options.filter(option => !option.disabled).at(-1)?.value ?? null : submittedValue);
    setPosition(measure());
  }
  function choose(option: SelectOption) {
    if (disabled || option.disabled || input.current?.matches(":disabled")) return;
    if (value === undefined) setLocalValue(option.value);
    onValueChange?.(option.value);
    setPosition(null);
    setQuery("");
    input.current?.focus();
  }

  useEffect(() => {
    input.current?.setCustomValidity(required && !submittedValue ? "Selecciona una opción de la lista." : "");
  }, [required, submittedValue]);

  useEffect(() => {
    const form = input.current?.form;
    function reset() {
      if (value === undefined) setLocalValue(defaultValue);
      setPosition(null); setQuery("");
    }
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [value, defaultValue]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target;
      if (target instanceof Node && !root.current?.contains(target) && !popup.current?.contains(target)) setPosition(null);
    }
    function reposition(event?: Event) {
      if (event?.target instanceof Node && popup.current?.contains(event.target)) return;
      setPosition(input.current?.matches(":disabled") ? null : measure());
    }
    const observer = new MutationObserver(() => { if (input.current?.matches(":disabled")) setPosition(null); });
    for (let parent = root.current?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLFieldSetElement) observer.observe(parent, { attributes: true, attributeFilter: ["disabled"] });
    }
    const resize = new ResizeObserver(() => reposition());
    if (root.current) resize.observe(root.current);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect(); resize.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !activeId) return;
    const node = document.getElementById(activeId);
    // Desplazar solo la lista; scrollIntoView también podría mover el formulario.
    if (node && popup.current) {
      const list = popup.current;
      if (node.offsetTop < list.scrollTop) list.scrollTop = node.offsetTop;
      else if (node.offsetTop + node.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = node.offsetTop + node.offsetHeight - list.clientHeight;
    }
  }, [open, activeId]);

  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setPosition(null); return; }
    if (event.key === "Tab") { setPosition(null); return; }
    if (event.altKey && event.key === "ArrowUp") { event.preventDefault(); setPosition(null); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show("", event.key === "ArrowUp");
      else {
        const index = enabled.findIndex(option => option.value === active?.value);
        setActiveValue(enabled[Math.max(0, Math.min(enabled.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.value ?? null);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!open) show(); else if (active) choose(active);
      return;
    }
    if (!searchable && event.key === " ") {
      event.preventDefault();
      if (!open) show(); else if (active) choose(active);
      return;
    }
    // Con texto escrito, Home/End siguen editando el texto como espera el navegador.
    if (open && !query && (event.key === "Home" || event.key === "End")) {
      event.preventDefault(); setActiveValue((event.key === "Home" ? enabled[0] : enabled.at(-1))?.value ?? null); return;
    }
    if (searchable && !open && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault(); show(event.key.length === 1 ? event.key : "");
    }
  }

  return <div ref={root} className={`select-field relative w-full min-w-0 ${className}`} data-open={open} data-has-icon={(open && searchable) || !!icon}>
    {name && <input type="hidden" name={name} value={submittedValue} disabled={disabled} data-select-input-id={id} />}
    {((open && searchable) || icon) && <span aria-hidden="true" className="select-search-icon pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">{open && searchable ? <Search size={18} /> : icon}</span>}
    <input {...aria} ref={input} id={id} type="text" role="combobox" aria-autocomplete={searchable ? "list" : "none"} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && active ? optionId(active) : undefined}
      aria-required={required || undefined} autoComplete="off" spellCheck={false} disabled={disabled}
      data-select-field={name}
      className={`select-input min-h-12 w-full min-w-0 cursor-pointer rounded-xl border border-border bg-surface py-3 pr-12 text-base text-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 ${((open && searchable) || icon) ? "pl-10" : "pl-3.5"}`}
      aria-readonly={!searchable || undefined} value={open && searchable ? query : selected?.label ?? ""}
      placeholder={open ? searchPlaceholder : placeholder}
      onClick={() => { if (!open) show(); }} onKeyDown={keydown}
      onBeforeInput={event => { if (!searchable) event.preventDefault(); }}
      onChange={event => { if (!searchable) return; if (!open) show(event.target.value); else { setQuery(event.target.value); setActiveValue(null); } }}
      onPaste={event => { if (!searchable) event.preventDefault(); else if (!open) { event.preventDefault(); show(event.clipboardData.getData("text")); } }}
      onInvalid={() => { input.current?.focus(); show(); }} />
    <button type="button" tabIndex={-1} aria-hidden="true" disabled={disabled} className="select-arrow absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-muted disabled:opacity-50"
      onMouseDown={event => event.preventDefault()} onClick={() => { if (open) setPosition(null); else show(); input.current?.focus(); }}>
      <ChevronDown size={18} />
    </button>
    {open && popupContainer && createPortal(<div ref={popup} id={listId} role="listbox"
      aria-label={aria["aria-label"] ? `Opciones: ${aria["aria-label"]}` : "Opciones disponibles"}
      aria-labelledby={aria["aria-labelledby"]} className="select-popup overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-foreground shadow-sm"
      style={{ position: "fixed", zIndex: 70, left: position.left, width: position.width, maxHeight: position.maxHeight,
        ...(position.above ? { bottom: position.edge } : { top: position.edge }) }}>
      {filtered.map(option => <div key={option.value} id={optionId(option)} role="option"
        aria-selected={option.value === submittedValue} aria-disabled={option.disabled || undefined}
        data-active={option.value === active?.value} data-value={option.value}
        style={option.value === active?.value || option.value === submittedValue
          ? { backgroundColor: "color-mix(in srgb, var(--accent) 16%, var(--surface))", borderLeftColor: "var(--accent)", color: "var(--primary)" } : undefined}
        className={`select-option relative flex min-h-11 items-center gap-3 rounded-lg border-l-4 px-3 py-3 text-sm ${option.value === submittedValue ? "border-accent" : "border-transparent"} ${option.value === active?.value || option.value === submittedValue ? "bg-soft text-primary" : "text-foreground"} ${option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        onMouseDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }}
        onClick={() => choose(option)}>
        <span className="select-option-label min-w-0 flex-1 wrap-break-word">{option.label}</span>
        {option.description && <span className="select-option-description shrink-0 text-xs text-muted">{option.description}</span>}
        {option.value === submittedValue && <Check size={17} aria-hidden="true" className="select-option-check shrink-0 text-accent" />}
      </div>)}
      {!filtered.length && <p role="status" className="select-empty">No hay opciones que coincidan con tu búsqueda.</p>}
    </div>, popupContainer)}
  </div>;
}
