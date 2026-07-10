import { useEffect, useMemo, useState } from "react";
import { Languages, Save, Check } from "lucide-react";
import api from "@/api/client";
import { useSettings } from "@/hooks/data";
import { useToast } from "@/contexts/ToastContext";

// Languages the doctor share view can pick from. Kept in sync with
// KNOWN_TRANSLATION_LANGUAGES on the backend (settings/routes.py); the
// backend rejects anything outside this set.
const SUPPORTED_LANGUAGES = [
  "English",
  "Italian",
  "German",
  "French",
  "Spanish",
  "Russian",
] as const;

type Language = (typeof SUPPORTED_LANGUAGES)[number];

export default function LanguageTab() {
  const { toast } = useToast();
  const { data: settingsData, refetch } = useSettings();

  const [defaultLanguage, setDefaultLanguage] = useState<Language>("English");
  const [allowed, setAllowed] = useState<Language[]>([...SUPPORTED_LANGUAGES]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const llm = settingsData?.llm;
    if (!llm) return;
    const remoteAllowed: string[] = Array.isArray(
      llm.translation_allowed_languages,
    )
      ? llm.translation_allowed_languages
      : [];
    const filteredAllowed = remoteAllowed.filter((l): l is Language =>
      (SUPPORTED_LANGUAGES as readonly string[]).includes(l),
    );
    setAllowed(filteredAllowed.length > 0 ? filteredAllowed : ["English"]);
    const remoteDefault = llm.translation_target_language;
    if (
      typeof remoteDefault === "string" &&
      (SUPPORTED_LANGUAGES as readonly string[]).includes(remoteDefault)
    ) {
      setDefaultLanguage(remoteDefault as Language);
    }
  }, [settingsData]);

  const isAllowed = useMemo(() => new Set(allowed), [allowed]);

  // If the current default just got removed from the allow-list, pick the
  // first remaining language so the form never sits in a state the backend
  // would reject.
  useEffect(() => {
    if (!isAllowed.has(defaultLanguage) && allowed.length > 0) {
      setDefaultLanguage(allowed[0]);
    }
  }, [allowed, defaultLanguage, isAllowed]);

  const toggleLanguage = (lang: Language) => {
    setAllowed((prev) => {
      if (prev.includes(lang)) {
        return prev.filter((l) => l !== lang);
      }
      // Preserve canonical display order rather than click order.
      return SUPPORTED_LANGUAGES.filter((l) => prev.includes(l) || l === lang);
    });
  };

  const canSave = allowed.length > 0 && isAllowed.has(defaultLanguage);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.patch("/settings", {
        translation_target_language: defaultLanguage,
        translation_allowed_languages: allowed,
      });
      refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      const message =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ||
        (e as Error)?.message ||
        "";
      toast({
        title: "Failed to save translation language settings",
        description: message,
        variant: "error",
      });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Translation languages</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Controls the on-demand translation feature on shared documents.
          Doctors viewing a share link see a dropdown listing the allowed
          languages with the default pre-selected. Changing these settings does
          not retranslate documents that have already been translated.
        </p>

        <div className="space-y-2">
          <label className="block text-xs font-medium">Default language</label>
          <select
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value as Language)}
            className="w-full max-w-sm rounded-md border bg-background px-3 py-1.5 text-base sm:text-sm coarse:min-h-11"
          >
            {allowed.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            The starting selection for the doctor's translation picker. Must be
            one of the allowed languages below.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium">Allowed languages</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const checked = isAllowed.has(lang);
              const isLastAllowedDefault =
                checked && lang === defaultLanguage && allowed.length === 1;
              return (
                <label
                  key={lang}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm coarse:min-h-11 ${
                    checked ? "bg-primary/5 border-primary/30" : "bg-background"
                  } ${isLastAllowedDefault ? "opacity-70" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLastAllowedDefault}
                    onChange={() => toggleLanguage(lang)}
                    className="h-4 w-4 rounded border-muted-foreground coarse:h-5 coarse:w-5"
                  />
                  <span>{lang}</span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Pick the languages doctors can choose from. At least one must be
            allowed; the current default cannot be removed without first picking
            a different default.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary-hover disabled:opacity-50 coarse:min-h-11"
          >
            {saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saved ? "Saved" : saving ? "Saving..." : "Save"}
          </button>
          {!canSave && (
            <span className="text-xs text-muted-foreground">
              Pick at least one allowed language and a valid default.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
