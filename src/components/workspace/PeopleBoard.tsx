import { useMemo, useState } from "react";
import { frameBackground } from "../../studio/catalog";
import type { FaceMark, StudioItem } from "../../studio/types";

type Cluster = {
  id: string;
  name: string | null;
  faces: { faceId: string; item: StudioItem }[];
};

type Props = {
  items: StudioItem[];
  onRename: (personId: string, name: string) => void;
  onMerge: (keepId: string, dropId: string) => void;
  onSplit: (faceId: string) => void;
  onOpen: (item: StudioItem) => void;
  onSubject: (label: string) => void;
};

export function PeopleBoard({ items, onRename, onMerge, onSplit, onOpen, onSubject }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);

  const clusters = useMemo(() => clusterPeople(items), [items]);
  const subjects = useMemo(() => collectSubjects(items), [items]);

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(-2)));
  }

  return (
    <div data-people-board className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section className="border-b border-line px-5 py-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">People</h2>
          <span className="text-[11px] text-mute">{clusters.length} identities</span>
        </div>
        {picked.length === 2 ? (
          <button
            type="button"
            data-merge-people
            onClick={() => {
              onMerge(picked[0], picked[1]);
              setPicked([]);
            }}
            className="mb-3 inline-flex h-8 items-center gap-2 rounded-full border border-line px-3 text-xs hover:border-teal hover:text-teal"
          >
            Merge selected
          </button>
        ) : null}
        {clusters.length === 0 ? (
          <p className="text-sm text-mute">No faces yet. Shelf looks for people after each import.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {clusters.map((cluster) => (
              <article key={cluster.id} data-person={cluster.id} className="rounded-xl border border-line bg-card p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.includes(cluster.id)}
                    onChange={() => toggle(cluster.id)}
                    aria-label={`Select ${cluster.name ?? "unnamed person"}`}
                    className="accent-teal"
                  />
                  <input
                    data-person-name={cluster.id}
                    value={drafts[cluster.id] ?? cluster.name ?? ""}
                    placeholder="Name this person"
                    onChange={(event) => setDrafts((current) => ({ ...current, [cluster.id]: event.target.value }))}
                    onBlur={() => {
                      const next = (drafts[cluster.id] ?? cluster.name ?? "").trim();
                      if (next !== (cluster.name ?? "")) onRename(cluster.id, next);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                    }}
                    className="h-8 min-w-0 flex-1 rounded-full border border-transparent bg-transparent px-2 text-sm outline-none focus:border-line focus:bg-studio"
                  />
                  <span className="text-[11px] text-mute">{cluster.faces.length}</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {cluster.faces.map(({ faceId, item }) => {
                    const face = item.faces.find((entry) => entry.id === faceId);
                    return (
                      <div key={faceId} className="w-[72px] shrink-0">
                        <button type="button" data-face={faceId} onClick={() => onOpen(item)} className="block overflow-hidden rounded-lg" title={item.fileName}>
                          <FaceCrop item={item} face={face} />
                        </button>
                        <button
                          type="button"
                          data-split={faceId}
                          onClick={() => onSplit(faceId)}
                          className="mt-1 w-full text-[10px] text-mute hover:text-foam"
                        >
                          Split
                        </button>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="px-5 py-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Pets and places</h2>
          <span className="text-[11px] text-mute">{subjects.length} tags</span>
        </div>
        {subjects.length === 0 ? (
          <p className="text-sm text-mute">Animal and scene tags appear here once a frame has been read.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <button
                key={subject.label}
                type="button"
                data-subject={subject.label}
                onClick={() => onSubject(subject.label)}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-line px-3 text-xs hover:border-teal hover:text-teal"
              >
                {titleCase(subject.label)}
                <span className="text-mute">{subject.count}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FaceCrop({ item, face }: { item: StudioItem; face?: FaceMark }) {
  if (item.previewUrl && face && face.width > 0 && face.height > 0) {
    const scaleX = 100 / face.width;
    const scaleY = 100 / face.height;
    return (
      <div className="relative aspect-square w-full overflow-hidden bg-studio">
        <img
          src={item.previewUrl}
          alt=""
          className="absolute max-w-none"
          style={{
            width: `${scaleX}%`,
            height: `${scaleY}%`,
            left: `${-face.x * scaleX}%`,
            top: `${-face.y * scaleY}%`,
          }}
        />
      </div>
    );
  }
  return <div className="aspect-square w-full" style={{ background: frameBackground(item.id) }} />;
}

function clusterPeople(items: StudioItem[]): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const item of items) {
    for (const face of item.faces) {
      const cluster = map.get(face.personId) ?? { id: face.personId, name: face.name, faces: [] };
      cluster.name = face.name;
      cluster.faces.push({ faceId: face.id, item });
      map.set(face.personId, cluster);
    }
  }
  return [...map.values()].sort((a, b) => b.faces.length - a.faces.length || (a.name ?? "zzz").localeCompare(b.name ?? "zzz"));
}

function collectSubjects(items: StudioItem[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const subject of item.subjects) {
      const key = subject.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
