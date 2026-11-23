import { openBetaFeedback } from "../../lib/beta";
import { Modal } from "./AddMediaModal";

export function BetaExpiredModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Shelf beta has ended" onClose={onClose} layer="top">
      <p className="text-sm text-mute">
        Thanks for testing the Shelf beta. You can still browse and export everything already in this library.
        New imports and library actions are locked until a newer build.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void openBetaFeedback()}
          className="rounded-full border border-teal/50 px-4 py-2 text-sm text-teal hover:bg-teal/10"
        >
          Send feedback
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink"
        >
          Keep viewing
        </button>
      </div>
    </Modal>
  );
}
