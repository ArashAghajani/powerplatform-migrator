"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useEnvironmentStore, useMigrationWizardStore } from "@/lib/stores";
import {
  listSolutions,
  listConnectionReferences,
  checkMissingDependencies,
  listSolutionConnectionReferences,
  getOrgMaxUploadSize,
} from "@/lib/api/power-platform";
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
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Info,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import type { ValidationResult, ValidationSeverity } from "@/lib/types";

const severityConfig: Record<
  ValidationSeverity,
  { icon: React.ComponentType<{ className?: string }>; color: string; label: string }
> = {
  error: { icon: XCircle, color: "text-red-500", label: "Error" },
  warning: { icon: AlertTriangle, color: "text-yellow-500", label: "Warning" },
  info: { icon: Info, color: "text-blue-500", label: "Info" },
};

export function StepValidation() {
  const { getDataverseToken } = useAuth();
  const sourceEnv = useEnvironmentStore((s) => s.sourceEnvironment);
  const targetEnv = useEnvironmentStore((s) => s.targetEnvironment);
  const {
    selections,
    solutions,
    validationResults,
    setValidationResults,
    setCurrentStep,
  } = useMigrationWizardStore();

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runValidation = useCallback(async () => {
    if (!sourceEnv?.orgUrl || !targetEnv?.orgUrl) return;
    setLoading(true);
    setError(null);
    setProgress(0);

    const results: ValidationResult[] = [];
    const enabledSelections = selections.filter((s) => s.enabled);
    const totalChecks = enabledSelections.length + 3;
    let completedChecks = 0;

    const tick = () => {
      completedChecks++;
      setProgress(Math.round((completedChecks / totalChecks) * 100));
    };

    try {
      const targetToken = await getDataverseToken(targetEnv.orgUrl);

      // Check 1: Target environment connectivity
      try {
        await listSolutions(targetToken, targetEnv.orgUrl);
        results.push({
          component: "Target Environment",
          componentType: "solutions",
          severity: "info",
          message: "Successfully connected to target environment",
        });
      } catch {
        results.push({
          component: "Target Environment",
          componentType: "solutions",
          severity: "error",
          message: "Cannot connect to target environment Dataverse API",
          resolution: "Verify the target environment has Dataverse provisioned and you have access",
        });
      }
      tick();

      // Check 1b: Max upload file size on target
      try {
        const orgInfo = await getOrgMaxUploadSize(targetToken, targetEnv.orgUrl);
        if (orgInfo.maxUploadFileSize < 10240) {
          results.push({
            component: "Max Upload File Size",
            componentType: "solutions",
            severity: "warning",
            message: `Target environment max upload size is ${Math.round(orgInfo.maxUploadFileSize / 1024)}MB. Solutions with large web resources (e.g. custom controls) may fail to import.`,
            resolution: "The migrator will automatically increase this to 128MB during import and restore it afterwards",
          });
        }
      } catch {
        // Non-blocking
      }

      const sourceToken = await getDataverseToken(sourceEnv.orgUrl);

      // Check 2: Solution version conflicts & missing dependencies
      const selectedSolutions = selections.find((s) => s.objectType === "solutions" && s.enabled);
      if (selectedSolutions && selectedSolutions.items.length > 0) {
        try {
          const targetSolutions = await listSolutions(targetToken, targetEnv.orgUrl);
          for (const solId of selectedSolutions.items) {
            const sourceSol = solutions.find((s) => s.solutionid === solId);
            if (!sourceSol) continue;
            const targetSol = targetSolutions.find((s) => s.uniquename === sourceSol.uniquename);
            if (targetSol) {
              if (targetSol.version === sourceSol.version) {
                results.push({
                  component: sourceSol.friendlyname,
                  componentType: "solutions",
                  severity: "warning",
                  message: `Solution "${sourceSol.friendlyname}" version ${sourceSol.version} already exists in target`,
                  resolution: "The import will overwrite the existing solution",
                });
              } else if (targetSol.version > sourceSol.version) {
                results.push({
                  component: sourceSol.friendlyname,
                  componentType: "solutions",
                  severity: "warning",
                  message: `Target has a newer version (${targetSol.version}) than source (${sourceSol.version})`,
                  resolution: "Consider whether you want to downgrade the target solution",
                });
              }
            }

            // Check missing dependencies using Dataverse API
            try {
              const missingDeps = await checkMissingDependencies(sourceToken, sourceEnv.orgUrl, sourceSol.uniquename);
              for (const dep of missingDeps) {
                const reqType = dep.requiredType.toLowerCase();

                let resolution: string;
                if (reqType.includes("field security profile")) {
                  resolution = "Field Security Profiles control column-level access. Create the profile manually in the target environment, or add the solution containing it (often in the Active/default layer) to your unmanaged solution before export.";
                } else if (reqType.includes("connection reference")) {
                  resolution = "Ensure the connection reference and its underlying connection exist in the target environment. Add the solution containing it to your migration, or create the connection manually in target.";
                } else if (reqType.includes("connector") || reqType.includes("custom connector")) {
                  resolution = "This component requires a Custom Connector. Import the managed solution containing the connector to the target first, or create the connector manually in the target environment.";
                } else if (reqType.includes("environment variable")) {
                  resolution = "Create the environment variable in the target, or include the solution that defines it in the migration.";
                } else if (reqType.includes("security role")) {
                  resolution = "Create the security role in the target environment, or include the solution containing it.";
                } else if (reqType.includes("table") || reqType.includes("entity")) {
                  resolution = "The referenced table must exist in the target. Include the solution that defines it in the migration.";
                } else {
                  resolution = `Ensure the ${dep.requiredType} "${dep.requiredDisplayName}" exists in the target environment, or include the solution that contains it (from: ${dep.requiredSolution}).`;
                }

                results.push({
                  component: dep.dependentDisplayName,
                  componentType: "solutions",
                  severity: "error",
                  message: `Missing dependency: "${dep.requiredDisplayName}" (${dep.requiredType}) is required by "${dep.dependentDisplayName}" (${dep.dependentType}). Source solution: ${dep.requiredSolution}`,
                  resolution,
                });
              }
              if (missingDeps.length === 0) {
                results.push({
                  component: sourceSol.friendlyname,
                  componentType: "solutions",
                  severity: "info",
                  message: "No missing dependencies detected for this solution",
                });
              }
            } catch {
              results.push({
                component: sourceSol.friendlyname,
                componentType: "solutions",
                severity: "warning",
                message: "Could not check missing dependencies (API may not be available)",
              });
            }

            // Check solution connection references exist in target
            try {
              const solConnRefs = await listSolutionConnectionReferences(sourceToken, sourceEnv.orgUrl, solId);
              if (solConnRefs.length > 0) {
                const targetRefs = await listConnectionReferences(targetToken, targetEnv.orgUrl);
                for (const srcRef of solConnRefs) {
                  const match = targetRefs.find(
                    (t) => t.connectionReferenceLogicalName === srcRef.connectionReferenceLogicalName || t.connectorId === srcRef.connectorId
                  );
                  if (!match) {
                    results.push({
                      component: srcRef.displayName,
                      componentType: "connection_references",
                      severity: "error",
                      message: `Connection reference "${srcRef.displayName}" (${srcRef.connectionReferenceLogicalName}) is used by this solution but has no matching connection in the target environment`,
                      resolution: "Create a connection for this connector in the target environment before importing the solution",
                    });
                  } else if (!match.connectionId) {
                    results.push({
                      component: srcRef.displayName,
                      componentType: "connection_references",
                      severity: "warning",
                      message: `Connection reference "${srcRef.displayName}" exists in target but has no active connection`,
                      resolution: "Set up an active connection for this reference in the target environment",
                    });
                  }
                }
              }
            } catch {
              // Non-blocking
            }
          }
        } catch {
          results.push({
            component: "Solution Check",
            componentType: "solutions",
            severity: "warning",
            message: "Could not validate solution versions in target",
          });
        }
      }
      tick();

      // Check 3: Validate selected tables exist in source (for data migration)
      const selectedTables = selections.find((s) => s.objectType === "tables" && s.enabled);
      if (selectedTables && selectedTables.items.length > 0) {
        results.push({
          component: "Table Data Migration",
          componentType: "tables",
          severity: "info",
          message: `${selectedTables.items.length} table(s) selected for data migration. Ensure table schemas exist in target (via solution import) before data is copied.`,
        });
      }
      tick();

      // If no errors, add success
      if (!results.some((r) => r.severity === "error")) {
        results.unshift({
          component: "Overall",
          componentType: "solutions",
          severity: "info",
          message: "Pre-migration validation passed. No blocking errors detected.",
        });
      }

      setValidationResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setLoading(false);
      setProgress(100);
    }
  }, [sourceEnv, targetEnv, getDataverseToken, selections, solutions, setValidationResults]);

  useEffect(() => {
    if (validationResults.length === 0) {
      runValidation();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const errorCount = validationResults.filter((r) => r.severity === "error").length;
  const warningCount = validationResults.filter((r) => r.severity === "warning").length;
  const infoCount = validationResults.filter((r) => r.severity === "info").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Pre-Migration Validation
          </h2>
          <p className="text-sm text-muted-foreground">
            Checking target environment for conflicts and missing dependencies
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={runValidation} disabled={loading}>
          {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Re-validate
        </Button>
      </div>

      {loading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Validating...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className={errorCount > 0 ? "border-red-500/30" : ""}>
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-8 w-8 text-red-500" />
            <div>
              <div className="text-2xl font-bold">{errorCount}</div>
              <div className="text-xs text-muted-foreground">Errors</div>
            </div>
          </CardContent>
        </Card>
        <Card className={warningCount > 0 ? "border-yellow-500/30" : ""}>
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-8 w-8 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold">{warningCount}</div>
              <div className="text-xs text-muted-foreground">Warnings</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <div>
              <div className="text-2xl font-bold">{infoCount}</div>
              <div className="text-xs text-muted-foreground">Passed</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Validation Results</CardTitle>
          <CardDescription>{validationResults.length} checks completed</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {validationResults.map((result, i) => {
                const config = severityConfig[result.severity];
                const Icon = config.icon;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${config.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{result.component}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {result.componentType.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{result.message}</p>
                      {result.resolution && (
                        <p className="text-xs text-primary mt-1">
                          Resolution: {result.resolution}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(2)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          disabled={errorCount > 0}
          onClick={() => setCurrentStep(4)}
        >
          {errorCount > 0 ? "Fix Errors to Continue" : "Next: Mapping"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
