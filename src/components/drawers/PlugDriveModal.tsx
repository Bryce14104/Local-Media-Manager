import { Modal } from "./AddMediaModal";

type PlugDriveModalProps = {
  hint: string;
  onClose: () => void;
};

export function PlugDriveModal({ hint, onClose }: PlugDriveModalProps) {
  return (
    <Modal title="Original is on another disk" onClose={onClose}>
      <p className="text-sm text-mute">{hint}</p>
      <p className="mt-3 text-sm text-mute">
        Shelf is showing the 720p still or 3 fps clip stored on this computer. Plug that drive back in to open, export, or reveal the full file.
      </p>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
          Keep browsing
        </button>
      </div>
    </Modal>
  );
}
