/**
 * Client-side helpers that call the PAC CLI backend API routes.
 * PAC CLI handles large solutions (incl. custom controls with big web resources)
 * that exceed the Dataverse Web API's built-in web resource size limits.
 */

export async function checkPacAvailability(): Promise<boolean> {
  try {
    const res = await fetch("/api/pac/auth");
    const data = await res.json();
    if (data.available) return true;
    // Also check via install status endpoint (handles PATH issues)
    const installRes = await fetch("/api/pac/install");
    const installData = await installRes.json();
    return !!installData.pacInstalled;
  } catch {
    return false;
  }
}

export async function installPacCli(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("/api/pac/install", { method: "POST" });
    const data = await res.json();
    return { success: !!data.success, message: data.message || "" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Installation failed" };
  }
}

export async function ensurePacAuth(environmentUrl: string): Promise<void> {
  const res = await fetch("/api/pac/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environmentUrl }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to authenticate PAC CLI");
  }
}

export async function pacExportSolution(
  environmentUrl: string,
  solutionName: string,
  managed: boolean
): Promise<Blob> {
  const res = await fetch("/api/pac/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environmentUrl, solutionName, managed }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "PAC export failed");
  }
  const binary = atob(data.solutionZipBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/zip" });
}

export async function pacImportSolution(
  environmentUrl: string,
  solutionZip: ArrayBuffer,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.("Uploading solution to PAC CLI backend...");

  const bytes = new Uint8Array(solutionZip);
  let binary = "";
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);

  onProgress?.("Importing solution via PAC CLI (async)...");

  const res = await fetch("/api/pac/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environmentUrl,
      solutionZipBase64: base64,
      forceOverwrite: true,
      publishChanges: true,
      async: true,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "PAC import failed");
  }
  onProgress?.("PAC CLI import completed successfully");
}

export async function pacMigrateTableSchema(
  sourceUrl: string,
  targetUrl: string,
  tableLogicalName: string,
  sourceToken: string,
  targetToken: string,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.(`Migrating schema for table '${tableLogicalName}'...`);

  const res = await fetch("/api/pac/migrate-table-schema", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl, targetUrl, tableLogicalName, sourceToken, targetToken }),
  });
  const data = await res.json();

  if (data.steps) {
    for (const step of data.steps as string[]) {
      onProgress?.(step);
    }
  }

  if (!res.ok || data.error) {
    throw new Error(data.error || "Table schema migration failed");
  }
  onProgress?.(data.message || "Table schema migrated successfully");
}

export async function pacGetSetting(
  name: string,
  environmentUrl: string
): Promise<string | null> {
  const params = new URLSearchParams({ name, environment: environmentUrl });
  const res = await fetch(`/api/pac/settings?${params}`);
  const data = await res.json();
  if (!res.ok) return null;
  return data.value ?? null;
}

export async function pacUpdateSetting(
  name: string,
  value: string,
  environmentUrl: string
): Promise<void> {
  const res = await fetch("/api/pac/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, value, environment: environmentUrl }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Failed to update setting ${name}`);
  }
}
