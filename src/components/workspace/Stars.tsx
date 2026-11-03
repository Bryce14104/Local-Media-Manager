type StarsProps = {
  rating: number | null;
  onChange: (rating: number | null) => void;
  compact?: boolean;
};

const VALUES = [1, 2, 3, 4, 5];

export function Stars({ rating, onChange, compact = false }: StarsProps) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex items-center">
      {VALUES.map((value) => {
        const filled = rating != null && value <= rating;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(rating === value ? null : value);
            }}
            className={`${compact ? "h-6 w-5 text-sm" : "h-7 w-6 text-base"} leading-none text-gold/35 transition hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal ${
              filled ? "text-gold" : ""
            }`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
