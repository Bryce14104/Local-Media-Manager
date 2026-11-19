export function DownloadCloudButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Download original onto this computer"
      title="Save the full-resolution file on this computer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`grid place-items-center rounded-full border border-white/25 bg-black/50 text-white shadow-sm backdrop-blur-sm hover:border-teal hover:text-teal ${className ?? "h-8 w-8"}`}
    >
      <CloudArrowDown />
    </button>
  );
}

function CloudArrowDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7.5 18H7a4 4 0 1 1 .4-8 5.5 5.5 0 0 1 10.7 1.6A3.8 3.8 0 0 1 17.5 18H16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 11.5v8M9.2 16.7 12 19.5l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
