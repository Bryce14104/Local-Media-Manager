import { Modal } from "./AddMediaModal";

const SECTIONS = [
  {
    title: "Ingest",
    body: "Add media, then index in place or copy new files onto this Mac. Download copies full-resolution originals into a folder on the computer so they stay after you eject the card.",
  },
  {
    title: "Cull",
    body: "Enter fullscreen. J/K move, P pick, X reject, 1–5 rate, Z or hold for 1:1, C two-up. Needs a look flags blur, dark, and near-dupes. Nothing deletes itself.",
  },
  {
    title: "Smart Search",
    body: "On, a sentence searches objects, people, and places on this machine. Off, it matches file names. Aliases like mum live in Preferences.",
  },
  {
    title: "Develop",
    body: "Edits are JSON on the catalog row. RAW, DNG, and camera files are never overwritten. Profiles start a grade; masks limit sky, subject, or a brush to part of the frame. Save JPEG to bake a copy.",
  },
  {
    title: "Travel",
    body: "Export a travel pack of 720p previews plus a catalog slice. Open that library on the Air. Plug the archive disk back in at home to finish keepers.",
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How Shelf works" onClose={onClose} wide>
      <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="text-sm font-medium">{section.title}</h3>
            <p className="mt-1 text-sm text-mute">{section.body}</p>
          </section>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
          Close
        </button>
      </div>
    </Modal>
  );
}
