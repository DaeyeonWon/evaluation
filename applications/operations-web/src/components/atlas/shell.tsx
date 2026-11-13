"use client";
/**
 * Atlas application shell. Two-row drawing-sheet title block:
 *   row 1 — brand · ⌘K search · global period selector · virtual clock · simulator · KO|EN · theme · user
 *   row 2 — numbered sheet tabs (priority overflow → "더 보기" menu; Hermes as an external link)
 * plus toasts and the ⌘K command palette (screens, stages, pipelines, files, workflows, DLQ).
 * Nav links carry the current ?range= / ?from=&to= so the period survives navigation.
 */
import clsx from "clsx";
import {
  ArchiveX,
  BarChart3,
  CornerDownLeft,
  ExternalLink,
  FileSearch,
  FolderSearch,
  Gauge,
  GitBranch,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  SquareKanban,
  Sun,
  Table,
  UserRound,
  Users,
  Workflow as WorkflowIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CatalogIcon, LocaleToggle, useTheme } from "@/components/shared";
import { stageLabel, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { STAGES, STATUS_META } from "@/lib/catalog";
import { api, useApi, useLiveStream, useSession, useSimNow, useStreamEvent, useTimeRange } from "@/lib/client";
import type { DeadLetter, FileSearchHit, WorkflowSummary } from "@/lib/types";
import { RangePicker, useRangeHref } from "./time-range";
import { ToastProvider, useToast, useReducedMotionSafe } from "./ui";

type NavKey = "orchestration" | "board" | "overview" | "capacity" | "explorer" | "pipelines" | "workflows" | "files" | "dlq" | "results" | "analytics" | "config" | "hermes";
interface Tab {
  key: NavKey;
  href: string;
  no: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  external?: boolean;
}

export const TABS: Tab[] = [
  { key: "orchestration", href: "/", no: "A-00", Icon: MapIcon },
  { key: "board", href: "/board", no: "A-01", Icon: SquareKanban },
  { key: "overview", href: "/overview", no: "S-01", Icon: LayoutGrid },
  { key: "capacity", href: "/capacity", no: "S-02", Icon: Gauge },
  { key: "explorer", href: "/explorer", no: "S-03", Icon: Search },
  { key: "pipelines", href: "/pipelines", no: "P-01", Icon: WorkflowIcon },
  { key: "workflows", href: "/workflows", no: "S-04", Icon: GitBranch },
  { key: "files", href: "/files", no: "F-01", Icon: FolderSearch },
  { key: "dlq", href: "/dlq", no: "S-05", Icon: ArchiveX },
  { key: "results", href: "/results", no: "U-01", Icon: Table },
  { key: "analytics", href: "/analytics", no: "S-07", Icon: BarChart3 },
  { key: "config", href: "/config", no: "S-06", Icon: SlidersHorizontal },
  { key: "hermes", href: "/hermes", no: "X-01", Icon: ExternalLink, external: true },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

function useTabs() {
  const { can } = useSession();
  const hermes = can("hermes:access");
  return useMemo(() => TABS.filter((t) => t.key !== "hermes" || hermes), [hermes]);
}

function Brand() {
  const t = useT("shell");
  const rh = useRangeHref();
  const nav = useT("nav");
  const c = useT("common");
  return (
    <Link className="brand" href={rh("/")} aria-label={nav("home")}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 24 L13 8 L20 24 M9 18h8" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="24" cy="10" r="3" fill="var(--accent)" />
        <path d="M20 24h6" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <div>
        <b>{t("brand.name")}</b>
        <small>
          {c("app.subtitle")} · {t("brand.env")}
        </small>
      </div>
    </Link>
  );
}

/** Simulator run state: `tick` stops while paused, so also follow the `sim` SSE event and mutation responses. */
export function useSim() {
  const { snapshot, status } = useLiveStream();
  const [sim, setSim] = useState<{ running: boolean; speed: number } | null>(null);
  useStreamEvent("sim", (s) => setSim({ running: s.running, speed: s.speed }));
  useStreamEvent("tick", (t) => setSim({ running: t.running, speed: t.speed }));
  useStreamEvent("hello", (h) => setSim({ running: h.sim.running, speed: h.sim.speed }));
  return { running: sim?.running ?? snapshot?.running ?? true, speed: sim?.speed ?? snapshot?.speed ?? 1, status, set: setSim };
}

function SimControls() {
  const { running, speed, status, set } = useSim();
  const toast = useToast();
  const t = useT("shell");
  const { can } = useSession();
  const allowed = can("sim:control");
  const deny = allowed ? undefined : t("sim.denied");
  const toggle = async () => {
    if (!allowed) return;
    try {
      const r = running ? await api.simPause() : await api.simResume();
      set({ running: r.sim.running, speed: r.sim.speed });
      toast.ok(running ? t("sim.paused") : t("sim.resumed"));
    } catch (e) {
      toast.err(e);
    }
  };
  const setSpeed = async (s: number) => {
    if (!allowed) return;
    try {
      const r = await api.simSpeed(s);
      set({ running: r.sim.running, speed: r.sim.speed });
      toast.ok(t("sim.speedSet", { speed: s }));
    } catch (e) {
      toast.err(e);
    }
  };
  const lbl = running ? t("sim.pause") : t("sim.resume");
  return (
    <>
      <button className="btn icon" onClick={toggle} aria-label={lbl} title={deny ?? lbl} aria-disabled={!allowed || undefined}>
        {running ? <Pause /> : <Play />}
      </button>
      <div className="seg hide-md" role="group" aria-label={t("sim.speed")} title={deny}>
        {[1, 2, 5].map((s) => (
          <button key={s} aria-pressed={speed === s} aria-disabled={!allowed || undefined} onClick={() => setSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      {status !== "open" && status !== "idle" ? (
        <span className="conn hide-sm" title={t("stream.title")}>
          {status === "connecting" ? t("stream.connecting") : t("stream.reconnecting")}
        </span>
      ) : null}
    </>
  );
}

function Clock() {
  const now = useSimNow();
  const f = useFmt();
  const c = useT("common");
  const { running } = useSim();
  return (
    <div className={clsx("clock hide-md", !running && "paused")} aria-live="off">
      <b suppressHydrationWarning>
        <span className="live-dot" style={{ marginRight: 6 }} />
        {f.time(now)}
      </b>
      <span suppressHydrationWarning>
        {f.dateLabel(now)} · {c("time.virtualClock")}
      </span>
    </div>
  );
}

function ThemeBtn({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const c = useT("common");
  const lbl = resolved === "dark" ? c("theme.switchToLight") : c("theme.switchToDark");
  return (
    <button className={clsx("btn icon", className)} onClick={toggle} aria-label={lbl} title={lbl} suppressHydrationWarning>
      {resolved === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}

/* ───────────── generic popover menu ───────────── */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

function MenuPop({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      className={clsx("menu-pop", className)}
      role="menu"
      aria-label={label}
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────── user menu ───────────── */
function initials(name: string) {
  const s = name.trim();
  if (!s) return "?";
  if (/[가-힣]/.test(s)) return s.slice(0, 1);
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function UserMenu() {
  const t = useT("shell");
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  if (!s.user) {
    return (
      <Link className="btn" href="/login" prefetch={false}>
        <UserRound />
        {t("user.signIn")}
      </Link>
    );
  }
  const role = s.roles[0] ?? "—";
  return (
    <div className="umenu" ref={ref}>
      <button className="btn umenu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={t("user.menu", { name: s.user.name, role })}>
        <span className="avatar" aria-hidden>
          {initials(s.user.name)}
        </span>
        <span className="umenu-n">
          <b>{s.user.name}</b>
          <small>{role}</small>
        </span>
      </button>
      <AnimatePresence>
        {open ? (
          <MenuPop className="umenu-pop" label={t("user.menuLabel")}>
            <div className="umenu-head">
              <span className="avatar lg" aria-hidden>
                {initials(s.user.name)}
              </span>
              <div style={{ minWidth: 0 }}>
                <b>{s.user.name}</b>
                <div className="mono muted ell">{s.user.email}</div>
              </div>
            </div>
            <dl className="umenu-dl">
              <dt>{t("user.roles")}</dt>
              <dd>
                {s.roles.length ? (
                  s.roles.map((r) => (
                    <span key={r} className={`role-tag role-${r}`}>
                      {r}
                    </span>
                  ))
                ) : (
                  <span className="muted">{t("user.noRole")}</span>
                )}
              </dd>
              <dt>{t("user.auth")}</dt>
              <dd className="mono">{s.mode.toUpperCase()}</dd>
              <dt>{t("user.perms")}</dt>
              <dd className="mono umenu-perms">{s.permissions.join(" · ") || "—"}</dd>
            </dl>
            <div className="umenu-prefs" role="none">
              <span>{t("user.prefs")}</span>
              <LocaleToggle />
              <ThemeBtn />
            </div>
            <div className="umenu-acts" role="none">
              {s.mode === "mock" ? (
                <Link className="menu-item" role="menuitem" href="/login" prefetch={false} onClick={close}>
                  <Users aria-hidden />
                  {t("user.switch")}
                </Link>
              ) : null}
              <button
                className="menu-item danger"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void s.logout();
                }}
              >
                <LogOut aria-hidden />
                {busy ? t("user.loggingOut") : t("user.logout")}
              </button>
            </div>
          </MenuPop>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── nav strip with priority overflow ───────────── */
function TabLink({ tab, on, href, pend, onClick, menu }: { tab: Tab; on: boolean; href: string; pend: number; onClick?: () => void; menu?: boolean }) {
  const nav = useT("nav");
  const c = useT("common");
  const label = nav(`${tab.key}.label`);
  const ext = tab.external
    ? { target: "_blank", rel: "noopener noreferrer", prefetch: false as const, "aria-label": `${label} (${c("a11y.externalLink")})` }
    : {};
  return (
    <Link href={href} className={clsx(menu ? "menu-item" : "tab", tab.external && "ext")} role={menu ? "menuitem" : undefined} aria-current={on ? "page" : undefined} onClick={onClick} {...ext}>
      {menu ? <tab.Icon aria-hidden /> : null}
      <span className="no">{tab.no}</span>
      <span className="tl">{label}</span>
      {tab.external ? <ExternalLink aria-hidden className="ext-ico" /> : null}
      {tab.key === "dlq" && pend ? (
        <span className="cnt" aria-label={nav("dlqPendingBadge", { count: pend })}>
          {pend}
        </span>
      ) : null}
      {on && !menu ? <motion.span layoutId="atlas-tab-ind" className="bar-ind" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
    </Link>
  );
}

function NavStrip() {
  const path = usePathname();
  const tabs = useTabs();
  const rh = useRangeHref();
  const nav = useT("nav");
  const t = useT("shell");
  const { snapshot } = useLiveStream();
  const pend = snapshot?.kpis.dlqPendingReview ?? 0;
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(tabs.length);
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, moreRef, close);

  useLayoutEffect(() => {
    const el = box.current;
    const m = measure.current;
    if (!el || !m) return;
    const calc = () => {
      const widths = Array.from(m.children).map((c) => (c as HTMLElement).offsetWidth + 2);
      const moreW = 92;
      const avail = el.clientWidth;
      let used = 0;
      let n = 0;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail) n = widths.length;
      else
        for (const w of widths) {
          if (used + w + moreW > avail) break;
          used += w;
          n++;
        }
      setFit(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    ro.observe(m);
    return () => ro.disconnect();
  }, [tabs.length]);

  const shown = tabs.slice(0, fit);
  const rest = tabs.slice(fit);
  const activeRest = rest.find((x) => isActive(path, x.href));
  const hrefOf = (x: Tab) => (x.external ? x.href : rh(x.href));

  return (
    <div className="navrow">
      <nav className="tabs" aria-label={nav("label")} ref={box}>
        {shown.map((x) => (
          <TabLink key={x.key} tab={x} on={isActive(path, x.href)} href={hrefOf(x)} pend={pend} />
        ))}
        {rest.length ? (
          <div className="more" ref={moreRef}>
            <button className={clsx("tab more-btn", activeRest && "act")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <MoreHorizontal aria-hidden />
              <span className="tl">{activeRest ? nav(`${activeRest.key}.label`) : t("nav.more")}</span>
              <span className="cnt muted-cnt">{rest.length}</span>
              {activeRest ? <motion.span layoutId="atlas-tab-ind" className="bar-ind" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            </button>
            <AnimatePresence>
              {open ? (
                <MenuPop className="more-pop" label={t("nav.moreLabel")}>
                  {rest.map((x) => (
                    <TabLink key={x.key} tab={x} on={isActive(path, x.href)} href={hrefOf(x)} pend={pend} onClick={close} menu />
                  ))}
                </MenuPop>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </nav>
      {/* off-screen copy used only to measure natural tab widths */}
      <div className="tabs tabs-measure" ref={measure} aria-hidden="true">
        {tabs.map((x) => (
          <span key={x.key} className={clsx("tab", x.external && "ext")}>
            <span className="no">{x.no}</span>
            <span className="tl">{nav(`${x.key}.label`)}</span>
            {x.external ? <ExternalLink className="ext-ico" /> : null}
            {x.key === "dlq" && pend ? <span className="cnt">{pend}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────── command palette ───────────── */
interface PalItem {
  grp: string;
  icon: ReactNode;
  label: string;
  sub: string;
  href: string;
  /** Shift+Enter target (e.g. the file's Workflow) */
  alt?: { href: string; label: string };
  tone?: string;
  mono?: boolean;
}

const basename = (o: string) => o.split("/").filter(Boolean).pop() ?? o;

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const t = useT("shell");
  const nav = useT("nav");
  const locale = useLocale();
  const tabs = useTabs();
  const rh = useRangeHref();
  const tr = useTimeRange();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [remote, setRemote] = useState<{ q: string; wfs: WorkflowSummary[]; dls: DeadLetter[]; files: FileSearchHit[] }>({ q: "", wfs: [], dls: [], files: [] });
  const pipes = useApi(["pipelines", "palette"], () => api.pipelines(), { revalidateOnFocus: false });
  const listRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const rangeParams = tr.params;

  useEffect(() => {
    const term = q.trim();
    let alive = true;
    const h = setTimeout(
      () => {
        // ID lookups search the whole data window when a term is typed (an ID from yesterday should
        // still be found on a "today" page); the recent lists and file hits follow the page period.
        const idRange = term ? { range: "30d" } : rangeParams;
        Promise.all([
          api.workflows({ q: term || undefined, pageSize: term ? 10 : 5, sort: "updated_desc", ...idRange }),
          api.deadLetters({ q: term || undefined, pageSize: term ? 8 : 4, ...idRange }),
          term.length >= 2 ? api.fileSearch({ q: term, limit: 8, ...rangeParams }).then((r) => r.items) : Promise.resolve([] as FileSearchHit[]),
        ])
          .then(([w, d, files]) => alive && setRemote({ q: term, wfs: w.items, dls: d.items, files }))
          .catch(() => {});
      },
      term ? 160 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, rangeParams]);

  const items = useMemo<PalItem[]>(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const m = (s: string) => terms.every((x) => s.toLowerCase().includes(x));
    const out: PalItem[] = [];
    tabs.forEach((x) => {
      const label = nav(`${x.key}.label`);
      if (m(`${label} ${nav(`${x.key}.title`)} ${x.key} ${x.no} ${x.href}`))
        out.push({ grp: t("palette.groups.screens"), icon: <x.Icon />, label, sub: `${x.no} · ${x.href}`, href: x.external ? x.href : rh(x.href) });
    });
    STAGES.forEach((s) => {
      const label = stageLabel(s.id, locale);
      if (m(`${label} ${s.label.ko} ${s.label.en} ${s.id}`)) out.push({ grp: t("palette.groups.stages"), icon: <CatalogIcon name={s.icon} />, label, sub: s.id, href: rh(`/?stage=${s.id}`) });
    });
    if (terms.length)
      (pipes.data?.items ?? []).forEach((p) => {
        const label = locale === "ko" ? p.labelKo || p.label : p.label;
        if (m(`${p.id} ${p.label} ${p.labelKo} ${p.kind}`))
          out.push({
            grp: t("palette.groups.pipelines"),
            icon: <WorkflowIcon />,
            label: p.id,
            mono: true,
            sub: t("palette.pipelineSub", { label, kind: p.kind === "root" ? t("palette.root") : t("palette.sub"), version: p.latestVersion, runs: p.runs }),
            href: rh(`/pipelines/${encodeURIComponent(p.id)}`),
          });
      });
    if (remote.q === q.trim())
      remote.files.forEach((f) =>
        out.push({
          grp: t("palette.groups.files"),
          icon: <FileSearch />,
          label: basename(f.object),
          mono: true,
          sub: [stageLabel(f.stage, locale), f.workflow_id ?? t("palette.noWorkflow"), f.bucket].join(" · "),
          href: rh(`/files?q=${encodeURIComponent(basename(f.object))}&stage=${f.stage}`),
          alt: f.workflow_id ? { href: rh(`/workflows/${f.workflow_id}`), label: t("palette.openWorkflow") } : undefined,
        }),
      );
    remote.wfs.forEach((w) =>
      out.push({
        grp: "Workflow",
        icon: <CatalogIcon name={STATUS_META[w.status].icon} />,
        tone: STATUS_META[w.status].tone,
        label: w.workflow_id,
        mono: true,
        sub: [w.batch_id, statusLabel("workflow", w.status, locale), w.pipeline_id, w.pipeline_job_id].filter(Boolean).join(" · "),
        href: rh(`/workflows/${w.workflow_id}`),
      }),
    );
    remote.dls.forEach((d) =>
      out.push({
        grp: "DLQ",
        icon: <ArchiveX />,
        tone: "dlq",
        label: d.dead_letter_id,
        mono: true,
        sub: `${d.workflow_id} · ${d.error_code} · ${statusLabel("dlq", d.status, locale)}`,
        href: rh(`/dlq?sel=${d.dead_letter_id}`),
      }),
    );
    return out.slice(0, 70);
  }, [q, remote, tabs, nav, t, locale, rh, pipes.data]);

  const go = useCallback(
    (it: PalItem | undefined, alt = false) => {
      if (!it) return;
      onClose();
      router.push(alt && it.alt ? it.alt.href : it.href);
    },
    [onClose, router],
  );

  const cur = Math.min(sel, Math.max(0, items.length - 1));
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  let lastGrp = "";
  return (
    <motion.div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.label")}
        initial={reduced ? false : { y: -8, scale: 0.985, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="pal-in">
          <Search aria-hidden />
          <input
            autoFocus
            value={q}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.input")}
            aria-controls="atlas-pal-list"
            aria-activedescendant={items[cur] ? `atlas-pal-${cur}` : undefined}
            role="combobox"
            aria-expanded="true"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(Math.min(items.length - 1, cur + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(Math.max(0, cur - 1));
              } else if (e.key === "Enter") go(items[cur], e.shiftKey);
              else if (e.key === "Escape") onClose();
            }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="pal-list" id="atlas-pal-list" role="listbox" ref={listRef} aria-label={t("palette.results")}>
          {items.length === 0 ? (
            <div className="empty">
              <b>{t("palette.emptyTitle")}</b>
              {t("palette.emptyHint")}
            </div>
          ) : (
            items.map((it, i) => {
              const head = it.grp !== lastGrp ? <div className="grp-t" role="presentation">{it.grp}</div> : null;
              lastGrp = it.grp;
              return (
                <div key={it.grp + it.href + i} role="presentation">
                  {head}
                  <div
                    id={`atlas-pal-${i}`}
                    className={clsx("pal-item", it.tone && `tone-${it.tone}`)}
                    role="option"
                    aria-selected={i === cur}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                  >
                    <span style={{ color: "var(--tc, var(--ink-3))", display: "grid" }}>{it.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className={clsx(it.mono && "mono", "ell")} style={{ fontSize: 12.5 }}>
                        {it.label}
                      </div>
                      <div className="sub ell">{it.sub}</div>
                    </div>
                    {it.alt ? (
                      <button
                        className="btn sm ghost pal-alt"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          go(it, true);
                        }}
                        title="Shift+Enter"
                      >
                        {it.alt.label}
                      </button>
                    ) : null}
                    <CornerDownLeft className="muted" aria-hidden style={{ width: 13, height: 13 }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="pal-foot mono muted">
          <span>
            <span className="kbd">↑↓</span> {t("palette.keys.move")}
          </span>
          <span>
            <span className="kbd">↵</span> {t("palette.keys.open")}
          </span>
          <span>
            <span className="kbd">⇧↵</span> {t("palette.keys.alt")}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ───────────── top bar ───────────── */
function TopBar({ onPalette }: { onPalette: () => void }) {
  const t = useT("shell");
  const c = useT("common");
  return (
    <header className="top">
      <div className="toprow">
        <Brand />
        <span className="mock hide-sm" title={c("app.mockDataHint")}>
          {c("app.mockData")}
        </span>
        <button className="btn search-btn" onClick={onPalette} aria-label={t("palette.open")}>
          <Search />
          <span className="lbl">{t("palette.button")}</span>
          <span className="kbd">⌘K</span>
        </button>
        <div className="tools">
          <RangePicker />
          <Clock />
          <SimControls />
          <LocaleToggle className="hide-sm" />
          <ThemeBtn className="hide-sm" />
          <UserMenu />
        </div>
      </div>
      <NavStrip />
    </header>
  );
}

function TopBarFallback() {
  return (
    <header className="top">
      <div className="toprow">
        <Brand />
      </div>
      <div className="navrow" />
    </header>
  );
}

export function AtlasShell({ children }: { children: ReactNode }) {
  const [pal, setPal] = useState(false);
  const c = useT("common");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPal((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const close = useCallback(() => setPal(false), []);
  return (
    <ToastProvider>
      <a className="skip" href="#atlas-main">
        {c("a11y.skipToContent")}
      </a>
      <Suspense fallback={<TopBarFallback />}>
        <TopBar onPalette={() => setPal(true)} />
      </Suspense>
      <main id="atlas-main">{children}</main>
      <AnimatePresence>
        {pal ? <Palette key="pal" onClose={close} /> : null}
      </AnimatePresence>
    </ToastProvider>
  );
}
