/** Two-tile on/off setting. */

/** The two states, in the order they are drawn. */
const OPTIONS = [true, false] as const;

export function ToggleSetting({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-txt-clear">{label}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-txt-dimmer">{description}</p>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={String(opt)}
            aria-pressed={value === opt}
            className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[11px] transition-all duration-150 ${
              value === opt
                ? "chip-active ring-1 ring-primary"
                : "bg-low/50 text-txt-dim ring-1 ring-line hover:text-txt hover:ring-txt-dim"
            }`}
            onClick={() => onChange(opt)}
          >
            <span className="font-medium">{opt ? "On" : "Off"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
