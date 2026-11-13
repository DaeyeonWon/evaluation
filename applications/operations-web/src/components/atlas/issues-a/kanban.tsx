"use client";
/** Triage Deck — kanban by lifecycle status. Drag a card onto an allowed column (server-enforced). */
import clsx from "clsx";
import { motion } from "motion/react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import type { Issue, IssueStatus } from "@/lib/types";
import { ISSUE_STATUS_ORDER, useIssuePermission, useIssueTriage, type IssueFormat } from "../issues-shared";
import { useReducedMotionSafe, useToast } from "../ui";
import { IssueCard, STATUS_ICON, type CardActions } from "./card";

export function Kanban({ items, labels, fx, act, onOpen, onTicket }: { items: Issue[]; labels: string[]; fx: IssueFormat; act: CardActions; onOpen: (id: string) => void; onTicket: (i: Issue) => void }) {
  const t = useT("issuesA");
  const s = useT("issues");
  const perm = useIssuePermission();
  const tri = useIssueTriage();
  const toast = useToast();
  const rm = useReducedMotionSafe();
  const [drag, setDrag] = useState<Issue | null>(null);
  const [over, setOver] = useState<IssueStatus | null>(null);
  const allowed = (from: IssueStatus, to: IssueStatus) => to !== from && (perm.next(from).includes(to) || (from === "NEW" && to === "TICKETED"));
  const move = (i: Issue, to: IssueStatus) => {
    if (to === i.state.status) return;
    if (!allowed(i.state.status, to)) {
      toast.err(new Error(t("deck.dropDenied", { from: fx.status(i.state.status), to: fx.status(to) })));
      return;
    }
    if (to === "TICKETED") {
      onTicket(i);
      return;
    }
    void tri.setStatus(i, to);
  };
  return (
    <div className="ia-kanban-wrap">
      <p className="ia-kb-hint muted">{perm.canWrite ? t("deck.dragHint") : perm.reason}</p>
      <div className="ia-kanban">
        {ISSUE_STATUS_ORDER.map((st) => {
          const col = items.filter((i) => i.state.status === st);
          const ok = drag ? allowed(drag.state.status, st) : false;
          return (
            <section
              key={st}
              className={clsx("ia-kb-col", drag && (ok ? "drop-ok" : drag.state.status !== st && "drop-no"), over === st && ok && "over")}
              data-st={st}
              aria-label={fx.status(st)}
              onDragOver={(e) => {
                if (!drag || !ok) return;
                e.preventDefault();
                setOver(st);
              }}
              onDragLeave={() => setOver((o) => (o === st ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) move(drag, st);
                setDrag(null);
                setOver(null);
              }}
            >
              <header>
                <span className="ia-st" data-st={st}>
                  {STATUS_ICON[st]}
                  {fx.status(st)}
                </span>
                <span className="mono muted">{col.length}</span>
                <small>{fx.statusHelp(st)}</small>
              </header>
              <div className="ia-kb-list">
                {col.map((i) => (
                  <motion.div
                    key={i.id}
                    layout={!rm}
                    layoutId={rm ? undefined : `kb-${i.id}`}
                    transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                    className={clsx("ia-kb-item", drag?.id === i.id && "dragging")}
                  >
                    <div
                      draggable={perm.canWrite}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", i.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDrag(i);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                    >
                    <IssueCard issue={i} labels={labels} fx={fx} onOpen={onOpen} act={act} compact />
                    </div>
                    <label className="ia-kb-move">
                      <span className="sr">{t("deck.moveTo")}</span>
                      <select
                        className="in"
                        value=""
                        disabled={!perm.canWrite}
                        title={perm.reason ?? t("deck.moveTo")}
                        onChange={(e) => {
                          if (e.target.value) move(i, e.target.value as IssueStatus);
                        }}
                      >
                        <option value="">{t("deck.moveTo")} …</option>
                        {ISSUE_STATUS_ORDER.filter((x) => allowed(i.state.status, x)).map((x) => (
                          <option key={x} value={x}>
                            → {fx.status(x)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </motion.div>
                ))}
                {!col.length ? <div className="ia-kb-empty">{t("deck.empty")}</div> : null}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mono muted ia-kb-foot">{s("filters.sort")}: {s("sort.score_desc")}</p>
    </div>
  );
}
