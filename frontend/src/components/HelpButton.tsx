import { useI18n } from '../i18n';

interface HelpButtonProps {
  onClick: () => void;
}

function HelpButton({ onClick }: HelpButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('nav.help')}
      aria-label={t('nav.help')}
      className="flex items-center justify-center w-7 h-7 rounded-full border border-[#3c3c3c] bg-[#333333] text-sm font-bold text-[#c0c0c0] hover:border-[#555555] hover:text-[#e0e0e0]"
    >
      ?
    </button>
  );
}

export default HelpButton;
