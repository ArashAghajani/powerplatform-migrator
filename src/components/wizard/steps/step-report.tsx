"use client";

import { useMigrationExecutionStore, useMigrationWizardStore, useSnapshotStore } from "@/lib/stores";
import { useEnvironmentStore } from "@/lib/stores";
import { useAuth } from "@/lib/auth/auth-context";
import { restoreSnapshot } from "@/lib/api/power-platform";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Download,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

export function StepReport() {
  const { getDataverseToken } = useAuth();
  const targetEnv = useEnvironmentStore((s) => s.targetEnvironment);
  const currentRun = useMigrationExecutionStore((s) => s.currentRun);
  const setCurrentStep = useMigrationWizardStore((s) => s.setCurrentStep);
  const reset = useMigrationWizardStore((s) => s.reset);
  const getSnapshot = useSnapshotStore((s) => s.getSnapshot);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);

  if (!currentRun) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">No migration run data available.</p>
        <Button variant="outline" onClick={() => setCurrentStep(5)}>
          Go to Execution
        </Button>
      </div>
    );
  }

  const duration =
    currentRun.startedAt && currentRun.completedAt
      ? Math.round(
          (new Date(currentRun.completedAt).getTime() -
            new Date(currentRun.startedAt).getTime()) /
            1000
        )
      : null;

  const downloadReport = (format: "json" | "csv") => {
    const reportData = {
      id: currentRun.id,
      name: currentRun.name,
      status: currentRun.status,
      source: currentRun.sourceEnvironment.displayName,
      target: currentRun.targetEnvironment.displayName,
      startedAt: currentRun.startedAt,
      completedAt: currentRun.completedAt,
      duration: duration ? `${duration}s` : "N/A",
      totalItems: currentRun.totalItems,
      completedItems: currentRun.completedItems,
      failedItems: currentRun.failedItems,
      warningItems: currentRun.warningItems,
      items: currentRun.items.map((item) => ({
        name: item.name,
        type: item.type,
        status: item.status,
        message: item.message || "",
        startedAt: item.startedAt || "",
        completedAt: item.completedAt || "",
      })),
    };

    let content: string;
    let mimeType: string;
    let extension: string;

    if (format === "json") {
      content = JSON.stringify(reportData, null, 2);
      mimeType = "application/json";
      extension = "json";
    } else {
      const headers = ["Name", "Type", "Status", "Message", "Started", "Completed"];
      const rows = reportData.items.map((item) =>
        [item.name, item.type, item.status, `"${item.message}"`, item.startedAt, item.completedAt].join(",")
      );
      content = [headers.join(","), ...rows].join("\n");
      mimeType = "text/csv";
      extension = "csv";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-report-${currentRun.id.slice(0, 8)}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRollback = async () => {
    if (!currentRun.snapshotId || !targetEnv?.orgUrl) return;
    const snapshot = getSnapshot(currentRun.snapshotId);
    if (!snapshot?.data) return;

    setIsRollingBack(true);
    setRollbackStatus(null);
    try {
      const token = await getDataverseToken(targetEnv.orgUrl);
      await restoreSnapshot(token, targetEnv.orgUrl, snapshot.data);
      setRollbackStatus("Rollback completed successfully.");
    } catch (err) {
      setRollbackStatus(
        `Rollback failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Post-Migration Report
          </h2>
          <p className="text-sm text-muted-foreground">
            Summary of the migration run and results
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadReport("json")}>
            <Download className="mr-2 h-4 w-4" />
            JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadReport("csv")}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Badge
              variant={
                currentRun.status === "completed" ? "success" : currentRun.status === "failed" ? "destructive" : "default"
              }
              className="text-sm px-3 py-1"
            >
              {currentRun.status.toUpperCase()}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            <div>
              <div className="text-xl font-bold">{currentRun.completedItems}</div>
              <div className="text-xs text-muted-foreground">Succeeded</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-6 w-6 text-red-500" />
            <div>
              <div className="text-xl font-bold">{currentRun.failedItems}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-6 w-6 text-muted-foreground" />
            <div>
              <div className="text-xl font-bold">{duration ? `${duration}s` : "—"}</div>
              <div className="text-xs text-muted-foreground">Duration</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Migration Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Source</span>
            <span className="font-medium">{currentRun.sourceEnvironment.displayName}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Target</span>
            <span className="font-medium">{currentRun.targetEnvironment.displayName}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Started</span>
            <span className="font-mono text-xs">{new Date(currentRun.startedAt).toLocaleString()}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Completed</span>
            <span className="font-mono text-xs">
              {currentRun.completedAt ? new Date(currentRun.completedAt).toLocaleString() : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Item Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Component Results</CardTitle>
          <CardDescription>{currentRun.items.length} components processed</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[250px]">
            <div className="space-y-2">
              {currentRun.items.map((item) => {
                const icon =
                  item.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : item.status === "failed" ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : item.status === "warning" ? (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  );
                return (
                  <div key={item.id} className="flex flex-col gap-1 rounded-md border p-2.5">
                    <div className="flex items-center gap-3">
                      {icon}
                      <span className="text-sm flex-1 font-medium">{item.name}</span>
                      <Badge
                        variant={
                          item.status === "success" ? "success"
                            : item.status === "failed" ? "destructive"
                            : item.status === "warning" ? "outline"
                            : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {item.status}
                      </Badge>
                    </div>
                    {item.message && (
                      <p className={`text-xs ml-7 ${item.status === "failed" ? "text-red-500" : "text-muted-foreground"}`}>
                        {item.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Rollback */}
      {currentRun.snapshotId && currentRun.status === "failed" && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Rollback Available
            </CardTitle>
            <CardDescription>
              A snapshot was created before migration. You can restore the target environment to its previous state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="destructive"
              onClick={handleRollback}
              disabled={isRollingBack}
            >
              {isRollingBack ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Rollback Target Environment
            </Button>
            {rollbackStatus && (
              <p className="text-sm text-muted-foreground">{rollbackStatus}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(5)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Execution
        </Button>
        <Button
          onClick={() => {
            reset();
            useMigrationExecutionStore.getState().setCurrentRun(null);
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Start New Migration
        </Button>
      </div>
    </div>
  );
}
