import type { FlagStatus } from "../../studio/types";

type SelectionBarProps = {
  count: number;
  canDelete: boolean;
  onFlag: (flag: FlagStatus) => void;
  onRate: (rating: number | null) => void;
  onRotate: () => void;
  onExport: () => void;
  onRemove: () => void;
  onDelete: () => void;
  onClear: () => void;
};

export function SelectionBar({
  count,
  canDelete,
  onFlag,
  onRate,
  onRotate,
  onExport,
  onRemove,
  onDelete,
  onClear,
}: SelectionBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-[#2ee0c5]/40 bg-[#171b22] px-2 py-1.5 shadow-2xl shadow-black/40">
        <span className="px-2 font-mono text-xs text-[#2ee0c5]">{count} selected</span>
        <BarButton label="Pick" onClick={() => onFlag("pick")} />
        <BarButton label="Reject" onClick={() => onFlag("reject")} />
        <BarButton label="★1" onClick={() => onRate(1)} />
        <BarButton label="★5" onClick={() => onRate(5)} />
        <BarButton label="Unrate" onClick={() => onRate(null)} />
        <BarButton label="Rotate" onClick={onRotate} />
        <BarButton label="Export copies" onClick={onExport} />
        <BarButton label="Remove from app" onClick={onRemove} />
        <BarButton label="Delete from disk" onClick={onDelete} disabled={!canDelete} />
        <BarButton label="Clear" onClick={onClear} />
      </div>
    </div>
  );
}

function BarButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-2.5 py-1 text-xs text-foam hover:bg-white/5 disabled:cursor-not-allowed disabled:text-mute"
    >
      {label}
    </button>
  );
}
