import { SLIDE_SECONDS, type SlideshowSettings } from "../../studio/slideshow";

export function SlideshowControls({
  settings,
  onChange,
}: {
  settings: SlideshowSettings;
  onChange: (settings: SlideshowSettings) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-mute">Seconds per still</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {SLIDE_SECONDS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => onChange({ ...settings, intervalMs: seconds * 1000 })}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                settings.intervalMs === seconds * 1000
                  ? "border-teal bg-teal/15 text-teal"
                  : "border-line text-mute hover:text-foam"
              }`}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label="Loop at the end"
        checked={settings.loop}
        onChange={(loop) => onChange({ ...settings, loop })}
      />
      <Toggle
        label="Shuffle order"
        checked={settings.shuffle}
        onChange={(shuffle) => onChange({ ...settings, shuffle })}
      />
      <Toggle
        label="Wait for videos to finish"
        checked={settings.waitForVideo}
        onChange={(waitForVideo) => onChange({ ...settings, waitForVideo })}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`h-6 w-10 rounded-full border ${checked ? "border-teal bg-teal/40" : "border-line bg-studio"}`}
      >
        <span className={`block h-5 w-5 rounded-full bg-foam transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}
