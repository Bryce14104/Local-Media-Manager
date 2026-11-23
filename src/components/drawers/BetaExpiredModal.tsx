import { openUrl } from "@tauri-apps/plugin-opener";
import { BETA_FEEDBACK_URL } from "../../lib/beta";
import { desktopBridgeAvailable } from "../../lib/api";
import { Modal } from "./AddMediaModal";

export function BetaExpiredModal({ onClose }: { onClose: () => void }) {
  async function openFeedback() {
    try {
      if (desktopBridgeAvailable()) {
        await openUrl(BETA_FEEDBACK_URL);
        return;
      }
      window.open(BETA_FEEDBACK_URL, "_blank", "noopener,noreferrer");
    } catch {
      window.open(BETA_FEEDBACK_URL, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Modal title="Shelf beta has ended" onClose={onClose} layer="top">
      <p className="text-sm text-mute">
        Thanks for testing the Shelf beta. You can still browse and export everything already in this library.
        New imports and library actions are locked until a newer build.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void openFeedback()}
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
