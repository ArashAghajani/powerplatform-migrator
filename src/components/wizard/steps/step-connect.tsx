"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useEnvironmentStore, useMigrationWizardStore } from "@/lib/stores";
import { listEnvironments } from "@/lib/api/power-platform";
import { checkPacAvailability, installPacCli } from "@/lib/api/pac-cli";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LogIn, RefreshCw, ArrowRight, Server, Globe, Info, User, Building2,
  Download, CheckCircle2, AlertTriangle, ArrowRightLeft, LogOut,
} from "lucide-react";
import type { MigrationType, PowerPlatformEnvironment } from "@/lib/types";
import type { AccountInfo } from "@azure/msal-browser";

export function StepConnect() {
  const {
    isAuthenticated, isLoading: authLoading, login, account, error: authError,
    targetAccount, loginForTarget, logoutTarget,
    getPowerPlatformAdminToken, getTargetAdminToken, registerOrgAccount,
  } = useAuth();

  const {
    environments, sourceEnvironment, targetEnvironment,
    targetEnvironments, isLoading, isLoadingTarget,
    migrationType,
    setEnvironments, setSourceEnvironment, setTargetEnvironment,
    setTargetEnvironments, setIsLoading, setIsLoadingTarget,
    setMigrationType,
  } = useEnvironmentStore();

  const setCurrentStep = useMigrationWizardStore((s) => s.setCurrentStep);

  const [pacStatus, setPacStatus] = useState<"checking" | "installed" | "not-installed" | "installing" | "install-failed">("checking");
  const [pacInstallMsg, setPacInstallMsg] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [targetFetchError, setTargetFetchError] = useState<string | null>(null);

  // Check PAC CLI on mount
  useEffect(() => {
    checkPacAvailability().then((available) => {
      setPacStatus(available ? "installed" : "not-installed");
    });
  }, []);

  // Load source environments
  const loadEnvironments = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const token = await getPowerPlatformAdminToken();
      const envs = await listEnvironments(token);
      setEnvironments(envs);
      if (account) {
        envs.forEach((env) => registerOrgAccount(env.orgUrl, account));
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load environments");
    } finally {
      setIsLoading(false);
    }
  }, [getPowerPlatformAdminToken, setEnvironments, setIsLoading, account, registerOrgAccount]);

  // Load target environments (cross-tenant)
  const loadTargetEnvironments = useCallback(async () => {
    setIsLoadingTarget(true);
    setTargetFetchError(null);
    try {
      const token = await getTargetAdminToken();
      const envs = await listEnvironments(token);
      setTargetEnvironments(envs);
      if (targetAccount) {
        envs.forEach((env) => registerOrgAccount(env.orgUrl, targetAccount));
      }
    } catch (err) {
      setTargetFetchError(err instanceof Error ? err.message : "Failed to load target environments");
    } finally {
      setIsLoadingTarget(false);
    }
  }, [getTargetAdminToken, setTargetEnvironments, setIsLoadingTarget, targetAccount, registerOrgAccount]);

  // PAC CLI install
  const handleInstallPac = useCallback(async () => {
    setPacStatus("installing");
    setPacInstallMsg("");
    try {
      const result = await installPacCli();
      if (result.success) {
        setPacStatus("installed");
        setPacInstallMsg(result.message);
      } else {
        setPacStatus("install-failed");
        setPacInstallMsg(result.message);
      }
    } catch {
      setPacStatus("install-failed");
      setPacInstallMsg("Installation failed. Please install PAC CLI manually.");
    }
  }, []);

  // Mode change
  const handleModeChange = useCallback((mode: MigrationType) => {
    setMigrationType(mode);
    setTargetEnvironment(null);
    if (mode === "same-tenant") {
      setTargetEnvironments([]);
    }
  }, [setMigrationType, setTargetEnvironment, setTargetEnvironments]);

  const handleLogin = async () => {
    await login();
  };

  const availableTargetEnvs = migrationType === "cross-tenant" ? targetEnvironments : environments;
  const canProceed =
    isAuthenticated &&
    sourceEnvironment &&
    targetEnvironment &&
    sourceEnvironment.id !== targetEnvironment.id &&
    (migrationType === "same-tenant" || !!targetAccount);

  return (
    <div className="space-y-6">
      {/* PAC CLI Status */}
      <PacCliBanner status={pacStatus} message={pacInstallMsg} onInstall={handleInstallPac} />

      {/* Migration Mode */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-5 w-5" />
            Migration Mode
          </CardTitle>
          <CardDescription>
            Choose whether source and target are in the same or different Azure AD tenants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <button
              className={`rounded-lg border-2 p-4 text-left transition-colors ${
                migrationType === "same-tenant"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30"
              }`}
              onClick={() => handleModeChange("same-tenant")}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                <Building2 className="h-4 w-4" />
                Same Tenant
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Migrate between environments in the same Azure AD tenant
              </p>
            </button>
            <button
              className={`rounded-lg border-2 p-4 text-left transition-colors ${
                migrationType === "cross-tenant"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30"
              }`}
              onClick={() => handleModeChange("cross-tenant")}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                <ArrowRightLeft className="h-4 w-4" />
                Cross-Tenant
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Migrate between environments in different Azure AD tenants
              </p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Same-Tenant Mode ── */}
      {migrationType === "same-tenant" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LogIn className="h-5 w-5" />
                Authentication
              </CardTitle>
              <CardDescription>
                Sign in with your Azure AD account to access Power Platform environments
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isAuthenticated ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="rounded-full bg-muted p-6">
                    <LogIn className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center max-w-md">
                    Authenticate using your Microsoft Azure Active Directory credentials.
                    This will grant access to the Power Platform Admin API and Dataverse Web API.
                  </p>
                  <Button size="lg" onClick={handleLogin} disabled={authLoading}>
                    {authLoading ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    Sign in with Microsoft
                  </Button>
                  {authError && <p className="text-sm text-destructive">{authError}</p>}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-green-500" />
                      <span className="text-sm font-medium">Authenticated</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadEnvironments} disabled={isLoading}>
                      {isLoading ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {environments.length > 0 ? "Refresh Environments" : "Load Environments"}
                    </Button>
                  </div>
                  {account && <AccountInfoCard account={account} />}
                </div>
              )}
            </CardContent>
          </Card>

          {isAuthenticated && environments.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              <EnvironmentSelector
                label="Source Environment"
                icon={<Server className="h-4 w-4 text-blue-500" />}
                tooltip="The environment from which solutions, apps, flows, and data will be exported"
                environments={environments}
                selected={sourceEnvironment}
                onSelect={setSourceEnvironment}
                disabledId={targetEnvironment?.id}
              />
              <EnvironmentSelector
                label="Target Environment"
                icon={<Globe className="h-4 w-4 text-green-500" />}
                tooltip="The environment where solutions, apps, flows, and data will be imported"
                environments={availableTargetEnvs}
                selected={targetEnvironment}
                onSelect={setTargetEnvironment}
                disabledId={sourceEnvironment?.id}
              />
            </div>
          )}

          {fetchError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              {fetchError}
            </div>
          )}
        </>
      )}

      {/* ── Cross-Tenant Mode ── */}
      {migrationType === "cross-tenant" && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Source Tenant */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-blue-500" />
                Source Tenant
              </CardTitle>
              <CardDescription>
                Sign in and select the source environment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isAuthenticated ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <p className="text-xs text-muted-foreground text-center">
                    Sign in to your source Azure AD tenant
                  </p>
                  <Button onClick={handleLogin} disabled={authLoading}>
                    {authLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                    Sign in to Source Tenant
                  </Button>
                  {authError && <p className="text-xs text-destructive">{authError}</p>}
                </div>
              ) : (
                <>
                  {account && <AccountInfoCard account={account} />}
                  <Button variant="outline" size="sm" onClick={loadEnvironments} disabled={isLoading}>
                    {isLoading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                    {environments.length > 0 ? "Refresh" : "Load Environments"}
                  </Button>
                  {environments.length > 0 && (
                    <>
                      <EnvironmentDropdown
                        environments={environments}
                        selected={sourceEnvironment}
                        onSelect={setSourceEnvironment}
                        placeholder="Select source environment"
                      />
                      {sourceEnvironment && <EnvironmentDetails env={sourceEnvironment} />}
                    </>
                  )}
                  {fetchError && <ErrorMsg message={fetchError} />}
                </>
              )}
            </CardContent>
          </Card>

          {/* Target Tenant */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4 text-green-500" />
                Target Tenant
              </CardTitle>
              <CardDescription>
                Sign in to a different tenant for the target environment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!targetAccount ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <p className="text-xs text-muted-foreground text-center">
                    Sign in with credentials for the target Azure AD tenant
                  </p>
                  <Button onClick={loginForTarget} disabled={!isAuthenticated}>
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign in to Target Tenant
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center max-w-xs">
                    Your Azure AD app registration must support multi-tenant access
                    (Supported account types: &quot;Accounts in any organizational directory&quot;)
                  </p>
                  {authError && <p className="text-xs text-destructive">{authError}</p>}
                </div>
              ) : (
                <>
                  <AccountInfoCard account={targetAccount} />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={loadTargetEnvironments} disabled={isLoadingTarget}>
                      {isLoadingTarget && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                      {targetEnvironments.length > 0 ? "Refresh" : "Load Environments"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={logoutTarget}>
                      <LogOut className="mr-2 h-3.5 w-3.5" />
                      Disconnect
                    </Button>
                  </div>
                  {targetEnvironments.length > 0 && (
                    <>
                      <EnvironmentDropdown
                        environments={targetEnvironments}
                        selected={targetEnvironment}
                        onSelect={setTargetEnvironment}
                        placeholder="Select target environment"
                      />
                      {targetEnvironment && <EnvironmentDetails env={targetEnvironment} />}
                    </>
                  )}
                  {targetFetchError && <ErrorMsg message={targetFetchError} />}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Next Step */}
      {isAuthenticated && (
        <div className="flex justify-end">
          <Button
            size="lg"
            disabled={!canProceed}
            onClick={() => setCurrentStep(1)}
          >
            Next: Select Objects
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

function PacCliBanner({
  status,
  message,
  onInstall,
}: {
  status: "checking" | "installed" | "not-installed" | "installing" | "install-failed";
  message: string;
  onInstall: () => void;
}) {
  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span>Checking PAC CLI...</span>
      </div>
    );
  }
  if (status === "installed") {
    return (
      <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>PAC CLI detected — ready for solution migration</span>
      </div>
    );
  }
  return (
    <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">PAC CLI Not Detected</p>
            <p className="text-xs text-muted-foreground">
              Power Platform CLI is required for solution export &amp; import.
            </p>
            {status === "install-failed" && message && (
              <p className="text-xs text-destructive">{message}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            disabled={status === "installing"}
          >
            {status === "installing" ? (
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-2 h-3.5 w-3.5" />
            )}
            {status === "installing" ? "Installing..." : "Auto Install"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountInfoCard({ account }: { account: AccountInfo }) {
  return (
    <div className="rounded-md border bg-muted/50 p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
      <div className="flex items-center gap-2">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        <div>
          <span className="text-muted-foreground">Signed in as</span>
          <p className="font-medium">{account.name || account.username}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        <div>
          <span className="text-muted-foreground">Account</span>
          <p className="font-medium">{account.username}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <div>
          <span className="text-muted-foreground">Tenant ID</span>
          <p className="font-mono font-medium truncate max-w-[200px]">{account.tenantId}</p>
        </div>
      </div>
    </div>
  );
}

function EnvironmentSelector({
  label,
  icon,
  tooltip,
  environments,
  selected,
  onSelect,
  disabledId,
}: {
  label: string;
  icon: React.ReactNode;
  tooltip: string;
  environments: PowerPlatformEnvironment[];
  selected: PowerPlatformEnvironment | null;
  onSelect: (env: PowerPlatformEnvironment | null) => void;
  disabledId?: string;
}) {
  const envTypeColor = (type: string) => {
    switch (type) {
      case "Production": return "destructive" as const;
      case "Sandbox": return "warning" as const;
      case "Developer": return "success" as const;
      default: return "secondary" as const;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {label}
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={selected?.id || ""}
          onValueChange={(val) => {
            const env = environments.find((e) => e.id === val);
            onSelect(env || null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {environments.map((env) => (
              <SelectItem key={env.id} value={env.id} disabled={env.id === disabledId}>
                <div className="flex items-center gap-2">
                  <span>{env.displayName}</span>
                  <Badge variant={envTypeColor(env.type)} className="text-[10px] py-0">
                    {env.type}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && <EnvironmentDetails env={selected} />}
      </CardContent>
    </Card>
  );
}

function EnvironmentDropdown({
  environments,
  selected,
  onSelect,
  placeholder,
}: {
  environments: PowerPlatformEnvironment[];
  selected: PowerPlatformEnvironment | null;
  onSelect: (env: PowerPlatformEnvironment | null) => void;
  placeholder: string;
}) {
  const envTypeColor = (type: string) => {
    switch (type) {
      case "Production": return "destructive" as const;
      case "Sandbox": return "warning" as const;
      case "Developer": return "success" as const;
      default: return "secondary" as const;
    }
  };

  return (
    <Select
      value={selected?.id || ""}
      onValueChange={(val) => {
        const env = environments.find((e) => e.id === val);
        onSelect(env || null);
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {environments.map((env) => (
          <SelectItem key={env.id} value={env.id}>
            <div className="flex items-center gap-2">
              <span>{env.displayName}</span>
              <Badge variant={envTypeColor(env.type)} className="text-[10px] py-0">
                {env.type}
              </Badge>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EnvironmentDetails({ env }: { env: PowerPlatformEnvironment }) {
  return (
    <div className="rounded-md border bg-muted/50 p-3 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Region</span>
        <span className="font-medium">{env.location || "N/A"}</span>
      </div>
      <Separator />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Type</span>
        <Badge variant={env.type === "Production" ? "destructive" : "secondary"} className="text-[10px] py-0">
          {env.type}
        </Badge>
      </div>
      <Separator />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Dataverse URL</span>
        <span className="font-mono text-[10px] max-w-[200px] truncate">
          {env.orgUrl || "No Dataverse"}
        </span>
      </div>
      <Separator />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">State</span>
        <div className="flex items-center gap-1">
          <div className={`h-2 w-2 rounded-full ${env.state === "Enabled" ? "bg-green-500" : "bg-yellow-500"}`} />
          <span>{env.state}</span>
        </div>
      </div>
      {env.tenantId && (
        <>
          <Separator />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Tenant</span>
            <span className="font-mono text-[10px] max-w-[200px] truncate">{env.tenantId}</span>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
      {message}
    </div>
  );
}
