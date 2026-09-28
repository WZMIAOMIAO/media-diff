import { useI18n, type Lang } from '../i18n';

const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中' },
  { value: 'en', label: 'EN' },
];

function LanguageSwitcher() {
  const { lang, setLang } = useI18n();

  return (
    <div className="flex items-center rounded-md border border-[#3c3c3c] overflow-hidden text-xs select-none">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setLang(opt.value)}
          className={`px-2 py-1 transition-colors ${
            lang === opt.value
              ? 'bg-[#4a9eff] text-white'
              : 'text-[#888888] hover:text-[#e0e0e0] hover:bg-[#2b2b2b]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
