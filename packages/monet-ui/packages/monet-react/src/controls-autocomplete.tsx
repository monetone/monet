// ─────────────────────────────────────────────────────────────
// Monet — Autocomplete (text input + suggestion listbox)
// ─────────────────────────────────────────────────────────────
// A drop-in for `<input list>` + `<datalist>`, whose suggestion popup is drawn
// by the OS. Renders a plain <input> (so app styling of the field is unchanged)
// plus Select's portalled `.monet-listbox` popup, following the WAI-ARIA
// combobox-with-listbox-autocomplete pattern:
//   • typing / focus open it when there are matches; ArrowDown/Up move the
//     active option; Enter picks the active option (and is NOT forwarded)
//   • Enter with no active option, and every other unhandled key, reach the
//     consumer's onKeyDown (so "commit on Enter" fields keep working)
//   • Escape closes (without reaching a host dialog); Tab / blur / a press
//     outside close; clicking an option picks it without blurring the input.

import {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cx } from "./internal";
import { useDismiss } from "./overlay-core";
import { useAnchoredListbox } from "./controls-select";

/** A suggestion: its `value` is what lands in the input; `label` is an optional
 *  secondary description shown beside it (like a datalist option's text). */
export type AutocompleteSuggestion = string | { value: string; label?: string };

export interface AutocompleteProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "list"> {
  /** Controlled text. */
  value: string;
  /** Fires on typing and when a suggestion is picked. */
  onChange: (value: string) => void;
  suggestions: AutocompleteSuggestion[];
}

export const Autocomplete = forwardRef<HTMLInputElement, AutocompleteProps>(function Autocomplete(
  { value, onChange, suggestions, id, onKeyDown, onFocus, onBlur, ...rest },
  forwardedRef,
) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const autoId = useId();
  const baseId = id ?? `monet-autocomplete-${autoId}`;
  const listId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  const matches = useMemo(() => {
    const q = value.toLowerCase();
    return suggestions
      .map((s) => (typeof s === "string" ? { value: s } : s))
      .filter((s) => s.value.toLowerCase().includes(q) || !!s.label?.toLowerCase().includes(q));
  }, [suggestions, value]);
  // Nothing to offer when there are no matches or the only one is already typed.
  const offer = matches.length > 0 && !(matches.length === 1 && matches[0]!.value === value);
  const shown = open && offer;
  // Clamp: a shrinking `suggestions` prop can strand the active index.
  const active = activeIdx < matches.length ? activeIdx : -1;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIdx(-1);
  }, []);
  const { listRef, setList, style: listStyle, portal } = useAnchoredListbox(inputRef, shown, close);
  useDismiss({ onDismiss: close, refs: [inputRef, listRef], enabled: shown, escapeKey: false });

  const pick = (i: number) => {
    const m = matches[i];
    if (m) onChange(m.value);
    close();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Leave keys to an IME that is still composing a candidate.
    if (!e.nativeEvent.isComposing) {
      const n = matches.length;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && offer) {
        e.preventDefault();
        e.stopPropagation();
        const down = e.key === "ArrowDown";
        setOpen(true);
        setActiveIdx(!shown || active < 0 ? (down ? 0 : n - 1) : (active + (down ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Enter" && shown && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(active);
        return;
      }
      if (e.key === "Escape" && shown) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab") close();
    }
    onKeyDown?.(e);
  };

  return (
    <>
      <input
        {...rest}
        ref={setRef}
        id={baseId}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          close();
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
      />
      {shown && portal(
          <ul
            ref={setList}
            id={listId}
            role="listbox"
            aria-label={rest["aria-label"]}
            tabIndex={-1}
            className="monet-listbox"
            style={listStyle}
            // Keep focus on the input (so its onBlur doesn't fire) while clicking.
            onMouseDown={(e) => e.preventDefault()}
          >
            {matches.map((m, i) => (
              <li
                key={m.value}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                data-value={m.value}
                className={cx("monet-option", i === active && "is-active")}
                onPointerMove={() => i !== active && setActiveIdx(i)}
                onClick={() => pick(i)}
              >
                <span className="monet-option-label">{m.value}</span>
                {m.label && m.label !== m.value && (
                  <span className="monet-option-detail">{m.label}</span>
                )}
              </li>
            ))}
          </ul>,
      )}
    </>
  );
});
