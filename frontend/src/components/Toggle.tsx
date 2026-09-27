interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  color?: string;
  label?: string;
  disabled?: boolean;
}

export default function Toggle({ checked, onChange, color = '#4a9eff', label, disabled = false }: ToggleProps) {
  return (
    <label className={`flex items-center gap-1 text-sm select-none ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className="relative inline-block w-9 h-5 rounded-full transition-colors"
        style={{ backgroundColor: checked ? color : '#3c3c3c' }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </span>
      {label && (
        <span style={{ color: checked ? color : '#888888' }}>
          {label}
        </span>
      )}
    </label>
  );
}
