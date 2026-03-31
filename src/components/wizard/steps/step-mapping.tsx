"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useEnvironmentStore, useMigrationWizardStore } from "@/lib/stores";
import {
  listConnectionReferences,
  listSolutionConnectionReferences,
  listSolutionEnvironmentVariables,
} from "@/lib/api/power-platform";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Info,
  Plug,
  Settings2,
  RefreshCw,
} from "lucide-react";
import type { ConnectionMapping, ConnectionReference, EnvironmentVariable, EnvironmentVariableMapping } from "@/lib/types";

export function StepMapping() {
  const { getDataverseToken } = useAuth();
  const sourceEnv = useEnvironmentStore((s) => s.sourceEnvironment);
  const targetEnv = useEnvironmentStore((s) => s.targetEnvironment);
  const {
    selections,
    solutions,
    connectionMappings,
    envVariableMappings,
    setConnectionMappings,
    setEnvVariableMappings,
    setCurrentStep,
  } = useMigrationWizardStore();

  const [targetConnections, setTargetConnections] = useState<ConnectionReference[]>([]);
  const [solutionConnRefs, setSolutionConnRefs] = useState<ConnectionReference[]>([]);
  const [solutionEnvVars, setSolutionEnvVars] = useState<EnvironmentVariable[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedSolutionIds = selections.find((s) => s.objectType === "solutions")?.items || [];

  const loadMappingData = useCallback(async () => {
    if (!sourceEnv?.orgUrl || !targetEnv?.orgUrl || selectedSolutionIds.length === 0) return;
    setLoading(true);
    try {
      const [sourceToken, targetToken] = await Promise.all([
        getDataverseToken(sourceEnv.orgUrl),
        getDataverseToken(targetEnv.orgUrl),
      ]);

      // Fetch connection refs and env vars scoped to selected solutions
      const connRefPromises = selectedSolutionIds.map((solId) =>
        listSolutionConnectionReferences(sourceToken, sourceEnv.orgUrl, solId)
      );
      const envVarPromises = selectedSolutionIds.map((solId) =>
        listSolutionEnvironmentVariables(sourceToken, sourceEnv.orgUrl, solId)
      );

      const [connRefResults, envVarResults, targetRefs] = await Promise.all([
        Promise.all(connRefPromises),
        Promise.all(envVarPromises),
        listConnectionReferences(targetToken, targetEnv.orgUrl),
      ]);

      // De-duplicate across solutions
      const connRefMap = new Map<string, ConnectionReference>();
      for (const refs of connRefResults) {
        for (const ref of refs) connRefMap.set(ref.id, ref);
      }
      const uniqueConnRefs = Array.from(connRefMap.values());

      const envVarMap = new Map<string, EnvironmentVariable>();
      for (const vars of envVarResults) {
        for (const v of vars) envVarMap.set(v.id, v);
      }
      const uniqueEnvVars = Array.from(envVarMap.values());

      setSolutionConnRefs(uniqueConnRefs);
      setSolutionEnvVars(uniqueEnvVars);
      setTargetConnections(targetRefs);

      // Initialize connection mappings
      if (uniqueConnRefs.length > 0) {
        const mappings: ConnectionMapping[] = uniqueConnRefs.map((ref) => {
          // Preserve existing mapping if already set
          const existing = connectionMappings.find((m) => m.sourceRef.id === ref.id);
          if (existing) return existing;
          const matchingTarget = targetRefs.find((t) => t.connectorId === ref.connectorId);
          return {
            sourceRef: ref,
            targetConnectionId: matchingTarget?.connectionId || "",
            targetConnectionName: matchingTarget?.displayName || "",
          };
        });
        setConnectionMappings(mappings);
      } else {
        setConnectionMappings([]);
      }

      // Initialize env variable mappings
      if (uniqueEnvVars.length > 0) {
        const mappings: EnvironmentVariableMapping[] = uniqueEnvVars.map((v) => {
          const existing = envVariableMappings.find((m) => m.variable.id === v.id);
          if (existing) return existing;
          return {
            variable: v,
            targetValue: v.currentValue || v.defaultValue || "",
          };
        });
        setEnvVariableMappings(mappings);
      } else {
        setEnvVariableMappings([]);
      }
    } catch (err) {
      console.error("Failed to load mapping data:", err);
    } finally {
      setLoading(false);
    }
  }, [sourceEnv, targetEnv, getDataverseToken, selectedSolutionIds, connectionMappings, envVariableMappings, setConnectionMappings, setEnvVariableMappings]);

  useEffect(() => {
    loadMappingData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateConnectionMapping = (refId: string, targetId: string, targetName: string) => {
    setConnectionMappings(
      connectionMappings.map((m) =>
        m.sourceRef.id === refId
          ? { ...m, targetConnectionId: targetId, targetConnectionName: targetName }
          : m
      )
    );
  };

  const updateEnvVarMapping = (varId: string, targetValue: string) => {
    setEnvVariableMappings(
      envVariableMappings.map((m) =>
        m.variable.id === varId ? { ...m, targetValue } : m
      )
    );
  };

  const connRefsEnabled = solutionConnRefs.length > 0;
  const envVarsEnabled = solutionEnvVars.length > 0;
  const hasContent = connRefsEnabled || envVarsEnabled;

  const selectedSolNames = selectedSolutionIds
    .map((id) => solutions.find((s) => s.solutionid === id)?.friendlyname)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Mapping Configuration
          </h2>
          <p className="text-sm text-muted-foreground">
            Map connection references and environment variables from your selected solution{selectedSolutionIds.length > 1 ? "s" : ""}{selectedSolNames ? `: ${selectedSolNames}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadMappingData} disabled={loading}>
          {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-3 py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading solution components...</p>
          </CardContent>
        </Card>
      ) : !hasContent ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <ArrowRightLeft className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              No connection references or environment variables found in the selected solution{selectedSolutionIds.length > 1 ? "s" : ""}.
              <br />You can proceed to the next step.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={connRefsEnabled ? "connections" : "variables"}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="connections" disabled={!connRefsEnabled}>
              <Plug className="mr-2 h-4 w-4" />
              Connection References
              {connRefsEnabled && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {connectionMappings.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="variables" disabled={!envVarsEnabled}>
              <Settings2 className="mr-2 h-4 w-4" />
              Environment Variables
              {envVarsEnabled && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {envVariableMappings.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Connection References Tab */}
          <TabsContent value="connections">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Connection Reference Mapping
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Map each connection reference from the source to an existing connection in the target environment.
                      Flows and apps will use these mapped connections after migration.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  For each source connection reference, select the corresponding target connection
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {connectionMappings.map((mapping) => (
                      <div
                        key={mapping.sourceRef.id}
                        className="grid grid-cols-[1fr,auto,1fr] gap-4 items-center rounded-lg border p-4"
                      >
                        {/* Source */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Source</Label>
                          <div className="mt-1 rounded-md bg-muted p-2">
                            <p className="text-sm font-medium">{mapping.sourceRef.displayName}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {mapping.sourceRef.connectorId}
                            </p>
                          </div>
                        </div>

                        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />

                        {/* Target */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Target Connection</Label>
                          <Select
                            value={mapping.targetConnectionId || "none"}
                            onValueChange={(val) => {
                              const target = targetConnections.find((c) => c.connectionId === val);
                              updateConnectionMapping(
                                mapping.sourceRef.id,
                                val === "none" ? "" : val,
                                target?.displayName || ""
                              );
                            }}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select target connection" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-- Not Mapped --</SelectItem>
                              {targetConnections
                                .filter((c) => c.connectorId === mapping.sourceRef.connectorId)
                                .map((c) => (
                                  <SelectItem key={c.connectionId} value={c.connectionId || c.id}>
                                    {c.displayName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Environment Variables Tab */}
          <TabsContent value="variables">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Environment Variable Values
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Set the value for each environment variable in the target environment.
                      These may differ between dev, test, and production.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Review and set variable values for the target environment
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {envVariableMappings.map((mapping) => (
                      <div key={mapping.variable.id} className="rounded-lg border p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium">{mapping.variable.displayName}</span>
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {mapping.variable.type}
                            </Badge>
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">
                            {mapping.variable.schemaName}
                          </span>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-xs text-muted-foreground">Source Value</Label>
                            <div className="mt-1 rounded-md bg-muted p-2 text-sm font-mono min-h-[36px]">
                              {mapping.variable.currentValue ||
                                mapping.variable.defaultValue ||
                                "(empty)"}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Target Value</Label>
                            <Input
                              className="mt-1 font-mono text-sm"
                              value={mapping.targetValue}
                              onChange={(e) =>
                                updateEnvVarMapping(mapping.variable.id, e.target.value)
                              }
                              placeholder="Enter target value..."
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(3)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={() => setCurrentStep(5)}>
          Next: Execute Migration
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
