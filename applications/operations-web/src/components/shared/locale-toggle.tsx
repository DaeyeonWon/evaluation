"use client";
/**
 * <LocaleToggle> — KO | EN segmented control.
 *
 *   <LocaleToggle />                          // place next to the theme toggle in the shell
 *   <LocaleToggle className="hide-sm" />
 *
 * - role="radiogroup" with roving tabindex: Tab focuses the active option; ←/→/↑/↓/Home/End move
 *   and select (WAI-ARIA radio group pattern). Each option has lang="ko"/"en" and its endonym as
 *   the accessible name ("한국어", "English"), so screen readers pronounce it correctly.
 * - Selecting writes the `console_locale` cookie and router.refresh()es (useSetLocale).
 * - Styling: ./locale-toggle.css (CSS variables --locale-toggle-*, zero-specificity :where()).
 *   Hooks: .locale-toggle, .locale-toggle-option, [aria-checked], [data-pending], [data-locale].
 */
import clsx from "clsx";
import { useRef, type KeyboardEvent } from "react";
import { useSetLocale, useT } from "@/i18n/client";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/locales";
import "./locale-toggle.css";

export interface LocaleToggleProps {
  className?: string;
  optionClassName?: string;
  /** override the group's accessible name (default: common.locale.group → "언어" / "Language") */
  ariaLabel?: string;
}

export function LocaleToggle({ className, optionClassName, ariaLabel }: LocaleToggleProps) {
  const { locale, setLocale, isPending } = useSetLocale();
  const t = useT("common");
  const refs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = LOCALES.indexOf(locale);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % LOCALES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + LOCALES.length) % LOCALES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = LOCALES.length - 1;
    if (next == null) return;
    e.preventDefault();
    const target = LOCALES[next];
    refs.current[target]?.focus();
    setLocale(target);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? t("locale.group")}
      className={clsx("locale-toggle", className)}
      data-locale={locale}
      data-pending={isPending || undefined}
      aria-busy={isPending || undefined}
      onKeyDown={move}
    >
      {LOCALES.map((l) => {
        const meta = LOCALE_META[l];
        const active = l === locale;
        return (
          <button
            key={l}
            ref={(el) => {
              refs.current[l] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            lang={meta.htmlLang}
            aria-label={meta.native}
            title={active ? meta.native : t("locale.switchTo", { language: meta.native })}
            className={clsx("locale-toggle-option", optionClassName)}
            data-active={active || undefined}
            onClick={() => setLocale(l)}
          >
            {meta.short}
          </button>
        );
      })}
    </div>
  );
}
