import { useState } from "react";
import { Modal } from "./AddMediaModal";

const TOPICS = [
  {
    id: "start",
    title: "Start here",
    steps: [
      "Add media picks a folder. Shelf indexes the files where they already are, or copies new ones onto this Mac first.",
      "Download copies full-resolution originals into a folder on this computer so they stay after you eject the card.",
      "Nothing is deleted unless you choose Delete files.",
    ],
  },
  {
    id: "search",
    title: "Find a photo",
    steps: [
      "Type in the search field at the top.",
      "Smart Search on: a sentence like “dog on the beach” uses tags on this machine.",
      "Smart Search off: it only matches file names and paths.",
      "Names like mum live under Preferences → people aliases.",
    ],
  },
  {
    id: "grid",
    title: "Buttons on the grid",
    steps: [
      "One per burst: a burst is many frames a second apart. On, the grid shows one tile per burst instead of every shot.",
      "Review: photos the preview is not sure about. It does not delete anything.",
      "These are filters. They do not delete anything.",
    ],
  },
  {
    id: "cull",
    title: "Pick keepers",
    steps: [
      "Open a photo, then Full screen.",
      "J / K move. P pick. X reject. 1–5 rate.",
      "Z or hold the frame for 1:1. Drag to pan. C is two-up.",
      "Picks and rejects are flags on the catalog. The file stays on disk.",
    ],
  },
  {
    id: "develop",
    title: "Edit a photo",
    steps: [
      "Edit opens Develop. Sliders, profiles, and masks are saved on the catalog row as JSON.",
      "The RAW, DNG, or camera file is never overwritten.",
      "Sky / Subject / Brush limits the grade to part of the frame on the preview.",
      "Save JPEG writes a new file. That is the only baked copy.",
    ],
  },
  {
    id: "files",
    title: "Travel and disks",
    steps: [
      "Preferences can export a travel pack: a catalog slice plus 720p previews. Open that library on the Air.",
      "Plug the archive disk back in at home. Relink if the path moved.",
      "Write XMP puts rating, keywords, and GPS beside the original for Lightroom or Photo Mechanic.",
    ],
  },
] as const;

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [topicId, setTopicId] = useState<(typeof TOPICS)[number]["id"]>("start");
  const topic = TOPICS.find((entry) => entry.id === topicId) ?? TOPICS[0];

  return (
    <Modal title="Help" onClose={onClose} wide>
      <p className="text-sm text-mute">Pick a topic. Short steps, not a manual.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TOPICS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTopicId(entry.id)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              entry.id === topic.id ? "bg-teal font-medium text-teal-ink" : "border border-line text-mute hover:text-foam"
            }`}
          >
            {entry.title}
          </button>
        ))}
      </div>
      <div className="mt-4 max-h-[50vh] overflow-auto pr-1">
        <h3 className="text-sm font-medium">{topic.title}</h3>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-foam/90">
          {topic.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
          Close
        </button>
      </div>
    </Modal>
  );
}
