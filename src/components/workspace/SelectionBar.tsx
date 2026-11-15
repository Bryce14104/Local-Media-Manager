type SelectionBarProps = {
  count: number;
  canDelete: boolean;
  onRotate: () => void;
  onExport: () => void;
  onBatchEdit: () => void;
  onAutoGrade: () => void;
  onRemove: () => void;
  onDelete: () => void;
  onClear: () => void;
};

export function SelectionBar({
  count,
  canDelete,
  onRotate,
  onExport,
  onBatchEdit,
  onAutoGrade,
  onRemove,
  onDelete,
  onClear,
}: SelectionBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-line bg-card/95 px-2 py-2 shadow-2xl shadow-black/50 backdrop-blur-md">
        <p className="px-2 text-xs text-mute">
          <span className="font-medium text-foam">{count}</span> selected
        </p>
        <Rule />
        <Action label="Edit" hint="Grade all selected" onClick={onBatchEdit} accent />
        <Action label="Auto grade" hint="Read each preview" onClick={onAutoGrade} />
        <Action label="Export" hint="Copy files out" onClick={onExport} />
        <Action label="Rotate" hint="Turn 90°" onClick={onRotate} />
        <Rule />
        <Action label="Remove from library" hint="Keep files on disk" onClick={onRemove} />
        <Action label="Delete files" hint="Erase from disk" onClick={onDelete} danger disabled={!canDelete} />
        <Rule />
        <Action label="Deselect" hint="Clear the selection" onClick={onClear} quiet />
      </div>
    </div>
  );
}

function Rule() {
  return <span className="hidden h-6 w-px bg-line sm:block" />;
}

function Action({
  label,
  hint,
  onClick,
  accent,
  danger,
  quiet,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-2.5 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
        accent
          ? "bg-teal font-medium text-teal-ink"
          : danger
            ? "text-danger hover:bg-danger/10"
            : quiet
              ? "text-mute hover:bg-raised hover:text-foam"
              : "text-foam hover:bg-raised"
      }`}
    >
      <span className="block leading-none">{label}</span>
      <span className={`mt-0.5 block text-[10px] leading-none ${accent ? "text-teal-ink/70" : "text-mute"}`}>
        {hint}
      </span>
    </button>
  );
}
