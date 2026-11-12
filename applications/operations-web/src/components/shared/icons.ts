/**
 * Static map from the catalog's kebab-case icon names (statusMeta.icon, stages[].icon, …) to
 * lucide-react components. Static imports keep tree-shaking intact.
 *
 *   <CatalogIcon name={STATUS_META.RUNNING.icon} size={14} />     // preferred in render
 *   const Icon = iconFor(STATUS_META.RUNNING.icon);               // → Loader (outside render only:
 *   // eslint's react-hooks/static-components rejects `const Icon = iconFor(x)` + <Icon/> inside a component)
 */
import { createElement } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveX,
  Ban,
  BatteryWarning,
  Bug,
  Check,
  CheckCircle,
  CircleDashed,
  CircleHelp,
  Clock,
  CloudLightning,
  Cpu,
  Eye,
  FileCheck,
  FileWarning,
  Gauge,
  Inbox,
  KeyRound,
  ListOrdered,
  Loader,
  Lock,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  SkipForward,
  TimerOff,
  UploadCloud,
  Workflow,
  XCircle,
  XOctagon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle,
  archive: Archive,
  "archive-x": ArchiveX,
  ban: Ban,
  "battery-warning": BatteryWarning,
  bug: Bug,
  check: Check,
  "check-circle": CheckCircle,
  "circle-dashed": CircleDashed,
  clock: Clock,
  "cloud-lightning": CloudLightning,
  cpu: Cpu,
  eye: Eye,
  "file-check": FileCheck,
  "file-warning": FileWarning,
  gauge: Gauge,
  inbox: Inbox,
  "key-round": KeyRound,
  "list-ordered": ListOrdered,
  loader: Loader,
  lock: Lock,
  radio: Radio,
  "refresh-cw": RefreshCw,
  "rotate-ccw": RotateCcw,
  send: Send,
  "shield-check": ShieldCheck,
  "skip-forward": SkipForward,
  "timer-off": TimerOff,
  "upload-cloud": UploadCloud,
  workflow: Workflow,
  "x-circle": XCircle,
  "x-octagon": XOctagon,
};

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || CircleHelp;
}

/** Render a catalog icon by kebab-case name (safe inside render; unknown names → CircleHelp). */
export function CatalogIcon({ name, ...props }: { name: string | null | undefined } & LucideProps) {
  return createElement(iconFor(name), props);
}
