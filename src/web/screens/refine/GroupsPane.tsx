// The Refine groups pane: every group in reading order — labelled ones (backing vocals, ad-libs) indented under
// the line they come with — filters by label, and an offer for the whole song: split the parts in parentheses out
// into groups of their own.

import { useLayoutEffect, useRef, useState } from "react";
import type { Flag } from "../../../core/flags";
import { countParenRuns } from "../../../core/groups";
import { groupStart, groupText, isLabelled, type Group, type LyricsDoc } from "../../../core/lyrics";
import { Button, LabelChips } from "../../components/controls";
import { Icon } from "../../components/icons";
import { clock, plural } from "../../lib/format";
import { labelHue } from "../../lib/labels";
import { readLocal, writeLocal } from "../../lib/storage";

/** null = every group, "" = groups without labels, else one label. */
export type LabelFilter = string | null;

export function matchesFilter(group: Group, filter: LabelFilter): boolean {
  if (filter === null) return true;
  return filter === "" ? !isLabelled(group) : group.labels.includes(filter);
}

export function GroupsPane({
  doc,
  draftId,
  group,
  filter,
  setFilter,
  flags,
  onPick,
  onSplitParens,
}: {
  doc: LyricsDoc;
  draftId: string;
  group: number;
  filter: LabelFilter;
  setFilter: (f: LabelFilter) => void;
  flags: Flag[];
  onPick: (group: number) => void;
  onSplitParens: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const parens = countParenRuns(doc);
  const parensKey = `lrcgen.refine.parens:${draftId}`;
  const [parensDismissed, setParensDismissed] = useState(() => readLocal(parensKey) === "dismissed");

  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-group="${group}"]`)?.scrollIntoView({ block: "nearest" });
  }, [group]);

  const counts = new Map<string, number>();
  let unlabelled = 0;
  for (const g of doc.groups) {
    if (g.words.length === 0) continue;
    if (!isLabelled(g)) unlabelled++;
    for (const l of g.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const flagged = new Set(flags.map((f) => f.lineIndex));
  const words = doc.groups.reduce((n, g) => n + g.words.length, 0);
  const shown = doc.groups.map((g, i) => ({ g, i })).filter(({ g }) => g.words.length > 0 && matchesFilter(g, filter));

  const filterButton = (value: LabelFilter, text: string, n: number) => (
    <button key={value ?? "*"} type="button" className="refine-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>
      {value !== null && value !== "" && <span className="dot" style={{ background: labelHue(value) }} />}
      {text}
      <span className="n">{n}</span>
    </button>
  );

  return (
    <aside className="refine-groups" aria-label="Groups">
      <div className="refine-groups-head">
        <h2 className="eyebrow">Groups</h2>
        <span className="count">
          {plural(doc.groups.filter((g) => g.words.length > 0).length, "group")} · {plural(words, "word")}
        </span>
      </div>

      {parens > 0 && !parensDismissed && (
        <div className="refine-offer-card">
          <p>
            <strong>{plural(parens, "part")} in parentheses</strong> look like backing vocals and ad-libs sung with the line. Give them groups of their
            own?
          </p>
          <div className="actions">
            <Button variant="primary" size="xs" onClick={onSplitParens}>
              Split them out
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                writeLocal(parensKey, "dismissed");
                setParensDismissed(true);
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      )}

      <div className="refine-filters" role="group" aria-label="Show">
        {filterButton(null, "All", doc.groups.filter((g) => g.words.length > 0).length)}
        {counts.size > 0 && filterButton("", "Lines", unlabelled)}
        {[...counts].map(([label, n]) => filterButton(label, label, n))}
      </div>

      <ol className="refine-group-list" ref={list}>
        {shown.map(({ g, i }) => {
          const start = groupStart(g);
          const cls = ["refine-group-row", isLabelled(g) && "labelled", i === group && "selected", start === null && "untimed"].filter(Boolean).join(" ");
          return (
            <li key={g.id} data-group={i} className={cls} onClick={() => onPick(i)} aria-current={i === group ? "true" : undefined}>
              <span className="t">{start === null ? "––:––" : clock(start).replace(/^00:/, "0:")}</span>
              {isLabelled(g) && <span className="arrow">↳</span>}
              <span className="text">
                {groupText(g)}
                {flagged.has(i) && <Icon.Warning size={13} className="flag-icon" />}
              </span>
              {isLabelled(g) && <LabelChips labels={g.labels} small />}
            </li>
          );
        })}
        {shown.length === 0 && <li className="refine-group-empty">No groups {filter === "" ? "without labels" : `labelled “${filter}”`}.</li>}
      </ol>
    </aside>
  );
}
