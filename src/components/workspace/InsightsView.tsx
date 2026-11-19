import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConceptIndex } from "../../lib/types";
import { libraryOverview, presentConcepts, type InsightGroup, type LibraryBucket } from "../../studio/concepts";
import type { StudioItem } from "../../studio/types";
import { tripGroups } from "../../studio/trips";
import { FrameStill } from "./FrameStill";

type Props = {
  items: StudioItem[];
  index: ConceptIndex | null;
  pending: boolean;
  onOpen: (id: string) => void;
  onShowFrames: (ids: string[], label: string) => void;
  onShowSubject: (value: string) => void;
  onShowPerson?: (personId: string, name: string) => void;
  onRenamePerson?: (personId: string, name: string) => void;
  onMergePeople?: (keepId: string, dropId: string) => void;
  onSplitFace?: (faceId: string) => void;
};

type Focus = { type: "burst"; id: string } | { type: "bucket"; id: string };

export function InsightsView({
  items,
  index,
  pending,
  onOpen,
  onShowFrames,
  onShowSubject,
  onShowPerson,
  onRenamePerson,
  onMergePeople,
  onSplitFace,
}: Props) {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [pickedPeople, setPickedPeople] = useState<string[]>([]);
  const people = useMemo(() => {
    const map = new Map<string, { id: string; name: string; items: StudioItem[] }>();
    for (const item of items) {
      for (const face of item.faces) {
        const name = face.name?.trim() || "Unnamed person";
        const current = map.get(face.personId) ?? { id: face.personId, name, items: [] };
        if (!current.items.some((row) => row.id === item.id)) current.items.push(item);
        current.name = face.name?.trim() || current.name;
        map.set(face.personId, current);
      }
    }
    return [...map.values()].sort((left, right) => right.items.length - left.items.length);
  }, [items]);
  const trips = useMemo(() => tripGroups(items), [items]);
  const presented = useMemo(() => (pending ? null : presentConcepts(items, index)), [items, index, pending]);
  const overview = useMemo(() => (pending ? null : libraryOverview(items)), [items, pending]);

  const filtered = useMemo(() => {
    if (!presented || !overview) return null;
    const needle = query.trim().toLowerCase();
    const match = (label: string, summary: string, files: StudioItem[]) => {
      if (!needle) return true;
      return [label, summary, ...files.map((item) => item.fileName)].join(" ").toLowerCase().includes(needle);
    };
    return {
      bursts: presented.bursts.filter((group) => match(group.label, group.summary, group.items)),
      cameras: overview.cameras.filter((bucket) => match(bucket.label, bucket.summary, bucket.items)),
      scenes: overview.scenes.filter((bucket) => match(bucket.label, bucket.summary, bucket.items)),
      folders: overview.folders.filter((bucket) => match(bucket.label, bucket.summary, bucket.items)),
      months: overview.months.filter((bucket) => match(bucket.label, bucket.summary, bucket.items)),
    };
  }, [overview, presented, query]);

  useEffect(() => {
    if (!filtered || !focus) return;
    const alive =
      focus.type === "burst"
        ? filtered.bursts.some((group) => group.id === focus.id)
        : [...filtered.cameras, ...filtered.scenes, ...filtered.folders, ...filtered.months].some(
            (bucket) => bucket.id === focus.id,
          );
    if (!alive) setFocus(null);
  }, [filtered, focus]);

  if (!filtered || !presented || !overview) {
    return (
      <div data-insights-view className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-mute">
        Reading the library…
      </div>
    );
  }

  const active = resolveFocus(filtered, focus);
  const visibleCount =
    people.length +
    trips.length +
    filtered.bursts.length +
    filtered.cameras.length +
    filtered.scenes.length +
    filtered.folders.length +
    filtered.months.length;

  function reveal(target: { kind: string; raw: string; label: string; items: StudioItem[] }) {
    if (target.kind === "scene") {
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
              {items.length} files · {overview.cameras.length} cameras · {overview.videos} videos · {overview.geotagged}{" "}
              with GPS
            </p>
          </div>
          <label className="ml-auto w-full sm:w-72">
            <span className="sr-only">Search collections</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cameras, scenes, folders"
              className="w-full rounded-full border border-line bg-card px-3 py-1.5 text-sm outline-none placeholder:text-mute focus:border-teal"
            />
          </label>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Stills" value={overview.stills} />
          <Stat label="RAW" value={overview.raw} />
          <Stat label="Rated" value={overview.rated} />
          <Stat label="Scenes" value={overview.scenes.length} />
          <Stat label="Folders" value={overview.folders.length} />
        </dl>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {visibleCount === 0 ? (
          <EmptyState
            title={query.trim() ? "No matches" : "Nothing grouped yet"}
            body={
              query.trim()
                ? `Nothing matches “${query.trim()}”.`
                : "Add media and Shelf will group bursts, cameras, scenes, and folders here."
            }
          />
        ) : (
          <div className="space-y-8">
            {active ? (
              <FocusTray
                title={active.label}
                summary={active.summary}
                items={active.items}
                onOpen={onOpen}
                onReveal={() => reveal(active)}
              />
            ) : null}

            {people.length > 0 ? (
              <Section title="People" hint="Name, merge, or split a cluster. Search uses the name." count={people.length}>
                <Row>
                  {people.map((person) => (
                    <GroupCard
                      key={person.id}
                      pressed={pickedPeople.includes(person.id)}
                      items={person.items}
                      label={person.name}
                      summary={`${person.items.length} photos`}
                      onClick={() => {
                        setPickedPeople((current) =>
                          current.includes(person.id)
                            ? current.filter((id) => id !== person.id)
                            : [...current, person.id].slice(-2),
                        );
                      }}
                    />
                  ))}
                </Row>
                <div className="mt-2 flex flex-wrap gap-2">
                  {onShowPerson && pickedPeople[0] ? (
                    <button
                      type="button"
                      className="text-xs text-mute hover:text-foam"
                      onClick={() => {
                        const person = people.find((row) => row.id === pickedPeople[0]);
                        if (person) onShowPerson(person.id, person.name);
                      }}
                    >
                      Show in library
                    </button>
                  ) : null}
                  {onRenamePerson && (people.find((person) => pickedPeople.includes(person.id)) ?? people[0]) ? (
                    <button
                      type="button"
                      className="text-xs text-mute hover:text-foam"
                      onClick={() => {
                        const person = people.find((row) => pickedPeople.includes(row.id)) ?? people[0];
                        const name = window.prompt("Name this person", person?.name ?? "");
                        if (name && person) onRenamePerson(person.id, name);
                      }}
                    >
                      Rename
                    </button>
                  ) : null}
                  {onMergePeople && pickedPeople.length === 2 ? (
                    <button
                      type="button"
                      className="text-xs text-mute hover:text-foam"
                      onClick={() => {
                        const keep = pickedPeople[0];
                        const drop = pickedPeople[1];
                        if (keep && drop) onMergePeople(keep, drop);
                        setPickedPeople([]);
                      }}
                    >
                      Merge selected
                    </button>
                  ) : null}
                  {onSplitFace && pickedPeople[0] ? (
                    <button
                      type="button"
                      className="text-xs text-mute hover:text-foam"
                      onClick={() => {
                        const person = people.find((row) => row.id === pickedPeople[0]);
                        const face = person?.items.flatMap((item) => item.faces).find((mark) => mark.personId === person.id);
                        if (face) onSplitFace(face.id);
                      }}
                    >
                      Split one face
                    </button>
                  ) : null}
                </div>
              </Section>
            ) : null}

            {trips.length > 0 ? (
              <Section title="Trips" hint="GPS clusters a day or two apart" count={trips.length}>
                <Row>
                  {trips.map((trip) => (
                    <GroupCard
                      key={trip.id}
                      pressed={false}
                      items={trip.items}
                      label={trip.label}
                      summary={trip.summary}
                      onClick={() => onShowFrames(trip.items.map((item) => item.id), trip.label)}
                    />
                  ))}
                </Row>
              </Section>
            ) : null}

            {filtered.bursts.length > 0 ? (
              <Section title="Smart collections" hint="Sequences shot within a few minutes" count={filtered.bursts.length}>
                <Row>
                  {filtered.bursts.map((group) => (
                    <GroupCard
                      key={group.id}
                      pressed={focus?.type === "burst" && focus.id === group.id}
                      items={group.items}
                      label={group.label}
                      summary={group.summary}
                      onClick={() =>
                        setFocus((current) =>
                          current?.type === "burst" && current.id === group.id ? null : { type: "burst", id: group.id },
                        )
                      }
                    />
                  ))}
                </Row>
              </Section>
            ) : null}

            {filtered.scenes.length > 0 ? (
              <Section title="Scenes" hint="What the local vision model tagged in the roll" count={filtered.scenes.length}>
                <ChipRow
                  buckets={filtered.scenes}
                  selectedId={focus?.type === "bucket" ? focus.id : null}
                  onSelect={(id) =>
                    setFocus((current) => (current?.type === "bucket" && current.id === id ? null : { type: "bucket", id }))
                  }
                />
              </Section>
            ) : null}

            {filtered.cameras.length > 0 ? (
              <Section title="Cameras" hint="Jump to every frame from a body" count={filtered.cameras.length}>
                <Row>
                  {filtered.cameras.map((bucket) => (
                    <GroupCard
                      key={bucket.id}
                      pressed={focus?.type === "bucket" && focus.id === bucket.id}
                      items={bucket.items}
                      label={bucket.label}
                      summary={bucket.summary}
                      onClick={() =>
                        setFocus((current) =>
                          current?.type === "bucket" && current.id === bucket.id ? null : { type: "bucket", id: bucket.id },
                        )
                      }
                    />
                  ))}
                </Row>
              </Section>
            ) : null}

            {filtered.folders.length > 0 ? (
              <Section title="Folders" hint="Where the files live on disk" count={filtered.folders.length}>
                <ChipRow
                  buckets={filtered.folders}
                  selectedId={focus?.type === "bucket" ? focus.id : null}
                  onSelect={(id) =>
                    setFocus((current) => (current?.type === "bucket" && current.id === id ? null : { type: "bucket", id }))
                  }
                />
              </Section>
            ) : null}

            {filtered.months.length > 0 ? (
              <Section title="Months" hint="Capture time" count={filtered.months.length}>
                <ChipRow
                  buckets={filtered.months}
                  selectedId={focus?.type === "bucket" ? focus.id : null}
                  onSelect={(id) =>
                    setFocus((current) => (current?.type === "bucket" && current.id === id ? null : { type: "bucket", id }))
                  }
                />
              </Section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-mute">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

function FocusTray({
  title,
  summary,
  items,
  onOpen,
  onReveal,
}: {
  title: string;
  summary: string;
  items: StudioItem[];
  onOpen: (id: string) => void;
  onReveal: () => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <p className="text-[11px] text-mute">{summary}</p>
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
          <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="block w-full text-left" title={item.fileName}>
            <div className="aspect-square overflow-hidden rounded-xl border border-line bg-studio">
              <FrameStill id={item.id} fileName={item.fileName} src={item.previewUrl} />
            </div>
            <p className="mt-1 truncate text-[11px] text-mute">{item.fileName}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function Section({ title, hint, count, children }: { title: string; hint: string; count: number; children: ReactNode }) {
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

function Row({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 overflow-x-auto pb-1">{children}</div>;
}

function GroupCard({
  pressed,
  items,
  label,
  summary,
  onClick,
}: {
  pressed: boolean;
  items: StudioItem[];
  label: string;
  summary: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`w-60 shrink-0 rounded-2xl border p-2 text-left ${
        pressed ? "border-teal bg-teal/5" : "border-line bg-card hover:border-mute"
      }`}
    >
      <Stack items={items} />
      <p className="mt-2 truncate text-sm">{label}</p>
      <p className="truncate text-[11px] text-mute">{summary}</p>
    </button>
  );
}

function ChipRow({
  buckets,
  selectedId,
  onSelect,
}: {
  buckets: LibraryBucket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {buckets.map((bucket) => {
        const selected = selectedId === bucket.id;
        return (
          <button
            key={bucket.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(bucket.id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs ${
              selected ? "border-teal bg-teal/15 text-teal" : "border-line hover:border-teal hover:text-teal"
            }`}
          >
            {bucket.label}
            <span className={selected ? "text-teal/80" : "text-mute"}>{bucket.items.length}</span>
          </button>
        );
      })}
    </div>
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
  filtered: {
    bursts: InsightGroup[];
    cameras: LibraryBucket[];
    scenes: LibraryBucket[];
    folders: LibraryBucket[];
    months: LibraryBucket[];
  },
  focus: Focus | null,
): { kind: string; label: string; summary: string; raw: string; items: StudioItem[] } | null {
  if (!focus) return null;
  if (focus.type === "burst") {
    const group = filtered.bursts.find((entry) => entry.id === focus.id);
    if (!group) return null;
    return { kind: "burst", label: group.label, summary: group.summary, raw: group.raw, items: group.items };
  }
  const bucket = [...filtered.cameras, ...filtered.scenes, ...filtered.folders, ...filtered.months].find(
    (entry) => entry.id === focus.id,
  );
  if (!bucket) return null;
  return { kind: bucket.kind, label: bucket.label, summary: bucket.summary, raw: bucket.raw, items: bucket.items };
}
