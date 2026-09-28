import { useI18n } from '../i18n';

interface ColorPickerButtonProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ColorPickerButton({ active, disabled = false, onClick }: ColorPickerButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t('colorPicker.disabled') : t('colorPicker.enabled')}
      aria-pressed={active}
      className={`flex items-center justify-center w-7 h-7 rounded border ${
        disabled
          ? 'bg-[#2a2a2a] border-[#333333] text-[#555555] cursor-not-allowed'
          : active
            ? 'bg-[#4a9eff] border-[#4a9eff] text-white'
            : 'bg-[#333333] border-[#3c3c3c] text-[#c0c0c0] hover:border-[#555555]'
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m2 22 1-1h3l9-9" />
        <path d="M3 21v-3l9-9" />
        <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.5.5a1 1 0 0 1 0 1.4l-2 2a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4l2-2a1 1 0 0 1 1.4 0z" />
      </svg>
    </button>
  );
}

export default ColorPickerButton;
