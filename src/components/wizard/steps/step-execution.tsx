"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import {
  useEnvironmentStore,
  useMigrationWizardStore,
  useMigrationExecutionStore,
  useHistoryStore,
} from "@/lib/stores";
import {
  exportSolution,
  importSolution,
  listPublishers,
  modifySolutionZip,
  type Publisher,
} from "@/lib/api/power-platform";
import {
  migrateTableData,
  type TableMigrationConfig,
} from "@/lib/api/dataverse-migration";
import {
  checkPacAvailability,
  ensurePacAuth,
  pacExportSolution,
  pacImportSolution,
  pacGetSetting,
  pacUpdateSetting,
} from "@/lib/api/pac-cli";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  SkipForward,
} from "lucide-react";
import type {
  MigrationRun,
  MigrationItemProgress,
  MigrationItemStatus,
} from "@/lib/types";

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return parseMissingDeps(err.message);
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    // fetchWithRetry throws { status, statusText, code, message }
    if (typeof obj.message === "string" && obj.message) {
      const prefix = obj.status ? `[${obj.status}] ` : "";
      return `${prefix}${parseMissingDeps(obj.message)}`;
    }
    if (typeof obj.error === "object" && obj.error !== null) {
      const inner = obj.error as Record<string, unknown>;
      if (typeof inner.message === "string") return parseMissingDeps(inner.message);
    }
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return String(err) !== "[object Object]" ? String(err) : "Unknown error";
}

function parseMissingDeps(msg: string): string {
  if (!msg.includes("<MissingDependencies")) return msg;
  try {
    const deps: string[] = [];
    const re = /<Required\s+([^/]*?)\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(msg)) !== null) {
      const attrs = m[1];
      const type = attrs.match(/type="([^"]+)"/)?.[1] || "Unknown";
      const name = attrs.match(/displayName="([^"]+)"/)?.[1] || "Unknown";
      deps.push(`${name} (${type})`);
    }
    if (deps.length > 0) {
      return `Import failed — missing dependencies in target environment: ${deps.join("; ")}`;
    }
  } catch { /* fall through */ }
  return msg;
}

const statusConfig: Record<
  MigrationItemStatus,
  { icon: React.ComponentType<{ className?: string }>; color: string; label: string }
> = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Queued" },
  "in-progress": { icon: Loader2, color: "text-blue-500", label: "In Progress" },
  success: { icon: CheckCircle2, color: "text-green-500", label: "Success" },
  warning: { icon: AlertTriangle, color: "text-yellow-500", label: "Warning" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  skipped: { icon: SkipForward, color: "text-muted-foreground", label: "Skipped" },
};

export function StepExecution() {
  const { getDataverseToken } = useAuth();
  const sourceEnv = useEnvironmentStore((s) => s.sourceEnvironment);
  const targetEnv = useEnvironmentStore((s) => s.targetEnvironment);
  const {
    selections,
    solutions,
    tables,
    connectionMappings,
    envVariableMappings,
    setCurrentStep,
  } = useMigrationWizardStore();

  const {
    currentRun,
    isRunning,
    setCurrentRun,
    updateItemStatus,
    setIsRunning,
    incrementCompleted,
    incrementFailed,
    incrementWarning,
  } = useMigrationExecutionStore();

  const addHistory = useHistoryStore((s) => s.addRun);
  const updateHistory = useHistoryStore((s) => s.updateRun);

  const abortRef = useRef(false);

  // ─── Solution override options ──────────────────────────
  // Per-solution overrides: { [solutionId]: { newName?, publisherId? } }
  const [solutionOverrides, setSolutionOverrides] = useState<
    Record<string, { newName?: string; publisherUniqueName?: string }>
  >({});
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loadingPublishers, setLoadingPublishers] = useState(false);

  // Fetch publishers from target env
  useEffect(() => {
    if (!targetEnv?.orgUrl) return;
    let cancelled = false;
    (async () => {
      setLoadingPublishers(true);
      try {
        const token = await getDataverseToken(targetEnv.orgUrl);
        const pubs = await listPublishers(token, targetEnv.orgUrl);
        if (!cancelled) setPublishers(pubs);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingPublishers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetEnv?.orgUrl, getDataverseToken]);

  const selectedSolutionSel = selections.find((s) => s.objectType === "solutions" && s.enabled);
  const selectedSolutions = (selectedSolutionSel?.items || [])
    .map((id) => solutions.find((s) => s.solutionid === id))
    .filter(Boolean) as typeof solutions;

  const initializeRun = useCallback((): MigrationRun => {
    const items: MigrationItemProgress[] = [];

    for (const sel of selections.filter((s) => s.enabled)) {
      if (sel.objectType === "solutions") {
        for (const solId of sel.items) {
          const sol = solutions.find((s) => s.solutionid === solId);
          items.push({
            id: `sol-${solId}`,
            name: sol?.friendlyname || solId,
            type: "solutions",
            status: "queued",
          });
        }
      } else if (sel.objectType === "tables") {
        for (const tableName of sel.items) {
          const tbl = tables.find((t) => t.logicalName === tableName);
          items.push({
            id: `tbl-${tableName}`,
            name: tbl?.displayName || tableName,
            type: "tables",
            status: "queued",
          });
        }
      } else {
        items.push({
          id: `type-${sel.objectType}`,
          name: sel.objectType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          type: sel.objectType,
          status: "queued",
        });
      }
    }

    const run: MigrationRun = {
      id: crypto.randomUUID(),
      name: `Migration ${new Date().toLocaleString()}`,
      sourceEnvironment: sourceEnv!,
      targetEnvironment: targetEnv!,
      selections: selections.filter((s) => s.enabled),
      connectionMappings,
      envVariableMappings,
      items,
      status: "pending",
      startedAt: new Date().toISOString(),
      totalItems: items.length,
      completedItems: 0,
      failedItems: 0,
      warningItems: 0,
    };

    return run;
  }, [selections, solutions, tables, sourceEnv, targetEnv, connectionMappings, envVariableMappings]);

  const executeMigration = useCallback(async () => {
    if (!sourceEnv?.orgUrl || !targetEnv?.orgUrl) return;
    abortRef.current = false;

    const run = initializeRun();
    setCurrentRun(run);
    setIsRunning(true);
    addHistory(run);

    try {
      const sourceToken = await getDataverseToken(sourceEnv.orgUrl);
      const targetToken = await getDataverseToken(targetEnv.orgUrl);

      // Execute each migration item
      for (let idx = 0; idx < run.items.length; idx++) {
        const item = run.items[idx];
        if (abortRef.current) {
          updateItemStatus(item.id, "skipped", "Migration was cancelled");
          continue;
        }

        updateItemStatus(item.id, "in-progress", "Starting...");

        try {
          if (item.type === "solutions") {
            const solId = item.id.replace("sol-", "");
            const sol = solutions.find((s) => s.solutionid === solId);
            if (sol) {
              const overrides = solutionOverrides[solId];
              const hasOverrides = overrides?.newName || overrides?.publisherUniqueName;

              // Helper: apply name/publisher overrides to the zip buffer if configured
              const applyOverrides = async (buf: ArrayBuffer): Promise<ArrayBuffer> => {
                if (!hasOverrides) return buf;
                updateItemStatus(item.id, "in-progress", "Applying solution overrides...");
                return modifySolutionZip(buf, {
                  friendlyName: overrides.newName,
                  publisherUniqueName: overrides.publisherUniqueName,
                });
              };

              // Check if PAC CLI is available — it handles large solutions/web resources natively
              const pacAvailable = await checkPacAvailability();
              let usedPac = false;

              if (pacAvailable) {
                try {
                  // ── PAC CLI path (handles large custom controls like AgGrid) ──
                  updateItemStatus(item.id, "in-progress", "Using PAC CLI for solution transfer...");

                  // Ensure PAC auth for source
                  updateItemStatus(item.id, "in-progress", "Setting up PAC CLI auth for source...");
                  await ensurePacAuth(sourceEnv.orgUrl);

                  updateItemStatus(item.id, "in-progress", "Exporting solution via PAC CLI...");
                  const blob = await pacExportSolution(sourceEnv.orgUrl, sol.uniquename, sol.ismanaged);

                  // Ensure PAC auth for target
                  updateItemStatus(item.id, "in-progress", "Setting up PAC CLI auth for target...");
                  await ensurePacAuth(targetEnv.orgUrl);

                  // Increase maxuploadfilesize on target to handle large web resources
                  const MIN_UPLOAD_SIZE = "52428800"; // 50 MB
                  let originalMaxUpload: string | null = null;
                  try {
                    updateItemStatus(item.id, "in-progress", "Checking target max upload size...");
                    const current = await pacGetSetting("maxuploadfilesize", targetEnv.orgUrl);
                    if (current && parseInt(current, 10) < parseInt(MIN_UPLOAD_SIZE, 10)) {
                      originalMaxUpload = current;
                      updateItemStatus(item.id, "in-progress", `Increasing max upload size from ${Math.round(parseInt(current, 10) / 1048576)}MB to 50MB...`);
                      await pacUpdateSetting("maxuploadfilesize", MIN_UPLOAD_SIZE, targetEnv.orgUrl);
                    }
                  } catch {
                    // Non-blocking — import may still work
                  }

                  try {
                    updateItemStatus(item.id, "in-progress", "Importing solution via PAC CLI...");
                    let buffer = await blob.arrayBuffer();
                    buffer = await applyOverrides(buffer);
                    await pacImportSolution(targetEnv.orgUrl, buffer, (msg) => {
                      updateItemStatus(item.id, "in-progress", msg);
                    });
                  } finally {
                    // Restore original maxuploadfilesize
                    if (originalMaxUpload) {
                      try {
                        await pacUpdateSetting("maxuploadfilesize", originalMaxUpload, targetEnv.orgUrl);
                      } catch { /* non-blocking */ }
                    }
                  }
                  usedPac = true;
                } catch (pacErr) {
                  // PAC CLI failed (e.g. expired auth tokens) — fall back to Web API
                  console.warn("PAC CLI failed, falling back to Web API:", pacErr);
                  updateItemStatus(item.id, "in-progress", "PAC CLI failed, falling back to Web API...");
                }
              }

              if (!usedPac) {
                // ── Web API fallback ──
                updateItemStatus(item.id, "in-progress", "Exporting solution via API...");
                const blob = await exportSolution(sourceToken, sourceEnv.orgUrl, sol.uniquename, sol.ismanaged);

                updateItemStatus(item.id, "in-progress", "Importing solution to target via API...");
                let buffer = await blob.arrayBuffer();
                buffer = await applyOverrides(buffer);
                await importSolution(targetToken, targetEnv.orgUrl, buffer, true, true, (msg) => {
                  updateItemStatus(item.id, "in-progress", msg);
                });
              }
            }
          } else if (item.type === "tables") {
            // ── Dataverse table DATA migration ──
            // Table schema is already migrated via the solution import above.
            // This step only copies row data.
            const tableName = item.id.replace("tbl-", "");
            const sel = selections.find((s) => s.objectType === "tables" && s.enabled);
            const conflictResolution = sel?.conflictResolution || "upsert";

            updateItemStatus(item.id, "in-progress", `Migrating table data: ${item.name}...`);

            const tableConfig: TableMigrationConfig = {
              logicalName: tableName,
              displayName: item.name,
              conflictResolution,
            };

            const result = await migrateTableData({
              sourceUrl: sourceEnv.orgUrl,
              targetUrl: targetEnv.orgUrl,
              sourceToken,
              targetToken,
              tables: [tableConfig],
              batchSize: 500,
              onProgress: (progress) => {
                const phaseLabel = progress.phase === "exporting" ? "Exporting" : progress.phase === "mapping" ? "Mapping lookups" : "Importing";
                updateItemStatus(
                  item.id,
                  "in-progress",
                  `${phaseLabel}: ${progress.current}/${progress.total} records (${progress.succeeded} ok, ${progress.failed} failed, ${progress.skipped} skipped)`
                );
              },
            });

            const tableResult = result.results[0];
            if (tableResult) {
              if (tableResult.failed > 0) {
                updateItemStatus(
                  item.id,
                  "warning",
                  `Migrated ${tableResult.imported}/${tableResult.exported} records (${tableResult.failed} failed, ${tableResult.skipped} skipped)`
                );
                incrementWarning();
                continue; // skip incrementCompleted below
              } else {
                updateItemStatus(
                  item.id,
                  "success",
                  `Migrated ${tableResult.imported} records (${tableResult.skipped} skipped, ${tableResult.exported} total)`
                );
                incrementCompleted();
                continue; // skip generic success below
              }
            }
          }

          updateItemStatus(item.id, "success", "Completed successfully");
          incrementCompleted();
        } catch (err) {
          const message = extractErrorMessage(err);
          updateItemStatus(item.id, "failed", message);
          incrementFailed();


        }
      }

      // Finalize run
      const finalRun = useMigrationExecutionStore.getState().currentRun;
      if (finalRun) {
        const status = finalRun.failedItems > 0 ? "failed" : "completed";
        setCurrentRun({
          ...finalRun,
          status,
          completedAt: new Date().toISOString(),
        });
        updateHistory({
          ...finalRun,
          status,
          completedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const outerMessage = extractErrorMessage(err);
      const finalRun = useMigrationExecutionStore.getState().currentRun;
      if (finalRun) {
        // Mark any remaining queued/in-progress items as failed with the actual error
        const updatedItems = finalRun.items.map((item) =>
          item.status === "queued" || item.status === "in-progress"
            ? { ...item, status: "failed" as const, message: outerMessage, completedAt: new Date().toISOString() }
            : item
        );
        const failedCount = updatedItems.filter((i) => i.status === "failed").length;
        setCurrentRun({
          ...finalRun,
          items: updatedItems,
          status: "failed",
          failedItems: failedCount,
          completedAt: new Date().toISOString(),
        });
        updateHistory({
          ...finalRun,
          items: updatedItems,
          status: "failed",
          failedItems: failedCount,
          completedAt: new Date().toISOString(),
        });
      }
    } finally {
      setIsRunning(false);
    }
  }, [
    sourceEnv, targetEnv, getDataverseToken, selections, solutions, solutionOverrides,
    initializeRun, setCurrentRun, setIsRunning, updateItemStatus,
    incrementCompleted, incrementFailed, incrementWarning, addHistory, updateHistory,
  ]);

  const progressPercent = currentRun
    ? Math.round(
        ((currentRun.completedItems + currentRun.failedItems + currentRun.warningItems) /
          Math.max(currentRun.totalItems, 1)) *
          100
      )
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Play className="h-5 w-5" />
          Migration Execution
        </h2>
        <p className="text-sm text-muted-foreground">
          {isRunning
            ? "Migration is running... Please do not close this page."
            : currentRun
            ? "Migration has completed."
            : "Configure options and start the migration."}
        </p>
      </div>

      {/* Migration Options — shown before migration starts */}
      {!isRunning && !currentRun && selectedSolutions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Migration Options</CardTitle>
            <CardDescription>
              Optionally rename solutions or change the publisher in the destination.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedSolutions.map((sol) => (
              <div key={sol.solutionid} className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">{sol.friendlyname}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`name-${sol.solutionid}`} className="text-xs">
                      Display Name in Destination
                    </Label>
                    <Input
                      id={`name-${sol.solutionid}`}
                      placeholder={sol.friendlyname}
                      value={solutionOverrides[sol.solutionid]?.newName ?? ""}
                      onChange={(e) =>
                        setSolutionOverrides((prev) => ({
                          ...prev,
                          [sol.solutionid]: {
                            ...prev[sol.solutionid],
                            newName: e.target.value || undefined,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`pub-${sol.solutionid}`} className="text-xs">
                      Publisher in Destination
                    </Label>
                    <Select
                      value={solutionOverrides[sol.solutionid]?.publisherUniqueName ?? ""}
                      onValueChange={(val) =>
                        setSolutionOverrides((prev) => ({
                          ...prev,
                          [sol.solutionid]: {
                            ...prev[sol.solutionid],
                            publisherUniqueName: val === "__keep__" ? undefined : val,
                          },
                        }))
                      }
                    >
                      <SelectTrigger id={`pub-${sol.solutionid}`}>
                        <SelectValue placeholder={loadingPublishers ? "Loading publishers…" : "Keep current publisher"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__keep__">Keep current publisher</SelectItem>
                        {publishers.map((p) => (
                          <SelectItem key={p.publisherid} value={p.uniquename}>
                            {p.friendlyname} ({p.customizationprefix})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {currentRun && (
        <>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      currentRun.status === "completed"
                        ? "success"
                        : currentRun.status === "failed"
                        ? "destructive"
                        : "default"
                    }
                  >
                    {currentRun.status.toUpperCase()}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {currentRun.completedItems + currentRun.failedItems} / {currentRun.totalItems} items
                  </span>
                </div>
                <span className="text-sm font-mono">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} />
              <div className="flex gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  {currentRun.completedItems} succeeded
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-red-500" />
                  {currentRun.failedItems} failed
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-yellow-500" />
                  {currentRun.warningItems} warnings
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Item Status List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Migration Log</CardTitle>
              <CardDescription>Real-time status per component</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {currentRun.items.map((item) => {
                    const config = statusConfig[item.status];
                    const Icon = config.icon;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border p-3"
                      >
                        <Icon
                          className={`h-5 w-5 shrink-0 ${config.color} ${
                            item.status === "in-progress" ? "animate-spin" : ""
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{item.name}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {item.type.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          {item.message && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.message}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            item.status === "success"
                              ? "success"
                              : item.status === "failed"
                              ? "destructive"
                              : item.status === "warning"
                              ? "warning"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {config.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(4)} disabled={isRunning}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              onClick={() => {
                abortRef.current = true;
              }}
            >
              <Pause className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
          {!isRunning && !currentRun && (
            <Button onClick={executeMigration}>
              <Play className="mr-2 h-4 w-4" />
              Start Migration
            </Button>
          )}
          {!isRunning && currentRun && (
            <Button onClick={() => setCurrentStep(6)}>
              View Report
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
