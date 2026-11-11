import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConceptIndex } from "../../lib/types";
import { presentConcepts, type CaptionChip, type InsightGroup } from "../../studio/concepts";
import type { StudioItem } from "../../studio/types";
import { FrameStill } from "./FrameStill";

type Props = {
  items: StudioItem[];
  index: ConceptIndex | null;
  pending: boolean;
  onOpen: (id: string) => void;
  onShowFrames: (ids: string[], label: string) => void;
  onShowSubject: (value: string) => void;
  onShowPerson: (personId: string, name: string) => void;
  onRename: (personId: string, name: string) => void;
  onMerge: (keepId: string, dropId: string) => void;
  onSplit: (faceId: string) => void;
};

type Focus =
  | { type: "group"; id: string }
  | { type: "caption"; tag: string };

export function InsightsView({
  items,
  index,
  pending,
  onOpen,
  onShowFrames,
  onShowSubject,
  onShowPerson,
  onRename,
  onMerge,
  onSplit,
}: Props) {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const presented = useMemo(() => (pending ? null : presentConcepts(items, index)), [items, index, pending]);

  const filtered = useMemo(() => {
    if (!presented) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return presented;
    return {
      bursts: presented.bursts.filter((group) => groupMatches(group, needle)),
      semantic: presented.semantic.filter((group) => groupMatches(group, needle)),
      people: presented.people.filter((group) => groupMatches(group, needle)),
      captions: presented.captions.filter((chip) => chipMatches(chip, needle)),
    };
  }, [presented, query]);

  useEffect(() => {
    if (!filtered || !focus) return;
    const alive =
      focus.type === "caption"
        ? filtered.captions.some((chip) => chip.tag === focus.tag)
        : [...filtered.bursts, ...filtered.semantic, ...filtered.people].some((group) => group.id === focus.id);
    if (!alive) setFocus(null);
  }, [filtered, focus]);

  if (!filtered || !presented) {
    return (
      <div data-insights-view className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-mute">
        Reading clusters and captions…
      </div>
    );
  }

  const active = resolveFocus(filtered, focus);
  const total =
    presented.bursts.length + presented.semantic.length + presented.people.length + presented.captions.length;
  const visibleCount =
    filtered.bursts.length + filtered.semantic.length + filtered.people.length + filtered.captions.length;

  function selectGroup(id: string) {
    setFocus((current) => (current?.type === "group" && current.id === id ? null : { type: "group", id }));
  }

  function selectCaption(tag: string) {
    setFocus((current) => (current?.type === "caption" && current.tag === tag ? null : { type: "caption", tag }));
  }

  function reveal(target: { kind: InsightGroup["kind"] | "caption"; label: string; raw: string; personId: string | null; items: StudioItem[] }) {
    if (target.kind === "person" && target.personId) {
      onShowPerson(target.personId, target.label === "Unnamed" ? "Unnamed" : target.label);
      return;
    }
    if (target.kind === "semantic") {
      onShowSubject(target.raw);
      return;
    }
    onShowFrames(
      target.items.map((item) => item.id),
      target.label,
    );
  }

  return (
    <div data-insights-view className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-medium tracking-wide">AI Insights</h1>
            <p className="text-[11px] text-mute">
              {presented.bursts.length} collections · {presented.people.length} people · {presented.captions.length} captions
            </p>
          </div>
          <label className="ml-auto w-full sm:w-72">
            <span className="sr-only">Search captions, people, and collections</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search captions, people, and collections"
              className="w-full rounded-full border border-line bg-card px-3 py-1.5 text-sm outline-none placeholder:text-mute focus:border-teal"
            />
          </label>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {total === 0 ? (
          <EmptyState
            title="Nothing grouped yet"
            body="Shelf groups short sequences, people, and caption tags on this machine after the local vision pass."
          />
        ) : visibleCount === 0 ? (
          <EmptyState title="No matches" body={`Nothing in the library is captioned with “${query.trim()}”.`} />
        ) : (
          <div className="space-y-8">
            {active ? (
              <FocusTray
                title={active.label}
                summary={active.summary}
                caption={active.caption}
                items={active.items}
                personId={active.personId}
                onOpen={onOpen}
                onReveal={() => reveal(active)}
                onSplit={onSplit}
              />
            ) : null}

            {filtered.bursts.length > 0 ? (
              <Section
                title="Smart collections"
                hint="Sequences shot within a few minutes"
                count={filtered.bursts.length}
              >
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {filtered.bursts.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      data-burst={group.label}
                      aria-pressed={focus?.type === "group" && focus.id === group.id}
                      onClick={() => selectGroup(group.id)}
                      className={`w-60 shrink-0 rounded-2xl border p-2 text-left ${
                        focus?.type === "group" && focus.id === group.id
                          ? "border-teal bg-teal/5"
                          : "border-line bg-card hover:border-mute"
                      }`}
                    >
                      <Stack items={group.items} />
                      <p className="mt-2 truncate text-sm">{group.label}</p>
                      <p className="truncate text-[11px] text-mute">{group.summary}</p>
                    </button>
                  ))}
                </div>
              </Section>
            ) : null}

            {filtered.people.length > 0 ? (
              <Section title="People" hint="Name a cluster, or merge two" count={filtered.people.length}>
                {picked.length === 2 ? (
                  <button
                    type="button"
                    data-merge-people
                    onClick={() => {
                      onMerge(picked[0], picked[1]);
                      setPicked([]);
                    }}
                    className="mb-3 rounded-full border border-line px-3 py-1 text-xs hover:border-teal hover:text-teal"
                  >
                    Merge selected
                  </button>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.people.map((group) => {
                    const personId = group.personId ?? group.id;
                    const selected = focus?.type === "group" && focus.id === group.id;
                    return (
                      <article
                        key={group.id}
                        data-person={personId}
                        className={`rounded-2xl border bg-card p-2 ${selected ? "border-teal" : "border-line"}`}
                      >
                        <button type="button" onClick={() => selectGroup(group.id)} className="block w-full text-left">
                          <Stack items={group.items} />
                        </button>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={picked.includes(personId)}
                            onChange={() =>
                              setPicked((current) =>
                                current.includes(personId)
                                  ? current.filter((entry) => entry !== personId)
                                  : [...current, personId].slice(-2),
                              )
                            }
                            aria-label={`Select ${group.name ?? "unnamed person"}`}
                            className="accent-teal"
                          />
                          <input
                            data-person-name={personId}
                            value={drafts[personId] ?? group.name ?? ""}
                            placeholder="Name this person"
                            onChange={(event) => setDrafts((current) => ({ ...current, [personId]: event.target.value }))}
                            onBlur={() => {
                              const next = (drafts[personId] ?? group.name ?? "").trim();
                              if (next !== (group.name ?? "")) onRename(personId, next);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                            }}
                            className="h-8 min-w-0 flex-1 rounded-full border border-transparent bg-studio px-2 text-sm outline-none focus:border-line"
                          />
                          <span className="text-[11px] text-mute">{group.items.length}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </Section>
            ) : null}

            {filtered.captions.length > 0 ? (
              <Section title="Captions" hint="Search a tag to browse those frames" count={filtered.captions.length}>
                <div className="flex flex-wrap gap-1.5">
                  {filtered.captions.map((chip) => {
                    const selected = focus?.type === "caption" && focus.tag === chip.tag;
                    return (
                      <button
                        key={chip.tag}
                        type="button"
                        data-caption={chip.tag}
                        aria-pressed={selected}
                        onClick={() => selectCaption(chip.tag)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs ${
                          selected ? "border-teal bg-teal/15 text-teal" : "border-line hover:border-teal hover:text-teal"
                        }`}
                      >
                        {chip.label}
                        <span className={selected ? "text-teal/80" : "text-mute"}>{chip.count}</span>
                      </button>
                    );
                  })}
                </div>
              </Section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function FocusTray({
  title,
  summary,
  caption,
  items,
  personId,
  onOpen,
  onReveal,
  onSplit,
}: {
  title: string;
  summary: string;
  caption: string | null;
  items: StudioItem[];
  personId: string | null;
  onOpen: (id: string) => void;
  onReveal: () => void;
  onSplit: (faceId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <p className="text-[11px] text-mute">
            {summary}
            {caption ? ` · ${caption}` : ""}
          </p>
        </div>
        <button
          type="button"
          data-show-library
          onClick={onReveal}
          className="rounded-full border border-line px-2.5 py-1 text-[11px] hover:border-teal hover:text-teal"
        >
          Show in library
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
        {items.map((item) => (
          <div key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)} className="block w-full text-left" title={item.fileName}>
              <div className="aspect-square overflow-hidden rounded-xl border border-line bg-studio">
                <FrameStill id={item.id} fileName={item.fileName} src={item.previewUrl} />
              </div>
              <p className="mt-1 truncate text-[11px] text-mute">{item.fileName}</p>
            </button>
            {personId
              ? item.faces
                  .filter((face) => face.personId === personId)
                  .map((face) => (
                    <button
                      key={face.id}
                      type="button"
                      data-split={face.id}
                      onClick={() => onSplit(face.id)}
                      className="mt-0.5 text-[10px] text-mute hover:text-foam"
                    >
                      Split
                    </button>
                  ))
              : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-[0.16em] text-mute">{title}</h2>
        <span className="text-[11px] text-mute">{count}</span>
      </div>
      <p className="mb-3 text-[11px] text-mute">{hint}</p>
      {children}
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
      <p className="text-sm">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-mute">{body}</p>
    </div>
  );
}

function Stack({ items }: { items: StudioItem[] }) {
  const preview = items.slice(0, 3);
  return (
    <div className="relative h-28">
      {preview.map((item, index) => (
        <div
          key={item.id}
          className="absolute top-1 h-24 overflow-hidden rounded-xl border border-line bg-studio"
          style={{ left: `${index * 12}%`, width: "76%", zIndex: preview.length - index }}
        >
          <FrameStill id={item.id} fileName="" src={item.previewUrl} />
        </div>
      ))}
    </div>
  );
}

function resolveFocus(
  presented: ReturnType<typeof presentConcepts>,
  focus: Focus | null,
): { kind: InsightGroup["kind"] | "caption"; label: string; summary: string; caption: string | null; raw: string; personId: string | null; items: StudioItem[] } | null {
  if (!focus) return null;
  if (focus.type === "caption") {
    const chip = presented.captions.find((entry) => entry.tag === focus.tag);
    if (!chip) return null;
    return {
      kind: "caption",
      label: chip.label,
      summary: chip.count === 1 ? "1 frame" : `${chip.count} frames`,
      caption: chip.caption,
      raw: chip.tag,
      personId: null,
      items: chip.items,
    };
  }
  const group = [...presented.bursts, ...presented.semantic, ...presented.people].find((entry) => entry.id === focus.id);
  if (!group) return null;
  return {
    kind: group.kind,
    label: group.label,
    summary: group.summary,
    caption: null,
    raw: group.raw,
    personId: group.personId,
    items: group.items,
  };
}

function groupMatches(group: InsightGroup, needle: string): boolean {
  const haystack = [group.label, group.summary, group.raw, ...group.items.map((item) => item.fileName)].join(" ").toLowerCase();
  return haystack.includes(needle);
}

function chipMatches(chip: CaptionChip, needle: string): boolean {
  return `${chip.tag} ${chip.label} ${chip.caption}`.toLowerCase().includes(needle);
}
