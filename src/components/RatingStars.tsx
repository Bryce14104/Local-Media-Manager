type RatingStarsProps = {
  rating: number | null;
  disabled?: boolean;
  onChange: (rating: number | null) => void;
};

const STAR_VALUES = [1, 2, 3, 4, 5];

export function RatingStars({ rating, disabled = false, onChange }: RatingStarsProps) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex items-center gap-1">
      {STAR_VALUES.map((value) => {
        const filled = rating != null && value <= rating;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            disabled={disabled}
            onClick={() => onChange(rating === value ? null : value)}
            className={`grid h-8 w-8 place-items-center rounded-full text-lg leading-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:cursor-not-allowed disabled:opacity-50 ${
              filled ? "text-brass" : "text-ink-soft/40 hover:text-brass"
            }`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
