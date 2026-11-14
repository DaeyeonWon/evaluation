# Issue Report: frame, filters, links and hooks (for view engineers)

The three design candidates (`/issues/a|b|c`) are now one Issue Report with five pages. A shared
**frame** wraps all of them. This document covers what the frame gives you, the APIs you build on, and
which files each view engineer owns.

## 1. Routes and pages

| Route | Page | Component | Namespace | CSS (scope class) |
| --- | --- | --- | --- | --- |
| `/issues` | Triage (default) | `issues/triage` → `IssuesTriage` | `issuesTriage` | `atlas-issues-triage.css` (`.iss-a`) |
| `/issues/categories` | 분해 보기 / Breakdown | `issues/categories` → `IssuesCategories` | `issuesCategories` | `atlas-issues-categories.css` (`.iss-cat`) |
| `/issues/analysis` | Analysis | `issues/analysis` → `IssuesAnalysis` | `issuesAnalysis` | `atlas-issues-analysis.css` (`.iss-c`) |
| `/issues/report` | Report | `issues/report` → `IssuesReport` | `issuesReport` | `atlas-issues-report.css` (`.iss-b`) |
| `/issues/[id]` | Single issue | `issues/detail` → `IssueDetailPage({ id })` | `issuesDetail` | `atlas-issues-detail.css` (`.iss-det`) |

- Components live under `src/components/atlas/issues/<view>/`. Route files live under `src/app/(console)/issues/`.
  Each page has `generateMetadata`. Its title is `<view.tab> · 이슈 리포트`, and the detail page uses `issuesDetail.metaTitle`.
- `src/app/(console)/issues/layout.tsx` mounts the frame once. Switching views does not remount the frame.
- **Legacy redirects (308, query kept)**: `/issues/a` → `/issues`, `/issues/b` → `/issues/report`,
  `/issues/c` → `/issues/analysis`. They are route handlers (`issues/{a,b,c}/route.ts`), so there is no page and no layout render.
- The chooser page and `issues-index.tsx` are gone. The nav tab I-01 is active on every `/issues/**` route
  (`shell.tsx` matches by prefix, so it needed no change).
- The tag `issue-report-candidates-v1` preserves the original candidates. The moves used `git mv`, so `git log --follow` works.

**Your view's root element:** `<div className="iss-<x> iss-view">`. Do not use `<Sheet>` or `<SheetHead>`
(the frame owns those). `.iss-view` is a grid with the sheet's 18px rhythm.

## 2. The frame (`src/components/atlas/issues/frame/`)

`IssuesFrame` (index.tsx) renders these parts in order:

1. **Header**:
   - `I-01 · ISSUE REPORT · <VIEW>` drawing number.
   - Title `이슈 리포트` with a view pill.
   - The view's one-line description: `<namespace>.view.desc`. Each view namespace owns its `view: { tab, desc }` block, so edit your own copy there.
   - Baseline badge (from `useIssueSummary(f).baseline`).
   - Export group (CSV, Markdown download, Markdown copy) built on `useIssueExport(f, { issueBase: "/issues" })`.
     Views must not add their own list-export buttons.
2. **View switcher**:
   - Tabs: Triage · 분해 보기 · Analysis · Report (`next/link`, `aria-current="page"`).
   - The indicator is a shared `layoutId` spring and moves on click, before the route resolves. Reduced motion makes the move instant.
   - The links carry the full filter query (see §4).
3. **FilterBar** (filter-bar.tsx), driven by `issues-shared/dims.ts`:
   - Primary dims are always visible as dropdown chips: agent_function, category, division, region,
     bixby_version, severity (labelled **영향도 / Impact**), status, user_impact, dev_miss.
     Each dropdown lists values with a checkbox, a count bar, FAIL count (issue count for issue-level dims), FAIL rate and Δ vs baseline.
     The figures come from `GET /issues/facets`, falling back to `summary.columns`.
   - Under **필터 더보기**: capsule, intent, language, market, device, model_version, pipeline,
     pipeline_version, failure_reason, novelty, risk (= the `severity_class` param), os_version, one_ui_version,
     plus a Must-handle segment (Any / true / false) and a min score segment (Any / ≥30 / ≥45 / ≥60).
   - Search (`q`, 350 ms debounce).
   - Active-filter chips, each removable, plus **모두 지우기** (`f.reset()`, which keeps the range).
   - At ≤ 720px the bar collapses to a **필터 (n)** button and the search box. The button opens a bottom sheet with every dim
     as a collapsible list, plus the scalar filters.
4. **On `/issues/[id]`**: the switcher and FilterBar are hidden. In their place the frame shows **← <view> 보기로 돌아가기**
   (back to the view and query the issue came from) and the active-filter chips. The chips matter because filters still scope
   the issue's utterances and trend. List exports are hidden there; the detail page owns its issue Markdown export.

**Views must not render any filter UI.** If your view needs a view-local control (axis picker, dimension
switch, lens), it is not a filter. Keep it in a view-local URL param (§4).

## 3. Filters: `useIssueFilters()` (`issues-shared/filters.ts`)

`useIssueFilters()` is the only way views read and write filters.

```ts
const f = useIssueFilters();
f.values.division            // string[]   ?division=TV,Mobile
f.values.must_handle         // "true" | "false" | null
f.toggle("bixby_version", "4.0.3");  f.only("region", "EU");  f.set({ category: ["asr"] });  f.reset();
f.query / f.filterQuery      // IssueQuery for api calls (range included; filterQuery has no sort)
f.selected / f.select(id)    // ?issue=<id> quick-look selection (Triage side sheet)
```

- **List params** (comma-separated): every `IssueColumn` (agent_function … one_ui_version, plus the merge row dims
  **division, region, bixby_version**), the merge issue-level dims **category, user_impact, dev_miss**, and severity,
  status, novelty, severity_class. `ISSUE_LIST_FILTERS` lists them in order.
- **Scalars**: `must_handle` (true|false), `q`, `min_score`, `group_by` (signature|pattern), `sort`, `page`.
- **Time range** (`range` or `from`/`to`) belongs to the shell and is always included in `f.query`.

### Triage lenses: `useTriageLens()`

```ts
const tl = useTriageLens();
tl.lens        // "user" (default) | "dev"              ?lens=dev
tl.group       // GroupDim, default "severity" (= 영향도 / Impact level)   ?group=division
tl.subgroup    // GroupDim | null: unset → the lens type; ?subgroup=none → null; never equal to group   ?subgroup=division
tl.typeDim     // "user_impact" (user lens) | "dev_miss" (dev lens): the card type badge and default secondary grouping
tl.setLens("dev")      // push history; also sets must_handle=true when it is unset (the dev-lens default)
tl.setGroup("region"); tl.setSubgroup(null)   // null writes subgroup=none; setSubgroup(tl.typeDim) clears the param
```

A deep link with `?lens=dev` and no `must_handle` does **not** get the dev default; only `setLens` applies it.
`useIssueGroups` sends `lens` to `GET /issues`. The server currently accepts it and ignores it (200), so the lens is client-side state.

`lens`, `group` and `subgroup` are **Triage view state, not filters**. Links carry them only within Triage.
`GROUP_DIMS` lists the allowed group and subgroup dims: severity, user_impact, dev_miss, category, agent_function, division,
region, bixby_version, market, device, model_version, status, failure_reason, novelty.

## 4. Links: `useIssueViewLinks()` + `useIssueLinks()` (`issues-shared/links.ts`)

```ts
const V = useIssueViewLinks();
V.page                       // "triage" | "categories" | "analysis" | "report" | "detail"
V.view                       // the list view this page belongs to (detail → the view it was opened from)
V.viewHref("analysis")       // /issues/analysis?<filters>
V.issueHref(id)              // /issues/<id>?<filters>[&via=<view>] + the current view's view state
V.drillHref("division", "TV")                  // /issues?<filters>&division=TV   (target view defaults to triage)
V.drillHref("category", "asr", "analysis", { replace: false })   // add the value instead of replacing
V.backHref                   // on /issues/[id]: the originating view + its query
```

What each link carries:
- **Everything** (filters, range, sort, group_by, unknown params).
- **Minus** `page`, `issue` and `via` (the detail page's origin view). `via` is not `from`: `from`/`to` are the global
  custom time range and are always carried. A legacy `from=<view name>` (old links) is still read as the origin and dropped.
- **Minus the view-local params of other views.** These are registered in `VIEW_STATE_PARAMS`:
  - triage: `lens, group, subgroup, view`
  - categories: `dim, csort, cview` (reserved)
  - analysis: `hm, quad, pat, x, y, metric, tree`
  - report: none

**If you add a view-local URL param, register it in `VIEW_STATE_PARAMS`.** Otherwise it leaks into the other views.

Pure helpers for non-hook code: `viewPath(view, search)`, `issuePath(id, search, via)`, `issuePageOf(pathname)`,
`ISSUE_VIEWS`, `ISSUE_VIEW_PATH`, `ORIGIN_PARAM` (= `"via"`).

`useIssueLinks()` gives drill-downs out of the Issue Report: `results(issue)`, `resultsFor({...})`,
`evidence(insight)`, `workflow(id, from, to)`, `utterance(id)`, and `issue(base, id)` for `?issue=` quick-look links.
`results*` and `evidence` carry the current `division`, `region` and `bixby_version` filters (unless the link sets them),
so `/results` opens on the same slice. `workflow(id, from, to)` widens the range to cover the Workflow (`useCoverHref`);
the detail page's Workflow links use the same helper.

## 5. Dimension metadata (`issues-shared/dims.ts`)

```ts
ISSUE_DIMS[id]  // { id, param, labelKey: "frame.dim.<id>", kind: list|bool|number|text, multi, level: row|issue, tier: primary|more, facet }
dimMeta("risk").param === "severity_class"
PRIMARY_DIMS, MORE_DIMS, LIST_DIMS
BREAKDOWN_DIMS  // 분해 보기: category, agent_function, division, region, bixby_version, user_impact, dev_miss
MATRIX_DIMS     // Analysis axes/levels: agent_function, category, division, region, market, language, device, bixby_version, model_version, pipeline, user_impact, dev_miss, failure_reason
MATRIX_METRICS  // fail_rate, fail_count, delta, issue_count
GROUP_DIMS      // Triage group/subgroup (see §3)
DETAIL_BREAKDOWN_DIMS  // division, region, market, device, bixby_version, model_version, language
const dl = useDimLabel(); dl.dim("bixby_version"); dl.value("device", "galaxy_s26"); dl.value("market", "MX")
```

- Dim labels live in `issues.frame.dim.*`.
- Value labels go through `useIssueFormat().value(param, v)`. Groups: agentFunction, market, failureReason, severity, status,
  novelty, severityClass, plus **category, division, region, userImpact, devMiss**. The data engineer adds those label groups to
  the `issues` namespace; until a key exists, the raw value shows.
- language, device and capsule use the static catalogs.

### Colours: `issues-shared/palette.tsx` + `atlas-issues.css`

One colour vocabulary for every view. Do not define your own type or factor hues.

| What | Tokens | JS |
| --- | --- | --- |
| 영향도 / Impact levels P0–P3 (reserved; always icon + "P0 Critical" label) | `--sev-p0 … --sev-p3` | `IMPACT_LEVELS`, `sevVar(s)` |
| 사용자 영향 types | `--ut-<user_impact_type>` (7 validated slots `--ty-1…7`) | `USER_IMPACT_ORDER`, `typeVar("user_impact", v)` |
| Bixby 미처리 types | `--dm-<dev_miss_type>` (same 7 slots + neutral steps; `out_of_scope` = ink + hatch) | `DEV_MISS_ORDER`, `typeVar("dev_miss", v)` |
| Score factors volume → novelty | `--fa-<factor>` (a separate validated 6-slot set) | `FACTOR_ORDER`, `factorVar(k)` |

`<TypeDot dim value />` renders the swatch + icon (`.iss-tyd`); put the label next to it. Triage cards and lanes,
분해 보기 cards/table, Analysis bubble colour-by and score strips, Report type tags/cross-tabs/score bars and the
detail taxonomy tiles all read these tokens.

## 6. Data hooks (`issues-shared/data.ts`; types in `contract.ts`, aliased from `@/lib/types`)

| Hook | Endpoint | Type |
| --- | --- | --- |
| `useIssues(f, { pageSize, page })` | `GET /issues` | `IssueListResponse` |
| `useIssueGroups(f, { group, subgroup, lens }, { groupSize, groupKey, subgroupKey, groupPage, pageSize, page })` | `GET /issues?group=&subgroup=&lens=&group_size=&group_key=&subgroup_key=&group_page=` | `IssueGroupedListResponse` (`groups[]` with `key`, `label`, `count`, `fails`, `by_severity`, `items`, `subgroups`). "Load more" for one group = `groupKey` (+ `subgroupKey`) with a larger `groupSize` |
| `useIssueBreakdown(f, dim)` | `GET /issues/breakdown?dim=` | `IssueBreakdownResponse` = `IssueBreakdown` (items: stats + `by_severity`, `trend`, `top_issues`, `top_pattern`, `share`) |
| `useIssueMatrix(f, { x, y, metric })` | `GET /issues/matrix?x=&y=&metric=` | `IssueDimMatrixResponse` = `IssueDimMatrix` (`x_values`, `y_values`, `cells`, `domain`, …) |
| `useIssueDetail(id, f, { page })` | `GET /issues/[id]` | `IssueDetailMerge` = `IssueDetail` (breakdown incl. division/region/bixby_version, `same_category`) |
| `issueBreakdowns(detail)` | n/a | `[{ dim, stats }]` for `DETAIL_BREAKDOWN_DIMS` that are present |
| `useIssueSummary`, `useIssueFacets`, `useIssueInsights`, `useIssuePatterns`, `useIssue`, `useIssueActions`, `useIssueLive` | unchanged | |
| `useIssueTriage()`, `useIssueExport(f, { issueBase })`, `useIssuePermission()`, `useIssueFormat()` | unchanged | |

- Breakdown and matrix resolve to `data: null` on **404**, which means the endpoint is not deployed yet. Render an empty state for that, not an error.
  The browser still logs the failed request.
- Every hook shares the `issues:` cache prefix, refetches on SSE `issue` and polls every 30s. The frame calls `useIssueSummary(f)` and
  `useIssueFacets(f)` itself; the same key dedupes, so calling them again in your view is free.

## 7. File ownership

| Engineer | Owns |
| --- | --- |
| Triage | `src/components/atlas/issues/triage/**`, `src/styles/atlas-issues-triage.css`, `src/i18n/messages/{ko,en}/issuesTriage.ts` |
| Categories | `src/components/atlas/issues/categories/**`, `src/styles/atlas-issues-categories.css`, `{ko,en}/issuesCategories.ts` |
| Analysis | `src/components/atlas/issues/analysis/**`, `src/styles/atlas-issues-analysis.css`, `{ko,en}/issuesAnalysis.ts` |
| Report | `src/components/atlas/issues/report/**`, `src/styles/atlas-issues-report.css`, `{ko,en}/issuesReport.ts` |
| Detail | `src/components/atlas/issues/detail/**`, `src/styles/atlas-issues-detail.css`, `{ko,en}/issuesDetail.ts`, `src/app/(console)/issues/[id]/page.tsx` (may replace the placeholder) |
| Framework | `issues/frame/**`, `atlas-issues-frame.css`, **all of `issues-shared/**`**, `src/app/(console)/issues/layout.tsx` + `page.tsx` and the other route files, the `frame` block of `issues.ts`, `messages/index.ts`, `e2e/smoke` |
| Data (P) | `src/server/**`, `src/app/api/**`, `src/lib/types.ts`, `src/lib/client/api.ts`, the rest of `issues.ts` (value labels, severity → 영향도 labels), `atlas-issues.css` (shared tokens). P may add hooks or formatters to `issues-shared/{data,format}.ts` in coordination with framework. |

Ask the framework engineer for changes to shared files: a new filter param, a dim, a view-local param in `VIEW_STATE_PARAMS`, or frame copy.

## 8. Status of the moved folders

The TODOs from the move are done: Triage lenses + swimlanes, the quick-look sheet's "전체 분석 열기" link, Report's
division / region / Bixby version / 사용자 영향 / Bixby 미처리 sections (the Masthead's duplicate exports are gone),
Analysis' free-axis heatmap + treemap hierarchy picker, the 분해 보기 view and the single-issue page. Each folder's
`index.tsx` header describes the view as built.

## 9. Verification (framework)

- Every route returns 200. `/issues/{a,b,c}?market=KR,US&range=7d` returns 308 to the merged view with the query intact.
- Switching views keeps `division` and `severity`, and drops `lens` and `group` outside Triage.
- No horizontal scroll at 400px in KO/EN or light/dark.
- `e2e/smoke/smoke.spec.ts` covers:
  - the route sweep: `/issues`, `/issues/categories`, `/issues/analysis`, `/issues/report`, plus the top issue's `/issues/<id>`
  - the 308 redirects with their query
  - view switching keeping filters (and the custom `from`/`to` range into `/issues/<id>?…&via=<view>`)
  - the Triage lens switch (dev lens → `lens=dev&must_handle=true`) and `subgroup=none`
  - Viewer: Triage controls disabled and `PATCH /api/v1/issues/<id>` → 403
