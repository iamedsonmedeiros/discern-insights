"use client";

import { useMemo, useState } from "react";
import { Users2, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/use-i18n";
import { computeIcc, buildIccMatrix, interpretIcc } from "@/lib/reliability";
import { isCurrentInstrument } from "@/lib/discern-items";
import { pageKey } from "@/lib/url-key";
import type { AnalysisItem, Consensus } from "@/lib/types";

const BAND_STYLES: Record<string, string> = {
  poor: "border-red-500 text-red-600 dark:text-red-400",
  moderate: "border-amber-500 text-amber-600 dark:text-amber-400",
  good: "border-emerald-500 text-emerald-600 dark:text-emerald-400",
  excellent: "border-emerald-600 text-emerald-700 dark:text-emerald-400",
};

/**
 * Inter-rater reliability across the model panel, computed from the consensus
 * data already loaded on the items — no extra round trip.
 *
 * The point of showing both figures is the gap between them: ICC(2,1) is how
 * much one model is worth on its own, ICC(2,k) is what averaging the panel buys.
 */
export function ReliabilityCard({
  items,
  sessionModels,
  modelChoices = [],
  expanding = false,
  onExpand,
}: {
  items: AnalysisItem[];
  sessionModels?: string[];
  modelChoices?: { id: string; displayName: string }[];
  expanding?: boolean;
  onExpand?: (modelIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [extraModels, setExtraModels] = useState<string[]>([]);
  const singleModelSession = (sessionModels?.length ?? 0) === 1;

  const icc = useMemo(() => {
    if (singleModelSession) return null;
    const seen = new Set<string>();
    const analyses = [...items]
      .sort((a, b) => a.index - b.index)
      .filter((item) => {
        if (!isCurrentInstrument(item.discernResult) || !item.consensus) return false;
        const key = pageKey(item.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((i) => i.consensus as Consensus | undefined)
      .filter((c): c is Consensus => !!c);

    if (analyses.length === 0) return null;

    // Only models that scored in every analysis, so the matrix is complete.
    const models = analyses[0].models.filter((m) =>
      analyses.every((a) => a.models.includes(m))
    );
    if (models.length < 2) return null;

    return computeIcc(buildIccMatrix(analyses, models));
  }, [items, singleModelSession]);

  if (singleModelSession) {
    const used = sessionModels?.[0] ?? "";
    const usedName = modelChoices.find((model) => model.id === used)?.displayName ?? used.split("/").pop() ?? used;
    const others = modelChoices.filter((model) => model.id !== used);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-4 w-4" />
            {t("reliability.title")}
          </CardTitle>
          <CardDescription>{t("reliability.unavailableBody", { model: usedName })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("reliability.addHint")}</p>
          {others.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {others.map((model) => {
                const checked = extraModels.includes(model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() =>
                      setExtraModels((prev) => (checked ? prev.filter((id) => id !== model.id) : [...prev, model.id]))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      checked ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-muted-foreground"
                    )}
                  >
                    {model.displayName}
                  </button>
                );
              })}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={expanding || extraModels.length === 0 || !onExpand}
            onClick={() => onExpand?.(extraModels)}
          >
            {expanding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {expanding ? t("reliability.adding") : t("reliability.addButton")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!icc) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users2 className="h-4 w-4" />
          {t("reliability.title")}
        </CardTitle>
        <CardDescription>
          {t("reliability.description")
            .replace("{subjects}", String(icc.subjects))
            .replace("{raters}", String(icc.raters))}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-2xl font-semibold">{icc.icc1.toFixed(3)}</p>
            <p className="text-xs text-muted-foreground">{t("reliability.single")}</p>
            <Badge variant="outline" className={cn("mt-1 text-xs", BAND_STYLES[interpretIcc(icc.icc1)])}>
              {t(`reliability.band.${interpretIcc(icc.icc1)}` as never)}
            </Badge>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-2xl font-semibold">{icc.iccK.toFixed(3)}</p>
            <p className="text-xs text-muted-foreground">{t("reliability.panel")}</p>
            <Badge variant="outline" className={cn("mt-1 text-xs", BAND_STYLES[icc.interpretation])}>
              {t(`reliability.band.${icc.interpretation}` as never)}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("reliability.footnote")}</p>
      </CardContent>
    </Card>
  );
}
