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
      className="flex items-center justify-center h-7 px-3 rounded-full border border-[#3c3c3c] bg-[#333333] text-sm text-[#c0c0c0] hover:border-[#555555] hover:text-[#e0e0e0]"
    >
      {t('nav.shortcuts')}
    </button>
  );
}

export default HelpButton;
