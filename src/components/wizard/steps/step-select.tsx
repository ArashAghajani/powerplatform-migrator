"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import {
  useEnvironmentStore,
  useMigrationWizardStore,
} from "@/lib/stores";
import {
  listSolutions,
  listTables,
  listConnectionReferences,
  listEnvironmentVariables,
  listSecurityRoles,
} from "@/lib/api/power-platform";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  ArrowRight,
  Info,
  Package,
  Database,
  RefreshCw,
  Search,
} from "lucide-react";
import type { ConflictResolution } from "@/lib/types";

export function StepSelect() {
  const { getDataverseToken } = useAuth();
  const sourceEnvironment = useEnvironmentStore((s) => s.sourceEnvironment);

  const solutions = useMigrationWizardStore((s) => s.solutions);
  const tables = useMigrationWizardStore((s) => s.tables);
  const selections = useMigrationWizardStore((s) => s.selections);
  const isLoadingData = useMigrationWizardStore((s) => s.isLoadingData);
  const setSolutions = useMigrationWizardStore((s) => s.setSolutions);
  const setTables = useMigrationWizardStore((s) => s.setTables);
  const setConnectionRefs = useMigrationWizardStore((s) => s.setConnectionRefs);
  const setEnvVariables = useMigrationWizardStore((s) => s.setEnvVariables);
  const setSecurityRoles = useMigrationWizardStore((s) => s.setSecurityRoles);
  const toggleSelection = useMigrationWizardStore((s) => s.toggleSelection);
  const updateSelectionItems = useMigrationWizardStore((s) => s.updateSelectionItems);
  const updateConflictResolution = useMigrationWizardStore((s) => s.updateConflictResolution);
  const setIsLoadingData = useMigrationWizardStore((s) => s.setIsLoadingData);
  const setCurrentStep = useMigrationWizardStore((s) => s.setCurrentStep);

  const [solSearch, setSolSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const solSelection = selections.find((s) => s.objectType === "solutions");
  const tableSelection = selections.find((s) => s.objectType === "tables");
  const tableDataEnabled = tableSelection?.enabled || false;

  const loadSourceData = useCallback(async () => {
    if (!sourceEnvironment?.orgUrl) return;
    setIsLoadingData(true);
    setLoadError(null);
    try {
      const token = await getDataverseToken(sourceEnvironment.orgUrl);
      const [sols, tbls, refs, vars, roles] = await Promise.all([
        listSolutions(token, sourceEnvironment.orgUrl),
        listTables(token, sourceEnvironment.orgUrl),
        listConnectionReferences(token, sourceEnvironment.orgUrl),
        listEnvironmentVariables(token, sourceEnvironment.orgUrl),
        listSecurityRoles(token, sourceEnvironment.orgUrl),
      ]);
      setSolutions(sols.filter((s) => !s.ismanaged));
      setTables(tbls);
      setConnectionRefs(refs);
      setEnvVariables(vars);
      setSecurityRoles(roles);
    } catch (err: unknown) {
      console.error("Failed to load source data:", err);
      const msg = err instanceof Error
        ? err.message
        : (err && typeof err === "object" && "message" in err)
          ? String((err as { message: string }).message)
          : "Failed to load source data";
      setLoadError(msg);
    } finally {
      setIsLoadingData(false);
    }
  }, [sourceEnvironment, getDataverseToken, setSolutions, setTables, setConnectionRefs, setEnvVariables, setSecurityRoles, setIsLoadingData]);

  useEffect(() => {
    if (sourceEnvironment?.orgUrl && solutions.length === 0) {
      loadSourceData();
    }
  }, [sourceEnvironment, solutions.length, loadSourceData]);

  const anySolutionSelected = (solSelection?.items.length ?? 0) > 0;

  const filteredSolutions = solutions.filter((s) =>
    s.friendlyname.toLowerCase().includes(solSearch.toLowerCase()) ||
    s.uniquename.toLowerCase().includes(solSearch.toLowerCase())
  );

  const customTables = tables.filter((t) => t.isCustomEntity);
  const filteredTables = customTables.filter((t) =>
    t.displayName.toLowerCase().includes(tableSearch.toLowerCase()) ||
    t.logicalName.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Select Solutions to Migrate</h2>
          <p className="text-sm text-muted-foreground">
            Solutions contain all components — apps, flows, tables, connection references, environment variables, and security roles
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadSourceData} disabled={isLoadingData}>
          {isLoadingData ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {/* Info Banner */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 flex gap-3">
        <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How Solution Migration Works</p>
          <p className="mt-1">
            Importing a solution transfers all its components (table schemas, apps, flows, security roles, etc.) to the target environment.
            Table <strong>data (rows)</strong> is not included in solutions — use the optional Table Data Migration below to copy row data separately.
          </p>
        </div>
      </div>

      {/* ── Solutions Section ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Unmanaged Solutions</CardTitle>
                <CardDescription>
                  {solutions.length} solution{solutions.length !== 1 ? "s" : ""} found in source
                  {(solSelection?.items.length ?? 0) > 0 && (
                    <> &middot; <span className="text-primary font-medium">{solSelection!.items.length} selected</span></>
                  )}
                </CardDescription>
              </div>
            </div>
            {solutions.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const allSelected = solSelection?.items.length === solutions.length;
                  if (allSelected) {
                    updateSelectionItems("solutions", []);
                    toggleSelection("solutions", false);
                  } else {
                    updateSelectionItems("solutions", solutions.map((s) => s.solutionid));
                    toggleSelection("solutions", true);
                  }
                }}
              >
                {solSelection?.items.length === solutions.length ? "Deselect All" : "Select All"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {solutions.length > 5 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search solutions..."
                value={solSearch}
                onChange={(e) => setSolSearch(e.target.value)}
                className="pl-10 h-8 text-sm"
              />
            </div>
          )}

          {isLoadingData ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading solutions...
            </div>
          ) : filteredSolutions.length > 0 ? (
            <ScrollArea className={solutions.length > 6 ? "h-[300px]" : ""}>
              <div className="space-y-1">
                {filteredSolutions.map((sol) => (
                  <label
                    key={sol.solutionid}
                    className="flex items-start gap-3 rounded-lg border px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={solSelection?.items.includes(sol.solutionid) || false}
                      onCheckedChange={(checked) => {
                        const current = solSelection?.items || [];
                        const next = checked
                          ? [...current, sol.solutionid]
                          : current.filter((id) => id !== sol.solutionid);
                        updateSelectionItems("solutions", next);
                        toggleSelection("solutions", next.length > 0);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{sol.friendlyname}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          v{sol.version}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{sol.uniquename}</p>
                      {sol.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sol.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {solutions.length === 0 ? "No unmanaged solutions found in source environment" : "No solutions match your search"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Table Data Migration (Optional) ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Table Data Migration</CardTitle>
                <CardDescription>
                  Optionally copy row data for Dataverse tables
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Solutions carry table schema (columns, relationships) but not row data.
                  Enable this to copy actual records from source tables to target tables.
                </TooltipContent>
              </Tooltip>
              <Switch
                checked={tableDataEnabled}
                onCheckedChange={(checked) => {
                  toggleSelection("tables", checked);
                  if (!checked) {
                    updateSelectionItems("tables", []);
                  }
                }}
              />
            </div>
          </div>
        </CardHeader>

        {tableDataEnabled && (
          <CardContent className="space-y-3">
            <Separator />

            {/* Conflict resolution */}
            <div className="flex items-center gap-3">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Conflict Resolution:</Label>
              <Select
                value={tableSelection?.conflictResolution || "upsert"}
                onValueChange={(val) => updateConflictResolution("tables", val as ConflictResolution)}
              >
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip Existing</SelectItem>
                  <SelectItem value="upsert">Upsert (Update or Create)</SelectItem>
                  <SelectItem value="overwrite">Overwrite All</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {customTables.length > 5 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search tables..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="pl-10 h-8 text-sm"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {customTables.length} custom table{customTables.length !== 1 ? "s" : ""}
                {(tableSelection?.items.length ?? 0) > 0 && (
                  <> &middot; <span className="text-primary font-medium">{tableSelection!.items.length} selected</span></>
                )}
              </span>
              {customTables.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    const allSelected = tableSelection?.items.length === customTables.length;
                    if (allSelected) {
                      updateSelectionItems("tables", []);
                    } else {
                      updateSelectionItems("tables", customTables.map((t) => t.logicalName));
                    }
                  }}
                >
                  {tableSelection?.items.length === customTables.length ? "Deselect All" : "Select All"}
                </Button>
              )}
            </div>

            {filteredTables.length > 0 ? (
              <ScrollArea className={customTables.length > 6 ? "h-[240px]" : ""}>
                <div className="space-y-1">
                  {filteredTables.map((tbl) => (
                    <label
                      key={tbl.logicalName}
                      className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={tableSelection?.items.includes(tbl.logicalName) || false}
                        onCheckedChange={(checked) => {
                          const current = tableSelection?.items || [];
                          const next = checked
                            ? [...current, tbl.logicalName]
                            : current.filter((id) => id !== tbl.logicalName);
                          updateSelectionItems("tables", next);
                        }}
                      />
                      <span className="text-sm">{tbl.displayName}</span>
                      <span className="text-xs text-muted-foreground font-mono ml-auto">{tbl.logicalName}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {customTables.length === 0 ? "No custom tables found" : "No tables match your search"}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(0)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button disabled={!anySolutionSelected && !tableDataEnabled} onClick={() => setCurrentStep(2)}>
          Next: Dependency Analysis
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
