/**
 * All message bundles. SERVER-SIDE import (src/i18n/server.ts) — client components get the active
 * locale's bundle through <I18nProvider messages=…>; importing this file from a "use client" module
 * would ship every locale to the browser. (status + catalog are the exception: see ../static.ts.)
 *
 * Adding a namespace: create ko/<ns>.ts + en/<ns>.ts, then add it to NAMESPACES and both maps below.
 */
import type { Locale } from "../locales";
import type { Messages } from "../core";
import ko_common from "./ko/common";
import ko_nav from "./ko/nav";
import ko_shell from "./ko/shell";
import ko_orchestration from "./ko/orchestration";
import ko_inspector from "./ko/inspector";
import ko_board from "./ko/board";
import ko_overview from "./ko/overview";
import ko_capacity from "./ko/capacity";
import ko_explorer from "./ko/explorer";
import ko_workflow from "./ko/workflow";
import ko_pipelines from "./ko/pipelines";
import ko_dlq from "./ko/dlq";
import ko_results from "./ko/results";
import ko_analytics from "./ko/analytics";
import ko_config from "./ko/config";
import ko_files from "./ko/files";
import ko_auth from "./ko/auth";
import ko_hermes from "./ko/hermes";
import ko_errors from "./ko/errors";
import ko_status from "./ko/status";
import ko_catalog from "./ko/catalog";
import en_common from "./en/common";
import en_nav from "./en/nav";
import en_shell from "./en/shell";
import en_orchestration from "./en/orchestration";
import en_inspector from "./en/inspector";
import en_board from "./en/board";
import en_overview from "./en/overview";
import en_capacity from "./en/capacity";
import en_explorer from "./en/explorer";
import en_workflow from "./en/workflow";
import en_pipelines from "./en/pipelines";
import en_dlq from "./en/dlq";
import en_results from "./en/results";
import en_analytics from "./en/analytics";
import en_config from "./en/config";
import en_files from "./en/files";
import en_auth from "./en/auth";
import en_hermes from "./en/hermes";
import en_errors from "./en/errors";
import en_status from "./en/status";
import en_catalog from "./en/catalog";

export const NAMESPACES = ["common", "nav", "shell", "orchestration", "inspector", "board", "overview", "capacity", "explorer", "workflow", "pipelines", "dlq", "results", "analytics", "config", "files", "auth", "hermes", "errors", "status", "catalog"] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** ko is the schema for every locale. */
export const ko = {
  common: ko_common,
  nav: ko_nav,
  shell: ko_shell,
  orchestration: ko_orchestration,
  inspector: ko_inspector,
  board: ko_board,
  overview: ko_overview,
  capacity: ko_capacity,
  explorer: ko_explorer,
  workflow: ko_workflow,
  pipelines: ko_pipelines,
  dlq: ko_dlq,
  results: ko_results,
  analytics: ko_analytics,
  config: ko_config,
  files: ko_files,
  auth: ko_auth,
  hermes: ko_hermes,
  errors: ko_errors,
  status: ko_status,
  catalog: ko_catalog,
};
export type Schema = typeof ko;
/** The full message set a locale must provide. */
export type LocaleMessages = { [N in Namespace]: Messages<Schema[N]> };

export const en = {
  common: en_common,
  nav: en_nav,
  shell: en_shell,
  orchestration: en_orchestration,
  inspector: en_inspector,
  board: en_board,
  overview: en_overview,
  capacity: en_capacity,
  explorer: en_explorer,
  workflow: en_workflow,
  pipelines: en_pipelines,
  dlq: en_dlq,
  results: en_results,
  analytics: en_analytics,
  config: en_config,
  files: en_files,
  auth: en_auth,
  hermes: en_hermes,
  errors: en_errors,
  status: en_status,
  catalog: en_catalog,
} satisfies LocaleMessages;

export const MESSAGES: Record<Locale, LocaleMessages> = { ko, en };
