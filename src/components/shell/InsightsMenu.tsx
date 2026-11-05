import { useMemo, useState } from "react";
import { matchesFilters } from "../../studio/query";
import type { StudioItem } from "../../studio/types";

type Cluster = {
  id: string;
  name: string | null;
  faceId: string;
  count: number;
};

type Group = {
  id: string;
  title: string;
  hint: string;
  items: { label: string; value: string }[];
};

const GROUPS: Group[] = [
  {
    id: "pets",
    title: "Pets and wildlife",
    hint: "Dogs, cats, birds, and other fauna",
    items: [
      { label: "Dogs", value: "dog" },
      { label: "Cats", value: "cat" },
      { label: "Birds", value: "bird" },
      { label: "Fauna", value: "wildlife" },
    ],
  },
  {
    id: "scenes",
    title: "Scenes and environments",
    hint: "Beaches, sunsets, and aerials",
    items: [
      { label: "Beaches", value: "beach" },
      { label: "Sunsets", value: "sunset" },
      { label: "Aerials", value: "drone" },
      { label: "Water", value: "water" },
    ],
  },
  {
    id: "objects",
    title: "Objects and structures",
    hint: "Lighthouses, vehicles, and architecture",
    items: [
      { label: "Lighthouses", value: "lighthouse" },
      { label: "Boats", value: "boat" },
      { label: "Vehicles", value: "vehicle" },
      { label: "Architecture", value: "architecture" },
    ],
  },
];

type Props = {
  items: StudioItem[];
  onSubject: (value: string) => void;
  onPerson: (personId: string, name: string) => void;
  onRename: (personId: string, name: string) => void;
  onMerge: (keepId: string, dropId: string) => void;
  onSplit: (faceId: string) => void;
};

export function InsightsMenu({ items, onSubject, onPerson, onRename, onMerge, onSplit }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const clusters = useMemo(() => clusterPeople(items), [items]);

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(-2)));
  }

  return (
    <div
      data-insights-panel
      role="menu"
      className="absolute left-0 top-[calc(100%+0.4rem)] z-40 max-h-[70vh] w-[min(100vw-1.5rem,26rem)] overflow-y-auto rounded-2xl border border-line bg-card p-3 shadow-2xl shadow-black/40"
    >
      <section className="border-b border-line pb-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-xs uppercase tracking-[0.16em] text-mute">People</h2>
          <button
            type="button"
            data-insight-subject="person"
            onClick={() => onSubject("person")}
            className="text-[11px] text-teal hover:underline"
          >
            All faces
          </button>
        </div>
        <p className="mb-2 text-[11px] text-mute">Name a cluster, then show its frames.</p>
        {picked.length === 2 ? (
          <button
            type="button"
            data-merge-people
            onClick={() => {
              onMerge(picked[0], picked[1]);
              setPicked([]);
            }}
            className="mb-2 rounded-full border border-line px-2.5 py-1 text-[11px] hover:border-teal hover:text-teal"
          >
            Merge selected
          </button>
        ) : null}
        {clusters.length === 0 ? (
          <p className="text-xs text-mute">No faces yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {clusters.map((cluster) => (
              <li key={cluster.id} className="flex items-center gap-2">
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
                  className="h-7 min-w-0 flex-1 rounded-full border border-transparent bg-studio px-2 text-xs outline-none focus:border-line"
                />
                <button
                  type="button"
                  data-insight-person={cluster.id}
                  onClick={() => onPerson(cluster.id, (drafts[cluster.id] ?? cluster.name ?? "").trim() || cluster.name || "Unnamed")}
                  className="rounded-full border border-line px-2 py-1 text-[11px] text-mute hover:border-teal hover:text-teal"
                >
                  {cluster.count}
                </button>
                <button
                  type="button"
                  data-split={cluster.faceId}
                  onClick={() => onSplit(cluster.faceId)}
                  className="text-[10px] text-mute hover:text-foam"
                >
                  Split
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {GROUPS.map((group) => (
        <section key={group.id} className="border-b border-line py-3 last:border-b-0 last:pb-0">
          <h2 className="text-xs uppercase tracking-[0.16em] text-mute">{group.title}</h2>
          <p className="mb-2 mt-1 text-[11px] text-mute">{group.hint}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item) => {
              const count = items.filter((frame) =>
                matchesFilters(frame, [{ kind: "subject", value: item.value, id: item.value }]),
              ).length;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="menuitem"
                  data-insight-subject={item.value}
                  onClick={() => onSubject(item.value)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs hover:border-teal hover:text-teal"
                >
                  {item.label}
                  <span className="text-mute">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function clusterPeople(items: StudioItem[]): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const item of items) {
    for (const face of item.faces) {
      const cluster = map.get(face.personId) ?? {
        id: face.personId,
        name: face.name,
        faceId: face.id,
        count: 0,
      };
      cluster.name = face.name;
      cluster.count += 1;
      map.set(face.personId, cluster);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.name ?? "zzz").localeCompare(b.name ?? "zzz"));
}
