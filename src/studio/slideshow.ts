const KEY = "shelf-slideshow";

export type SlideshowSettings = {
  intervalMs: number;
  loop: boolean;
  shuffle: boolean;
  waitForVideo: boolean;
};

export const SLIDE_SECONDS = [2, 3, 4, 5, 8, 10, 15] as const;

export const DEFAULT_SLIDESHOW: SlideshowSettings = {
  intervalMs: 4000,
  loop: true,
  shuffle: false,
  waitForVideo: true,
};

export function readSlideshowSettings(): SlideshowSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SLIDESHOW;
    const parsed = JSON.parse(raw) as Partial<SlideshowSettings>;
    const seconds = Number(parsed.intervalMs) / 1000;
    const allowed = SLIDE_SECONDS.includes(seconds as (typeof SLIDE_SECONDS)[number]);
    return {
      intervalMs: allowed ? seconds * 1000 : DEFAULT_SLIDESHOW.intervalMs,
      loop: parsed.loop !== false,
      shuffle: parsed.shuffle === true,
      waitForVideo: parsed.waitForVideo !== false,
    };
  } catch {
    return DEFAULT_SLIDESHOW;
  }
}

export function writeSlideshowSettings(settings: SlideshowSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this visit.
  }
}
