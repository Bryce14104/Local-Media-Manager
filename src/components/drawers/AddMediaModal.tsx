import { useState, type ReactNode } from "react";
import type { MediaFormat } from "../../studio/types";

type AddMediaModalProps = {
  onClose: () => void;
  onAdd: (folder: string, format: MediaFormat) => void;
};

export function AddMediaModal({ onClose, onAdd }: AddMediaModalProps) {
  const [folder, setFolder] = useState("Archive/Inbox");
  const [format, setFormat] = useState<MediaFormat>("raw");

  return (
    <Modal title="Add media" onClose={onClose}>
      <p className="text-sm text-mute">
        This preview indexes a mock folder into the workspace. The files stay where they are.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(folder.trim() || "Archive/Inbox", format);
        }}
      >
        <label className="block text-xs text-mute" htmlFor="add-folder">
          Folder
        </label>
        <input
          id="add-folder"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          className="w-full rounded-xl border border-line bg-studio px-3 py-2 text-sm outline-none focus:border-teal"
          autoFocus
        />
        <label className="block text-xs text-mute" htmlFor="add-format">
          Kind
        </label>
        <select
          id="add-format"
          value={format}
          onChange={(event) => setFormat(event.target.value as MediaFormat)}
          className="w-full rounded-xl border border-line bg-studio px-3 py-2 text-sm outline-none focus:border-teal"
        >
          <option value="raw">RAW</option>
          <option value="jpg">JPG</option>
          <option value="video">Video</option>
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm text-mute">
            Cancel
          </button>
          <button type="submit" className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
            Index folder
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-line bg-card p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-medium">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
