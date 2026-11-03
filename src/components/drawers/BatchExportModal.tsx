import { useState } from "react";
import { Modal } from "./AddMediaModal";

type BatchExportModalProps = {
  count: number;
  onClose: () => void;
  onExport: (format: string, destination: string) => void;
};

export function BatchExportModal({ count, onClose, onExport }: BatchExportModalProps) {
  const [format, setFormat] = useState("JPEG");
  const [destination, setDestination] = useState("Exports/shelf");

  return (
    <Modal title="Batch export" onClose={onClose}>
      <p className="text-sm text-mute">
        {count === 0
          ? "Nothing is selected. Export will queue the frames currently in view."
          : `${count} selected frame${count === 1 ? "" : "s"} will be queued.`}
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onExport(format, destination.trim() || "Exports/shelf");
        }}
      >
        <label className="block text-xs text-mute" htmlFor="export-format">
          Format
        </label>
        <select
          id="export-format"
          value={format}
          onChange={(event) => setFormat(event.target.value)}
          className="w-full rounded-xl border border-line bg-studio px-3 py-2 text-sm outline-none focus:border-teal"
          autoFocus
        >
          <option>JPEG</option>
          <option>TIFF</option>
          <option>Original</option>
        </select>
        <label className="block text-xs text-mute" htmlFor="export-dest">
          Destination
        </label>
        <input
          id="export-dest"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          className="w-full rounded-xl border border-line bg-studio px-3 py-2 text-sm outline-none focus:border-teal"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm text-mute">
            Cancel
          </button>
          <button type="submit" className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
            Queue export
          </button>
        </div>
      </form>
    </Modal>
  );
}
