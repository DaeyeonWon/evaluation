"use client";
/**
 * Theme: preference ("system" | "light" | "dark") persisted in localStorage("aipo.theme");
 * the RESOLVED theme is written to <html data-theme="light|dark"> (+ color-scheme).
 * <ThemeScript/> (in the root layout <head>) applies it before first paint — no flash.
 *
 *   const { preference, resolved, setPreference, toggle } = useTheme();
 *   <ThemeToggle className="..." />            // icon button light ⇄ dark
 *   <ThemeSelect className="..." />            // segmented: 시스템 / 라이트 / 다크  (System / Light / Dark)
 *
 * Labels come from the i18n `common.theme.*` messages (useT("common")).
 *
 * Styling hooks (design-neutral): every control renders data-theme-control / aria-pressed /
 * data-active attributes and accepts className; there is no built-in visual style.
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import clsx from "clsx";
import { useT } from "@/i18n/client";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const KEY = "aipo.theme";
const prefListeners = new Set<() => void>();
let prefCache: ThemePreference | null = null;

function readPref(): ThemePreference {
  if (prefCache) return prefCache;
  try {
    const v = window.localStorage.getItem(KEY);
    prefCache = v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    prefCache = "system";
  }
  return prefCache;
}

function subscribePref(cb: () => void) {
  prefListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      prefCache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeSystem(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function setThemePreference(p: ThemePreference) {
  prefCache = p;
  try {
    window.localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
  prefListeners.forEach((l) => l());
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribePref, readPref, () => "system" as ThemePreference);
  const isSystemDark = useSyncExternalStore(subscribeSystem, systemDark, () => false);
  const resolved: ResolvedTheme = preference === "system" ? (isSystemDark ? "dark" : "light") : preference;
  return {
    preference,
    resolved,
    setPreference: setThemePreference,
    toggle: () => setThemePreference(resolved === "dark" ? "light" : "dark"),
  };
}

/** Keeps <html data-theme> in sync with the preference + OS setting. Mounted once in the root layout. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { resolved, preference } = useTheme();
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = resolved;
    el.dataset.themePref = preference;
    el.style.colorScheme = resolved;
  }, [resolved, preference]);
  return <>{children}</>;
}

/** Inline, render-blocking script for <head>: sets data-theme before paint. */
export function ThemeScript() {
  const code = `(function(){try{var p=localStorage.getItem('${KEY}');if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.dataset.theme=d?'dark':'light';e.dataset.themePref=p;e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export function ThemeToggle({ className, iconSize = 16, title }: { className?: string; iconSize?: number; title?: string }) {
  const { resolved, toggle } = useTheme();
  const t = useT("common");
  const label = title ?? (resolved === "dark" ? t("theme.switchToLight") : t("theme.switchToDark"));
  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      data-theme-control="toggle"
      data-resolved={resolved}
      aria-label={label}
      title={label}
      suppressHydrationWarning
    >
      {resolved === "dark" ? <Sun size={iconSize} aria-hidden /> : <Moon size={iconSize} aria-hidden />}
    </button>
  );
}

const OPTIONS: { value: ThemePreference; key: "theme.system" | "theme.light" | "theme.dark"; Icon: typeof Sun }[] = [
  { value: "system", key: "theme.system", Icon: Monitor },
  { value: "light", key: "theme.light", Icon: Sun },
  { value: "dark", key: "theme.dark", Icon: Moon },
];

export function ThemeSelect({
  className,
  itemClassName,
  showLabels = true,
  iconSize = 14,
}: {
  className?: string;
  itemClassName?: string;
  showLabels?: boolean;
  iconSize?: number;
}) {
  const { preference, setPreference } = useTheme();
  const t = useT("common");
  return (
    <div role="radiogroup" aria-label={t("theme.group")} className={className} data-theme-control="select">
      {OPTIONS.map(({ value, key, Icon }) => {
        const label = t(key);
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            data-active={preference === value || undefined}
            className={clsx(itemClassName)}
            onClick={() => setPreference(value)}
            title={label}
          >
            <Icon size={iconSize} aria-hidden />
            {showLabels ? <span>{label}</span> : <span className="sr-only">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
