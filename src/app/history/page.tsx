"use client";

import { useMemo, useState } from "react";
import { useHistoryStore } from "@/lib/stores";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  History,
  Trash2,
  Download,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import type { MigrationRun } from "@/lib/types";

const statusConfig: Record<
  MigrationRun["status"],
  { label: string; variant: "default" | "success" | "destructive" | "warning"; icon: typeof Clock }
> = {
  pending: { label: "Pending", variant: "default", icon: Clock },
  running: { label: "Running", variant: "warning", icon: Clock },
  completed: { label: "Completed", variant: "success", icon: CheckCircle },
  "completed-with-errors": { label: "Completed with Errors", variant: "warning", icon: AlertTriangle },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
  aborted: { label: "Aborted", variant: "destructive", icon: XCircle },
  "rolled-back": { label: "Rolled Back", variant: "warning", icon: AlertTriangle },
};

function formatDuration(start: string, end?: string): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.floor((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function downloadRunReport(run: MigrationRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `migration-run-${run.id.slice(0, 8)}-${new Date(run.startedAt).toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HistoryPage() {
  const { runs, removeRun, clearHistory } = useHistoryStore();
  const [search, setSearch] = useState("");
  const [selectedRun, setSelectedRun] = useState<MigrationRun | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const filteredRuns = useMemo(() => {
    if (!search) return runs;
    const lower = search.toLowerCase();
    return runs.filter(
      (r) =>
        r.sourceEnvironment.id.toLowerCase().includes(lower) ||
        r.targetEnvironment.id.toLowerCase().includes(lower) ||
        r.id.toLowerCase().includes(lower) ||
        r.status.toLowerCase().includes(lower)
    );
  }, [runs, search]);

  const sortedRuns = useMemo(
    () => [...filteredRuns].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [filteredRuns]
  );

  const stats = useMemo(() => {
    return {
      total: runs.length,
      completed: runs.filter((r) => r.status === "completed").length,
      failed: runs.filter((r) => r.status === "failed" || r.status === "aborted").length,
      withErrors: runs.filter((r) => r.status === "completed-with-errors").length,
    };
  }, [runs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Migration History</h1>
          <p className="text-muted-foreground">View past migration runs and download reports</p>
        </div>
        {runs.length > 0 && (
          <Button variant="outline" onClick={() => setClearDialogOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear History
          </Button>
        )}
      </div>

      {/* Stats */}
      {runs.length > 0 && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Runs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Successful</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>With Errors</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.withErrors}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed / Aborted</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search */}
      {runs.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by environment or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* Runs list */}
      {runs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <History className="h-16 w-16 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-semibold">No Migration History</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Run a migration from the wizard to see it here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-380px)]">
          <div className="space-y-3">
            {sortedRuns.map((run) => {
              const cfg = statusConfig[run.status];
              const Icon = cfg.icon;
              const succeeded = run.items.filter((i) => i.status === "success").length;
              const failed = run.items.filter((i) => i.status === "failed").length;
              const total = run.items.length;

              return (
                <Card key={run.id} className="hover:bg-accent/50 transition-colors">
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={cfg.variant}>
                          <Icon className="mr-1 h-3 w-3" />
                          {cfg.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          {run.id.slice(0, 8)}...
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">
                          {succeeded}/{total} succeeded
                          {failed > 0 && (
                            <span className="text-destructive"> · {failed} failed</span>
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(run.startedAt).toLocaleString()} ·{" "}
                        {formatDuration(run.startedAt, run.completedAt ?? undefined)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => downloadRunReport(run)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRun(run.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSelectedRun(run)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Run detail dialog */}
      <Dialog open={!!selectedRun} onOpenChange={(open) => !open && setSelectedRun(null)}>
        {selectedRun && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Run Details</DialogTitle>
              <DialogDescription className="font-mono text-xs">{selectedRun.id}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <div className="mt-1">
                    <Badge variant={statusConfig[selectedRun.status].variant}>
                      {statusConfig[selectedRun.status].label}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration</span>
                  <div className="mt-1 font-medium">
                    {formatDuration(selectedRun.startedAt, selectedRun.completedAt ?? undefined)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Started</span>
                  <div className="mt-1">{new Date(selectedRun.startedAt).toLocaleString()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Completed</span>
                  <div className="mt-1">
                    {selectedRun.completedAt
                      ? new Date(selectedRun.completedAt).toLocaleString()
                      : "—"}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Items ({selectedRun.items.length})</h4>
                <ScrollArea className="h-48">
                  <div className="space-y-1">
                    {selectedRun.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm py-1">
                        <span className="truncate flex-1">{item.name}</span>
                        <Badge
                          variant={
                            item.status === "success"
                              ? "success"
                              : item.status === "failed"
                              ? "destructive"
                              : item.status === "skipped"
                              ? "warning"
                              : "secondary"
                          }
                          className="text-[10px] ml-2"
                        >
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => downloadRunReport(selectedRun)}>
                <Download className="mr-2 h-4 w-4" />
                Download Report
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Clear history confirmation */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Migration History</DialogTitle>
            <DialogDescription>
              This will permanently delete all {runs.length} migration run records. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearHistory();
                setClearDialogOpen(false);
              }}
            >
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
