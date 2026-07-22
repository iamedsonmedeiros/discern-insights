"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/use-i18n";
import type { TranslationKey } from "@/components/i18n/translations";
import type { AnalysisItem, Consensus } from "@/lib/types";
import { fetchModelResults, type ModelResultRow } from "@/app/actions";

const DISCERN_ITEMS = Array.from(
  { length: 16 },
  (_, i) => `item${String(i + 1).padStart(2, "0")}`
);

const shortModel = (id: string) => id.split("/").pop() ?? id;

/**
 * Phase 3 consensus surface: the item x model score matrix, with the items where
 * models disagreed by more than a point flagged in amber and expandable to show
 * each model's own justification side by side — the point where the researcher
 * decides by hand.
 */
export function ConsensusView({
  item,
  questions,
}: {
  item: AnalysisItem;
  questions: Record<string, TranslationKey>;
}) {
  const { t } = useI18n();
  const consensus = item.consensus as Consensus | undefined;

  const [rows, setRows] = useState<ModelResultRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load per-model justifications lazily, the first time an item is shown.
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setExpanded(null);
    if (!consensus) return;
    setLoading(true);
    fetchModelResults(item.id)
      .then((data) => !cancelled && setRows(data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item.id, consensus]);

  if (!consensus) {
    return (
      <Alert>
        <AlertTitle>{t("consensus.singleModelTitle")}</AlertTitle>
        <AlertDescription>{t("consensus.singleModelBody")}</AlertDescription>
      </Alert>
    );
  }

  const models = consensus.models;
  const justificationsFor = (modelId: string) =>
    rows?.find((r) => r.modelId === modelId && r.status === "done")?.justifications ?? null;

  return (
    <div className="space-y-4">
      {consensus.divergenceFlag ? (
        <Alert variant="destructive" className="border-amber-500/50 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("consensus.divergenceTitle")}</AlertTitle>
          <AlertDescription>
            {t("consensus.divergenceBody").replace("{count}", String(consensus.divergentItems.length))}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400 [&>svg]:text-emerald-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("consensus.agreementTitle")}</AlertTitle>
          <AlertDescription>{t("consensus.agreementBody")}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("consensus.panelLabel")}:</span>
        {models.map((m) => (
          <Badge key={m} variant="secondary">
            {shortModel(m)}
          </Badge>
        ))}
        {item.panelIncomplete && (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            {t("consensus.panelIncomplete")}
          </Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left font-medium">{t("consensus.itemColumn")}</th>
              {models.map((m) => (
                <th key={m} className="p-2 text-center font-medium whitespace-nowrap">
                  {shortModel(m)}
                </th>
              ))}
              <th className="p-2 text-center font-medium">{t("consensus.meanColumn")}</th>
              <th className="p-2 text-center font-medium">{t("consensus.rangeColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {DISCERN_ITEMS.map((key) => {
              const stat = consensus.perItem[key];
              if (!stat) return null;
              const diverges = stat.range > 1;
              const isOpen = expanded === key;
              const label = questions[key] ? t(questions[key]) : key;

              return (
                <>
                  <tr
                    key={key}
                    className={cn(
                      "border-b transition-colors",
                      diverges && "bg-amber-50 dark:bg-amber-950/30",
                      "hover:bg-muted/40 cursor-pointer"
                    )}
                    onClick={() => setExpanded(isOpen ? null : key)}
                  >
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <ChevronDown
                          className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-180")}
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {key.replace("item", "")}
                        </span>
                        <span className="line-clamp-1">{label}</span>
                        {diverges && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        )}
                      </div>
                    </td>
                    {models.map((m) => {
                      const v = stat.values[m];
                      const isExtreme = diverges && (v === stat.min || v === stat.max);
                      return (
                        <td key={m} className="p-2 text-center">
                          <span
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded",
                              isExtreme && "font-bold text-amber-600 dark:text-amber-400"
                            )}
                          >
                            {v ?? "—"}
                          </span>
                        </td>
                      );
                    })}
                    <td className="p-2 text-center font-semibold">{stat.mean.toFixed(2)}</td>
                    <td className="p-2 text-center">
                      <Badge
                        variant={diverges ? "destructive" : "outline"}
                        className={cn(diverges && "bg-amber-500 hover:bg-amber-500")}
                      >
                        {stat.range}
                      </Badge>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${key}-detail`} className="border-b bg-muted/20">
                      <td colSpan={models.length + 3} className="p-3">
                        {loading && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("consensus.loadingJustifications")}
                          </div>
                        )}
                        {!loading && (
                          <div className="grid gap-3 md:grid-cols-2">
                            {models.map((m) => {
                              const j = justificationsFor(m)?.[key];
                              return (
                                <div key={m} className="rounded border bg-background p-3">
                                  <div className="mb-1 flex items-center justify-between">
                                    <span className="text-xs font-semibold">{shortModel(m)}</span>
                                    <Badge variant="secondary">{stat.values[m] ?? "—"}</Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {j || t("consensus.noJustification")}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
