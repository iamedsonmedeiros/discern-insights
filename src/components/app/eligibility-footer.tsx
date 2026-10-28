"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/use-i18n";
import { MIN_TEXT_LENGTH, SOCIAL_PLATFORMS, VIDEO_PLATFORMS } from "@/lib/eligibility";

const platformNames = (platforms: { name: string }[]) => platforms.map((p) => p.name).join(", ");

export function EligibilityFooter() {
  const { t } = useI18n();

  const rejected = [
    t("eligibility.social", { platforms: platformNames(SOCIAL_PLATFORMS) }),
    t("eligibility.video", { platforms: platformNames(VIDEO_PLATFORMS) }),
    t("eligibility.pdf"),
    t("eligibility.blocked", { min: MIN_TEXT_LENGTH }),
  ];

  return (
    <footer className="border-t border-slate-200 bg-white/60">
      <div className="container mx-auto px-4 py-8 text-sm text-slate-600">
        <h2 className="text-base font-semibold text-slate-800">{t("eligibility.title")}</h2>
        <p className="mt-1 max-w-3xl">{t("eligibility.intro")}</p>

        <div className="mt-6 grid gap-8 md:grid-cols-[1fr_2fr]">
          <section>
            <h3 className="flex items-center gap-2 font-medium text-slate-800">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              {t("eligibility.acceptedTitle")}
            </h3>
            <p className="mt-2">{t("eligibility.accepted")}</p>
            <p className="mt-2">{t("eligibility.pulse")}</p>
          </section>

          <section>
            <h3 className="flex items-center gap-2 font-medium text-slate-800">
              <XCircle className="h-4 w-4 text-yellow-500" />
              {t("eligibility.rejectedTitle")}
            </h3>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              {rejected.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </footer>
  );
}
