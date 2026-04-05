import { fetchWithRetry, buildAuthHeaders } from "./api-utils";
import type {
  PowerPlatformEnvironment,
  Solution,
  SolutionComponent,
  DataverseTable,
  DataverseColumn,
  ConnectionReference,
  EnvironmentVariable,
  SecurityRole,
  PaginatedResponse,
} from "@/lib/types";

const GLOBAL_DISCO = "https://globaldisco.crm.dynamics.com";

// ─── Environments ─────────────────────────────────────────
const REGION_NAMES: Record<string, string> = {
  NA: "North America",
  EMEA: "Europe",
  APAC: "Asia Pacific",
  SAM: "South America",
  OCE: "Oceania",
  JPN: "Japan",
  IND: "India",
  CAN: "Canada",
  GBR: "United Kingdom",
  FRA: "France",
  CHE: "Switzerland",
  DEU: "Germany",
  NOR: "Norway",
  KOR: "Korea",
  ZAF: "South Africa",
  ARE: "UAE",
  GCC: "US GCC",
  USG: "US Gov",
  CHN: "China",
};

function mapOrganizationType(orgType: unknown, purpose: unknown): PowerPlatformEnvironment["type"] {
  // Purpose string is most reliable when present
  const purposeStr = typeof purpose === "string" ? purpose.toLowerCase().trim() : "";
  if (purposeStr.includes("sandbox")) return "Sandbox";
  if (purposeStr.includes("developer")) return "Developer";
  if (purposeStr.includes("trial")) return "Trial";
  if (purposeStr.includes("default")) return "Default";
  if (purposeStr.includes("production")) return "Production";

  // OrganizationType enum from Dataverse:
  // https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/organizationtype
  const t = typeof orgType === "number" ? orgType : -1;
  switch (t) {
    case 0:  return "Production";  // Customer (primary org)
    case 4:  return "Production";  // Secondary (production instances)
    case 5:  return "Sandbox";     // CustomerTest
    case 6:  return "Sandbox";     // CustomerFreeTest
    case 7:  return "Sandbox";     // CustomerPreview
    case 9:  return "Trial";       // TestDrive
    case 11: return "Trial";       // EmailTrial
    case 12: return "Default";     // Default
    case 13: return "Developer";   // Developer
    case 14: return "Trial";       // Trial
    case 15: return "Production";  // Teams
    default: return "Production";
  }
}

export async function listEnvironments(token: string): Promise<PowerPlatformEnvironment[]> {
  const res = await fetchWithRetry(
    `${GLOBAL_DISCO}/api/discovery/v2.0/Instances`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return (data.value || []).map((inst: Record<string, unknown>) => {
    const url = (inst.Url || "") as string;
    const apiUrl = (inst.ApiUrl || "") as string;
    const regionCode = ((inst.Region || "") as string).toUpperCase();
    return {
      id: (inst.Id || "") as string,
      name: (inst.UniqueName || "") as string,
      displayName: (inst.FriendlyName || inst.UniqueName || "") as string,
      location: REGION_NAMES[regionCode] || regionCode || "Unknown",
      type: mapOrganizationType(inst.OrganizationType, inst.Purpose),
      orgUrl: url.endsWith("/") ? url.slice(0, -1) : url,
      apiUrl: apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl,
      // State: 0 = Enabled, 1 = Disabled
      state: (inst.State === 0 ? "Enabled" : inst.State === 1 ? "Disabled" : "Enabled") as string,
      createdTime: (inst.LastUpdated || "") as string,
      tenantId: (inst.TenantId || "") as string,
    };
  });
}

// ─── Solutions ────────────────────────────────────────────
export async function listSolutions(token: string, orgUrl: string): Promise<Solution[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/solutions?$filter=isvisible eq true&$orderby=friendlyname asc&$select=solutionid,uniquename,friendlyname,version,ismanaged,publisherid,description,installedon`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return data.value || [];
}

export async function exportSolution(
  token: string,
  orgUrl: string,
  solutionName: string,
  managed: boolean
): Promise<Blob> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/ExportSolution`,
    {
      method: "POST",
      headers: buildAuthHeaders(token),
      body: JSON.stringify({
        SolutionName: solutionName,
        Managed: managed,
        ExportAutoNumberingSettings: false,
        ExportCalendarSettings: false,
        ExportCustomizationSettings: false,
        ExportEmailTrackingSettings: false,
        ExportGeneralSettings: false,
        ExportMarketingSettings: false,
        ExportOutlookSynchronizationSettings: false,
        ExportRelationshipRoles: false,
        ExportIsvConfig: false,
        ExportSales: false,
      }),
    }
  );
  const data = await res.json();
  const base64 = data.ExportSolutionFile;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/zip" });
}

export async function importSolution(
  token: string,
  orgUrl: string,
  solutionZip: ArrayBuffer,
  overwriteUnmanagedCustomizations: boolean = true,
  publishWorkflows: boolean = true,
  onProgress?: (message: string) => void
): Promise<{ importJobId: string }> {
  const bytes = new Uint8Array(solutionZip);
  let binary = "";
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);

  // Strategy 1: StageSolution → ImportSolutionAsync with StageSolutionUploadId
  let stageSolutionUploadId: string | null = null;
  try {
    onProgress?.("Staging solution...");
    const stageRes = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/StageSolution`,
      {
        method: "POST",
        headers: buildAuthHeaders(token),
        body: JSON.stringify({ CustomizationFile: base64 }),
      },
      { maxRetries: 1 }
    );
    const stageData = await stageRes.json();
    stageSolutionUploadId =
      stageData.StageSolutionUploadId
      || stageData.StageSolutionResults?.StageSolutionUploadId
      || null;
  } catch {
    // StageSolution not available — will try other strategies
  }

  if (stageSolutionUploadId) {
    try {
      onProgress?.("Importing staged solution (async)...");
      const asyncOpId = await callImportSolutionAsync(token, orgUrl, {
        OverwriteUnmanagedCustomizations: overwriteUnmanagedCustomizations,
        PublishWorkflows: publishWorkflows,
        StageSolutionUploadId: stageSolutionUploadId,
      });
      return await pollAsyncOperation(token, orgUrl, asyncOpId, onProgress);
    } catch (err) {
      // If StageSolutionUploadId is not a valid param, fall through to strategy 2
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
      if (!msg.includes("StageSolutionUploadId")) throw err;
      onProgress?.("Staged import not supported, falling back...");
    }
  }

  // Strategy 2: ImportSolutionAsync with CustomizationFile (handles large files better than sync)
  try {
    onProgress?.("Importing solution (async)...");
    const asyncOpId = await callImportSolutionAsync(token, orgUrl, {
      OverwriteUnmanagedCustomizations: overwriteUnmanagedCustomizations,
      PublishWorkflows: publishWorkflows,
      CustomizationFile: base64,
    });
    return await pollAsyncOperation(token, orgUrl, asyncOpId, onProgress);
  } catch (err) {
    // If ImportSolutionAsync doesn't exist at all, fall through to sync
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (!msg.includes("ImportSolutionAsync") && !msg.includes("not found")) throw err;
  }

  // Strategy 3: Synchronous ImportSolution (last resort, may fail for large files)
  onProgress?.("Importing solution (sync)...");
  const importJobId = crypto.randomUUID();
  await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/ImportSolution`,
    {
      method: "POST",
      headers: buildAuthHeaders(token),
      body: JSON.stringify({
        OverwriteUnmanagedCustomizations: overwriteUnmanagedCustomizations,
        PublishWorkflows: publishWorkflows,
        CustomizationFile: base64,
        ImportJobId: importJobId,
      }),
    }
  );
  return { importJobId };
}

async function callImportSolutionAsync(
  token: string,
  orgUrl: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/ImportSolutionAsync`,
    {
      method: "POST",
      headers: buildAuthHeaders(token),
      body: JSON.stringify(body),
    },
    { maxRetries: 1 }
  );
  const data = await res.json();
  const asyncOperationId = data.AsyncOperationId;
  if (!asyncOperationId) {
    throw new Error("ImportSolutionAsync did not return an AsyncOperationId");
  }
  return asyncOperationId;
}

async function pollAsyncOperation(
  token: string,
  orgUrl: string,
  asyncOperationId: string,
  onProgress?: (message: string) => void
): Promise<{ importJobId: string }> {
  onProgress?.("Waiting for import to complete...");
  const maxWait = 10 * 60 * 1000;
  const pollInterval = 5000;
  const startTime = Date.now();
  const importJobId = crypto.randomUUID();

  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/asyncoperations(${asyncOperationId})?$select=statecode,statuscode,message`,
      { method: "GET", headers: buildAuthHeaders(token) },
      { maxRetries: 1 }
    );
    const pollData = await pollRes.json();

    if (pollData.statecode === 3) {
      if (pollData.statuscode === 30) {
        onProgress?.("Import completed successfully");
        return { importJobId };
      } else {
        throw {
          status: 500,
          statusText: "Import Failed",
          code: "ASYNC_IMPORT_FAILED",
          message: pollData.message || "Async import failed",
        };
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    onProgress?.(`Import in progress... (${elapsed}s)`);
  }

  throw {
    status: 408,
    statusText: "Timeout",
    code: "IMPORT_TIMEOUT",
    message: "Solution import timed out after 10 minutes. Check the target environment for import status.",
  };
}

// ─── Organization Settings ────────────────────────────────
export async function getOrgMaxUploadSize(
  token: string,
  orgUrl: string
): Promise<{ orgId: string; maxUploadFileSize: number }> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/organizations?$select=organizationid,maxuploadfilesize`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  const org = (data.value || [])[0];
  return {
    orgId: org?.organizationid || "",
    maxUploadFileSize: org?.maxuploadfilesize || 5120,
  };
}

export async function setOrgMaxUploadSize(
  token: string,
  orgUrl: string,
  orgId: string,
  sizeKB: number
): Promise<void> {
  await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/organizations(${orgId})`,
    {
      method: "PATCH",
      headers: buildAuthHeaders(token),
      body: JSON.stringify({ maxuploadfilesize: sizeKB }),
    }
  );
}

// ─── Solution Components ──────────────────────────────────
export async function listSolutionComponents(
  token: string,
  orgUrl: string,
  solutionId: string
): Promise<SolutionComponent[]> {
  const headers = buildAuthHeaders(token);

  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/solutioncomponents?$filter=_solutionid_value eq '${encodeURIComponent(solutionId)}'&$select=solutioncomponentid,componenttype,objectid,rootsolutioncomponentid`,
    { method: "GET", headers }
  );
  const data = await res.json();

  // Static map for well-known component types
  const componentTypeMap: Record<number, SolutionComponent["type"]> = {
    1: "table",
    9: "choice",
    20: "security_role",
    29: "cloud_flow",
    61: "web_resource",
    66: "custom_control",
    80: "model_driven_app",
    122: "business_rule",
    150: "cloud_flow",
    152: "cloud_flow",
    176: "custom_api",
    300: "canvas_app",
    10064: "connection_reference",
    380: "env_variable",
    400: "agent",
    401: "agent",
    402: "agent",
    430: "card",
    431: "card",
    10083: "agent",
    10084: "agent_component",
  };

  // Fetch dynamic component type definitions from the environment
  // This resolves environment-specific types like Agents, Topics, etc.
  // Many component types have dynamic type numbers that vary per environment.
  const entityNameToType: Record<string, SolutionComponent["type"]> = {
    entity: "table",
    optionset: "choice",
    role: "security_role",
    workflow: "cloud_flow",
    webresource: "web_resource",
    customcontrol: "custom_control",
    appmodule: "model_driven_app",
    canvasapp: "canvas_app",
    connectionreference: "connection_reference",
    environmentvariabledefinition: "env_variable",
    environmentvariablevalue: "env_variable",
    chatbot: "agent",
    chatbotsubcomponent: "agent_component",
    bot: "agent",
    botcomponent: "agent_component",
    card: "card",
    customapi: "custom_api",
  };

  let dynamicTypeMap: Record<number, { type: SolutionComponent["type"]; label: string }> = {};
  try {
    const defRes = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/solutioncomponentdefinitions?$select=solutioncomponenttype,primaryentityname,description&$top=500`,
      { method: "GET", headers }
    );
    const defData = await defRes.json();
    for (const def of defData.value || []) {
      const typeNum = def.solutioncomponenttype as number;
      const entityName = (def.primaryentityname as string || "").toLowerCase();
      const description = (def.description as string || entityName);
      const mappedType = entityNameToType[entityName];
      if (mappedType) {
        dynamicTypeMap[typeNum] = { type: mappedType, label: description };
      } else if (entityName) {
        // Store the description for potential use even if we don't have a specific type
        dynamicTypeMap[typeNum] = { type: "other", label: description };
      }
    }
  } catch { /* ignore — fall back to static map only */ }

  // ─── Build initial components list from ALL entries ────────────────
  // We process all components first, then filter out unwanted sub-components.
  // This ensures environment-specific types like Topics aren't lost.
  const allComps = data.value || [];

  // Debug: log raw component types returned by the API
  console.log("[listSolutionComponents] Raw components:", allComps.length, allComps.map((c: Record<string, unknown>) => ({
    id: c.solutioncomponentid,
    type: c.componenttype,
    objectid: c.objectid,
    rootId: c.rootsolutioncomponentid,
    inStaticMap: componentTypeMap[c.componenttype as number] || null,
  })));

  const components: SolutionComponent[] = [];
  for (const c of allComps) {
    const typeNum = c.componenttype as number;
    const rootId = c.rootsolutioncomponentid as string | null;
    const ownId = c.solutioncomponentid as string;
    const isRoot = !rootId || rootId === ownId;

    let compType: SolutionComponent["type"];

    // Statically known top-level types — ALWAYS include them.
    // These are curated as solution-explorer-level objects; their
    // rootsolutioncomponentid may be non-null but they're still top-level.
    if (componentTypeMap[typeNum]) {
      compType = componentTypeMap[typeNum];
    }
    // Dynamic map for environment-specific types (agents, topics, etc.)
    else if (dynamicTypeMap[typeNum] && dynamicTypeMap[typeNum].type !== "other") {
      compType = dynamicTypeMap[typeNum].type;
    }
    // Unknown type — only include as "other" for reverse-lookup identification
    // (may be Topics or other environment-specific types).
    // Skip non-root unknowns that are clearly sub-components (columns, forms, views).
    else {
      if (!isRoot) {
        // Non-root unknown — likely a sub-component, skip for now.
        // Will be picked up in the reverse-lookup step if it's a Topic, etc.
        compType = "other";
      } else {
        compType = "other";
      }
    }

    components.push({
      id: ownId,
      name: (c.objectid || "") as string,
      displayName: (c.objectid || "") as string,
      type: compType,
      solutionId,
      dependsOn: [],
      metadata: c,
    });
  }

  // ─── Identify "other" components by checking known tables ────────────
  // Environment-specific types (chatbot, botcomponent) have dynamic type numbers
  // so we try to identify them by checking if their objectid exists in those tables.
  const otherComps = components.filter((c) => c.type === "other");
  if (otherComps.length > 0) {
    // Check chatbots table
    try {
      const botRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/chatbots?$select=chatbotid,name`,
        { method: "GET", headers }
      );
      const botData = await botRes.json();
      const botMap = new Map<string, string>();
      for (const b of botData.value || []) {
        botMap.set((b.chatbotid as string).toLowerCase(), b.name as string);
      }
      for (const c of otherComps) {
        if (botMap.has(c.name.toLowerCase())) {
          c.type = "agent";
          c.displayName = botMap.get(c.name.toLowerCase()) || c.displayName;
        }
      }
    } catch { /* ignore */ }

    // Check chatbotsubcomponents table (topics)
    const stillOther = otherComps.filter((c) => c.type === "other");
    if (stillOther.length > 0) {
      try {
        const topicRes = await fetchWithRetry(
          `${orgUrl}/api/data/v9.2/chatbotsubcomponents?$select=chatbotsubcomponentid,name,schemaname`,
          { method: "GET", headers }
        );
        const topicData = await topicRes.json();
        const topicMap = new Map<string, string>();
        for (const t of topicData.value || []) {
          topicMap.set((t.chatbotsubcomponentid as string).toLowerCase(), (t.name || t.schemaname) as string);
        }
        for (const c of stillOther) {
          if (topicMap.has(c.name.toLowerCase())) {
            c.type = "agent_component";
            c.displayName = topicMap.get(c.name.toLowerCase()) || c.displayName;
          }
        }
      } catch { /* ignore */ }
    }

    // Remove remaining "other" components that couldn't be identified
    // These are truly unknown sub-components we don't want to show
    const finalOther = components.filter((c) => c.type === "other");
    for (const c of finalOther) {
      const idx = components.indexOf(c);
      if (idx !== -1) components.splice(idx, 1);
    }
  }

  console.log("[listSolutionComponents] Final components:", components.length, components.map(c => ({ id: c.id, type: c.type, name: c.name })));

  // ─── Resolve display names per type ────────────────────

  const tableComps = components.filter((c) => c.type === "table");
  const flowComps = components.filter((c) => c.type === "cloud_flow");
  const canvasComps = components.filter((c) => c.type === "canvas_app");
  const modelComps = components.filter((c) => c.type === "model_driven_app");
  const roleComps = components.filter((c) => c.type === "security_role");
  const connRefComps = components.filter((c) => c.type === "connection_reference");
  const envVarComps = components.filter((c) => c.type === "env_variable");
  const choiceComps = components.filter((c) => c.type === "choice");
  const webResComps = components.filter((c) => c.type === "web_resource");
  const customControlComps = components.filter((c) => c.type === "custom_control");
  const customApiComps = components.filter((c) => c.type === "custom_api");
  const agentComps = components.filter((c) => c.type === "agent");
  const agentCompComps = components.filter((c) => c.type === "agent_component");

  // Resolve table names
  if (tableComps.length > 0) {
    try {
      const tableRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/EntityDefinitions?$select=MetadataId,LogicalName,DisplayName`,
        { method: "GET", headers }
      );
      const tableData = await tableRes.json();
      const tableMap = new Map<string, string>();
      for (const t of tableData.value || []) {
        tableMap.set((t.MetadataId as string).toLowerCase(), t.DisplayName?.UserLocalizedLabel?.Label || t.LogicalName);
      }
      for (const c of tableComps) {
        const name = tableMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve cloud flow names
  if (flowComps.length > 0) {
    try {
      const flowRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/workflows?$select=workflowid,name&$filter=category eq 5`,
        { method: "GET", headers }
      );
      const flowData = await flowRes.json();
      const flowMap = new Map<string, string>();
      for (const f of flowData.value || []) {
        flowMap.set((f.workflowid as string).toLowerCase(), f.name as string);
      }
      for (const c of flowComps) {
        const name = flowMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve canvas app names
  if (canvasComps.length > 0) {
    try {
      const appRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/canvasapps?$select=canvasappid,name,displayname`,
        { method: "GET", headers }
      );
      const appData = await appRes.json();
      const appMap = new Map<string, string>();
      for (const a of appData.value || []) {
        appMap.set((a.canvasappid as string).toLowerCase(), (a.displayname || a.name) as string);
      }
      for (const c of canvasComps) {
        const name = appMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve model-driven app names
  if (modelComps.length > 0) {
    try {
      const mdaRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/appmodules?$select=appmoduleid,name`,
        { method: "GET", headers }
      );
      const mdaData = await mdaRes.json();
      const mdaMap = new Map<string, string>();
      for (const a of mdaData.value || []) {
        mdaMap.set((a.appmoduleid as string).toLowerCase(), a.name as string);
      }
      for (const c of modelComps) {
        const name = mdaMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve security role names
  if (roleComps.length > 0) {
    try {
      const roleRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/roles?$select=roleid,name`,
        { method: "GET", headers }
      );
      const roleData = await roleRes.json();
      const roleMap = new Map<string, string>();
      for (const r of roleData.value || []) {
        roleMap.set((r.roleid as string).toLowerCase(), r.name as string);
      }
      for (const c of roleComps) {
        const name = roleMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve connection reference names
  if (connRefComps.length > 0) {
    try {
      const crRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/connectionreferences?$select=connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname`,
        { method: "GET", headers }
      );
      const crData = await crRes.json();
      const crMap = new Map<string, string>();
      for (const cr of crData.value || []) {
        crMap.set((cr.connectionreferenceid as string).toLowerCase(), (cr.connectionreferencedisplayname || cr.connectionreferencelogicalname) as string);
      }
      for (const c of connRefComps) {
        const name = crMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve environment variable names
  if (envVarComps.length > 0) {
    try {
      const evRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/environmentvariabledefinitions?$select=environmentvariabledefinitionid,schemaname,displayname`,
        { method: "GET", headers }
      );
      const evData = await evRes.json();
      const evMap = new Map<string, string>();
      for (const ev of evData.value || []) {
        evMap.set((ev.environmentvariabledefinitionid as string).toLowerCase(), (ev.displayname || ev.schemaname) as string);
      }
      for (const c of envVarComps) {
        const name = evMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve choice (global option set) names
  if (choiceComps.length > 0) {
    try {
      const choiceRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/GlobalOptionSetDefinitions?$select=MetadataId,Name,DisplayName`,
        { method: "GET", headers }
      );
      const choiceData = await choiceRes.json();
      const choiceMap = new Map<string, string>();
      for (const ch of choiceData.value || []) {
        choiceMap.set((ch.MetadataId as string).toLowerCase(), ch.DisplayName?.UserLocalizedLabel?.Label || ch.Name);
      }
      for (const c of choiceComps) {
        const name = choiceMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve web resource names
  if (webResComps.length > 0) {
    try {
      const wrRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/webresourceset?$select=webresourceid,name,displayname`,
        { method: "GET", headers }
      );
      const wrData = await wrRes.json();
      const wrMap = new Map<string, string>();
      for (const wr of wrData.value || []) {
        wrMap.set((wr.webresourceid as string).toLowerCase(), (wr.displayname || wr.name) as string);
      }
      for (const c of webResComps) {
        const name = wrMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve custom control / component library names
  if (customControlComps.length > 0) {
    try {
      const ccRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/customcontrols?$select=customcontrolid,name,displayname`,
        { method: "GET", headers }
      );
      const ccData = await ccRes.json();
      const ccMap = new Map<string, string>();
      for (const cc of ccData.value || []) {
        ccMap.set((cc.customcontrolid as string).toLowerCase(), (cc.displayname || cc.name) as string);
      }
      for (const c of customControlComps) {
        const name = ccMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve custom API names
  if (customApiComps.length > 0) {
    try {
      const apiRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/customapis?$select=customapiid,name,displayname`,
        { method: "GET", headers }
      );
      const apiData = await apiRes.json();
      const apiMap = new Map<string, string>();
      for (const a of apiData.value || []) {
        apiMap.set((a.customapiid as string).toLowerCase(), (a.displayname || a.name) as string);
      }
      for (const c of customApiComps) {
        const name = apiMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve agent (chatbot) names — only for agents typed via static map (400/401/402)
  // Agents identified from "other" already have names from the identification step
  const unresolvedAgents = agentComps.filter((c) => c.displayName === c.name);
  if (unresolvedAgents.length > 0) {
    try {
      const botRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/chatbots?$select=chatbotid,name`,
        { method: "GET", headers }
      );
      const botData = await botRes.json();
      const botMap = new Map<string, string>();
      for (const b of botData.value || []) {
        botMap.set((b.chatbotid as string).toLowerCase(), b.name as string);
      }
      for (const c of unresolvedAgents) {
        const name = botMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  // Resolve agent component (topic) names — only for unresolved ones
  const unresolvedTopics = agentCompComps.filter((c) => c.displayName === c.name);
  if (unresolvedTopics.length > 0) {
    try {
      const topicRes = await fetchWithRetry(
        `${orgUrl}/api/data/v9.2/chatbotsubcomponents?$select=chatbotsubcomponentid,name,schemaname`,
        { method: "GET", headers }
      );
      const topicData = await topicRes.json();
      const topicMap = new Map<string, string>();
      for (const t of topicData.value || []) {
        topicMap.set((t.chatbotsubcomponentid as string).toLowerCase(), (t.name || t.schemaname) as string);
      }
      for (const c of unresolvedTopics) {
        const name = topicMap.get(c.name.toLowerCase());
        if (name) { c.displayName = name; }
      }
    } catch { /* ignore */ }
  }

  return components;
}

// ─── Publishers ───────────────────────────────────────────
export interface Publisher {
  publisherid: string;
  uniquename: string;
  friendlyname: string;
  customizationprefix: string;
}

export async function listPublishers(
  token: string,
  orgUrl: string
): Promise<Publisher[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/publishers?$select=publisherid,uniquename,friendlyname,customizationprefix&$filter=uniquename ne 'MicrosoftCorporation' and uniquename ne 'microsoftaborig'&$orderby=friendlyname asc`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return (data.value || []).map((p: Record<string, unknown>) => ({
    publisherid: p.publisherid as string,
    uniquename: p.uniquename as string,
    friendlyname: p.friendlyname as string,
    customizationprefix: p.customizationprefix as string,
  }));
}

// ─── Solution Zip Modification ────────────────────────────
export async function modifySolutionZip(
  zipBuffer: ArrayBuffer,
  overrides: { friendlyName?: string; publisherUniqueName?: string }
): Promise<ArrayBuffer> {
  const { unzipSync, zipSync } = await import("fflate");
  const data = new Uint8Array(zipBuffer);
  const unzipped = unzipSync(data);

  const solutionXmlBytes = unzipped["solution.xml"];
  if (!solutionXmlBytes) return zipBuffer; // no solution.xml found, return original

  let xml = new TextDecoder().decode(solutionXmlBytes);

  if (overrides.friendlyName) {
    // Replace <LocalizedName description="..." languagecode="..."/>
    xml = xml.replace(
      /(<LocalizedName\s+description=")[^"]*(")/,
      `$1${overrides.friendlyName.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}$2`
    );
  }

  if (overrides.publisherUniqueName) {
    // Replace <UniqueName>...</UniqueName> inside <Publisher> block
    xml = xml.replace(
      /(<Publisher>[\s\S]*?<UniqueName>)[^<]*(<\/UniqueName>)/,
      `$1${overrides.publisherUniqueName}$2`
    );
  }

  unzipped["solution.xml"] = new TextEncoder().encode(xml);
  const rezipped = zipSync(unzipped);
  return rezipped.buffer as ArrayBuffer;
}

// ─── Dataverse Tables ─────────────────────────────────────
export async function listTables(token: string, orgUrl: string): Promise<DataverseTable[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,DisplayName,SchemaName,EntitySetName,IsCustomEntity&$filter=IsCustomizable/Value eq true`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  const results = (data.value || []).map((t: Record<string, unknown>) => ({
    logicalName: t.LogicalName as string,
    displayName: ((t.DisplayName as Record<string, unknown>)?.UserLocalizedLabel as Record<string, unknown>)?.Label as string || t.LogicalName as string,
    schemaName: t.SchemaName as string,
    entitySetName: t.EntitySetName as string,
    isCustomEntity: t.IsCustomEntity as boolean,
    columns: [],
  }));
  return results.sort((a: DataverseTable, b: DataverseTable) => a.displayName.localeCompare(b.displayName));
}

export async function listTableColumns(
  token: string,
  orgUrl: string,
  tableLogicalName: string
): Promise<DataverseColumn[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableLogicalName)}')/Attributes?$select=LogicalName,DisplayName,AttributeType,IsPrimaryId,IsPrimaryName,IsCustomAttribute,RequiredLevel,MaxLength`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return (data.value || []).map((c: Record<string, unknown>) => ({
    logicalName: c.LogicalName as string,
    displayName: ((c.DisplayName as Record<string, unknown>)?.UserLocalizedLabel as Record<string, unknown>)?.Label as string || c.LogicalName as string,
    attributeType: c.AttributeType as string,
    isPrimaryId: c.IsPrimaryId as boolean,
    isPrimaryName: c.IsPrimaryName as boolean,
    isCustomAttribute: c.IsCustomAttribute as boolean,
    requiredLevel: ((c.RequiredLevel as Record<string, unknown>)?.Value || "None") as string,
    maxLength: c.MaxLength as number | undefined,
  }));
}

export async function fetchTableData(
  token: string,
  orgUrl: string,
  entitySetName: string,
  options: { top?: number; skipToken?: string; filter?: string; select?: string } = {}
): Promise<PaginatedResponse<Record<string, unknown>>> {
  let url = `${orgUrl}/api/data/v9.2/${entitySetName}`;
  const params: string[] = [];
  if (options.top) params.push(`$top=${options.top}`);
  if (options.filter) params.push(`$filter=${options.filter}`);
  if (options.select) params.push(`$select=${options.select}`);
  if (params.length) url += `?${params.join("&")}`;
  if (options.skipToken) url = options.skipToken;

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: buildAuthHeaders(token),
  });
  const data = await res.json();
  return {
    value: data.value || [],
    nextLink: data["@odata.nextLink"],
    count: data["@odata.count"],
  };
}

export async function upsertRecord(
  token: string,
  orgUrl: string,
  entitySetName: string,
  id: string,
  record: Record<string, unknown>
): Promise<void> {
  await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/${entitySetName}(${id})`,
    {
      method: "PATCH",
      headers: {
        ...buildAuthHeaders(token),
        "If-Match": "*",
      },
      body: JSON.stringify(record),
    }
  );
}

// ─── Connection References ────────────────────────────────
export async function listConnectionReferences(
  token: string,
  orgUrl: string,
  solutionId?: string
): Promise<ConnectionReference[]> {
  let filter = "";
  if (solutionId) {
    filter = `&$filter=_solutionid_value eq '${encodeURIComponent(solutionId)}'`;
  }
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/connectionreferences?$select=connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectorid,connectionid,statuscode${filter}`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return (data.value || []).map((c: Record<string, unknown>) => ({
    id: c.connectionreferenceid as string,
    connectionReferenceLogicalName: c.connectionreferencelogicalname as string,
    displayName: (c.connectionreferencedisplayname || c.connectionreferencelogicalname) as string,
    connectorId: c.connectorid as string,
    connectionId: c.connectionid as string | undefined,
    status: c.statuscode as string | undefined,
  }));
}

// ─── Environment Variables ────────────────────────────────
export async function listEnvironmentVariables(
  token: string,
  orgUrl: string
): Promise<EnvironmentVariable[]> {
  // Fetch definitions and values separately to avoid expand navigation issues
  const [defsRes, valsRes] = await Promise.all([
    fetchWithRetry(
      `${orgUrl}/api/data/v9.2/environmentvariabledefinitions?$select=environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue`,
      { method: "GET", headers: buildAuthHeaders(token) }
    ),
    fetchWithRetry(
      `${orgUrl}/api/data/v9.2/environmentvariablevalues?$select=environmentvariablevalueid,value,_environmentvariabledefinitionid_value`,
      { method: "GET", headers: buildAuthHeaders(token) }
    ),
  ]);
  const defs = await defsRes.json();
  const vals = await valsRes.json();

  // Build a map of definition ID → current value
  const valueMap = new Map<string, string>();
  for (const v of (vals.value || []) as Record<string, unknown>[]) {
    const defId = v._environmentvariabledefinitionid_value as string;
    if (defId) valueMap.set(defId, v.value as string);
  }

  const typeMap: Record<number, EnvironmentVariable["type"]> = {
    100000000: "String",
    100000001: "Number",
    100000002: "Boolean",
    100000003: "JSON",
    100000004: "Data Source",
  };
  return (defs.value || []).map((v: Record<string, unknown>) => {
    const id = v.environmentvariabledefinitionid as string;
    return {
      id,
      schemaName: v.schemaname as string,
      displayName: (v.displayname || v.schemaname) as string,
      type: typeMap[v.type as number] || "String",
      defaultValue: v.defaultvalue as string | undefined,
      currentValue: valueMap.get(id),
    };
  });
}

// ─── Security Roles ───────────────────────────────────────
export async function listSecurityRoles(
  token: string,
  orgUrl: string
): Promise<SecurityRole[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/roles?$select=roleid,name,_businessunitid_value,ismanaged&$filter=ismanaged eq false&$orderby=name asc`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return (data.value || []).map((r: Record<string, unknown>) => ({
    roleid: r.roleid as string,
    name: r.name as string,
    businessunitid: r._businessunitid_value as string,
    ismanaged: r.ismanaged as boolean,
    privileges: [],
  }));
}

// ─── Solution Dependencies ────────────────────────────────
export async function getSolutionDependencies(
  token: string,
  orgUrl: string,
  solutionId: string
): Promise<{
  requiredComponentObjectId: string;
  requiredComponentType: number;
  dependentComponentObjectId: string;
  dependentComponentType: number;
}[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/RetrieveDependenciesForUninstall(SolutionUniqueName=@p1)?@p1='${encodeURIComponent(solutionId)}'`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return (data.value || []).map((d: Record<string, unknown>) => ({
    requiredComponentObjectId: d.requiredcomponentobjectid as string,
    requiredComponentType: d.requiredcomponenttype as number,
    dependentComponentObjectId: d.dependentcomponentobjectid as string,
    dependentComponentType: d.dependentcomponenttype as number,
  }));
}

// ─── Missing Dependencies Check ──────────────────────────
export interface MissingDependency {
  requiredType: string;
  requiredDisplayName: string;
  requiredSolution: string;
  requiredId: string;
  dependentType: string;
  dependentDisplayName: string;
  dependentId: string;
  canResolve: boolean;
}

export async function checkMissingDependencies(
  sourceToken: string,
  sourceOrgUrl: string,
  solutionName: string
): Promise<MissingDependency[]> {
  // Use RetrieveMissingDependencies to check what the solution needs
  try {
    // Fetch component type definitions dynamically from Dataverse
    const typeNameMap: Record<number, string> = {
      1: "Table", 2: "Attribute", 9: "Choice (Option Set)", 10: "Relationship",
      20: "Security Role Privilege", 24: "Security Role", 25: "Role Privilege",
      26: "View", 29: "Cloud Flow (Process)", 36: "Report",
      59: "Chart", 60: "System Form", 61: "Web Resource",
      65: "Plugin Step", 66: "Plugin Type", 68: "Plugin Assembly",
      70: "Field Security Profile", 80: "Model-Driven App",
      90: "Site Map", 91: "Email Template", 95: "SDK Message Processing Step",
      122: "Business Rule", 150: "Routing Rule", 300: "Canvas App",
      10064: "Connection Reference", 372: "Custom Connector",
      380: "Environment Variable", 381: "Environment Variable Value",
      400: "AI Model", 401: "AI Builder Configuration", 402: "AI Builder File", 10083: "Agent Copilot Studio", 10084: "Topic",
    };
    try {
      const defRes = await fetchWithRetry(
        `${sourceOrgUrl}/api/data/v9.2/solutioncomponentdefinitions?$select=solutioncomponenttype,primaryentityname,description&$top=500`,
        { method: "GET", headers: buildAuthHeaders(sourceToken) }
      );
      const defData = await defRes.json();
      for (const def of (defData.value || []) as Record<string, unknown>[]) {
        const typeNum = def.solutioncomponenttype as number;
        if (typeNum && !typeNameMap[typeNum]) {
          const label = (def.description as string) || (def.primaryentityname as string) || "";
          if (label) {
            // Convert entity name to friendly label: "canvasapp" → "Canvas App", "connector" → "Connector"
            const friendly = label
              .replace(/([a-z])([A-Z])/g, "$1 $2")
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c: string) => c.toUpperCase());
            typeNameMap[typeNum] = friendly;
          }
        }
      }
    } catch {
      // Non-blocking — fall back to static map
    }

    const res = await fetchWithRetry(
      `${sourceOrgUrl}/api/data/v9.2/RetrieveMissingDependencies(SolutionUniqueName=@p1)?@p1='${encodeURIComponent(solutionName)}'`,
      { method: "GET", headers: buildAuthHeaders(sourceToken) }
    );
    const data = await res.json();

    const resolveTypeName = (typeNum: number) => typeNameMap[typeNum] || `Component Type ${typeNum}`;

    return (data.value || []).map((d: Record<string, unknown>) => ({
      requiredType: resolveTypeName(d.requiredcomponenttype as number),
      requiredDisplayName: (d.requiredcomponentdisplayname || d.requiredcomponentobjectid || "Unknown") as string,
      requiredSolution: (d.requiredcomponentsolutionname || "Active") as string,
      requiredId: (d.requiredcomponentobjectid || "") as string,
      dependentType: resolveTypeName(d.dependentcomponenttype as number),
      dependentDisplayName: (d.dependentcomponentdisplayname || d.dependentcomponentobjectid || "Unknown") as string,
      dependentId: (d.dependentcomponentobjectid || "") as string,
      canResolve: false,
    }));
  } catch {
    return [];
  }
}

// Also check which connection references are required by the solution components
export async function listSolutionConnectionReferences(
  token: string,
  orgUrl: string,
  solutionId: string
): Promise<ConnectionReference[]> {
  try {
    // Get connection reference components (type 371) for this solution
    const res = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/solutioncomponents?$filter=_solutionid_value eq '${encodeURIComponent(solutionId)}' and componenttype eq 371&$select=objectid`,
      { method: "GET", headers: buildAuthHeaders(token) }
    );
    const data = await res.json();
    const objectIds: string[] = (data.value || []).map((c: Record<string, unknown>) => c.objectid as string);
    if (objectIds.length === 0) return [];

    // Fetch those connection references
    const filter = objectIds.map((id) => `connectionreferenceid eq '${id}'`).join(" or ");
    const refsRes = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/connectionreferences?$filter=${encodeURIComponent(filter)}&$select=connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectorid,connectionid`,
      { method: "GET", headers: buildAuthHeaders(token) }
    );
    const refsData = await refsRes.json();
    return (refsData.value || []).map((c: Record<string, unknown>) => ({
      id: c.connectionreferenceid as string,
      connectionReferenceLogicalName: c.connectionreferencelogicalname as string,
      displayName: (c.connectionreferencedisplayname || c.connectionreferencelogicalname) as string,
      connectorId: c.connectorid as string,
      connectionId: c.connectionid as string | undefined,
    }));
  } catch {
    return [];
  }
}

// ─── Cloud Flows ──────────────────────────────────────────

// Fetch environment variables scoped to a specific solution (component type 380)
export async function listSolutionEnvironmentVariables(
  token: string,
  orgUrl: string,
  solutionId: string
): Promise<EnvironmentVariable[]> {
  try {
    const res = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/solutioncomponents?$filter=_solutionid_value eq '${encodeURIComponent(solutionId)}' and componenttype eq 380&$select=objectid`,
      { method: "GET", headers: buildAuthHeaders(token) }
    );
    const data = await res.json();
    const objectIds: string[] = (data.value || []).map((c: Record<string, unknown>) => c.objectid as string);
    if (objectIds.length === 0) return [];

    // Fetch those env variable definitions
    const filter = objectIds.map((id) => `environmentvariabledefinitionid eq '${id}'`).join(" or ");
    const defsRes = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/environmentvariabledefinitions?$filter=${encodeURIComponent(filter)}&$select=environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue`,
      { method: "GET", headers: buildAuthHeaders(token) }
    );
    const defs = await defsRes.json();
    const defIds = (defs.value || []).map((d: Record<string, unknown>) => d.environmentvariabledefinitionid as string);
    if (defIds.length === 0) return [];

    // Fetch current values
    const valFilter = defIds.map((id: string) => `_environmentvariabledefinitionid_value eq '${id}'`).join(" or ");
    const valsRes = await fetchWithRetry(
      `${orgUrl}/api/data/v9.2/environmentvariablevalues?$filter=${encodeURIComponent(valFilter)}&$select=environmentvariablevalueid,value,_environmentvariabledefinitionid_value`,
      { method: "GET", headers: buildAuthHeaders(token) }
    );
    const vals = await valsRes.json();
    const valueMap = new Map<string, string>();
    for (const v of (vals.value || []) as Record<string, unknown>[]) {
      const defId = v._environmentvariabledefinitionid_value as string;
      if (defId) valueMap.set(defId, v.value as string);
    }

    const typeMap: Record<number, EnvironmentVariable["type"]> = {
      100000000: "String",
      100000001: "Number",
      100000002: "Boolean",
      100000003: "JSON",
      100000004: "Data Source",
    };
    return (defs.value || []).map((v: Record<string, unknown>) => {
      const id = v.environmentvariabledefinitionid as string;
      return {
        id,
        schemaName: v.schemaname as string,
        displayName: (v.displayname || v.schemaname) as string,
        type: typeMap[v.type as number] || "String",
        defaultValue: v.defaultvalue as string | undefined,
        currentValue: valueMap.get(id),
      };
    });
  } catch {
    return [];
  }
}

export async function listCloudFlows(
  token: string,
  orgUrl: string
): Promise<{ workflowid: string; name: string; category: number; statecode: number }[]> {
  const res = await fetchWithRetry(
    `${orgUrl}/api/data/v9.2/workflows?$filter=category eq 5&$select=workflowid,name,category,statecode&$orderby=name asc`,
    { method: "GET", headers: buildAuthHeaders(token) }
  );
  const data = await res.json();
  return data.value || [];
}

// ─── Snapshot / Rollback ──────────────────────────────────
export async function createSnapshot(
  token: string,
  orgUrl: string,
  solutionName: string
): Promise<{ snapshotData: ArrayBuffer; timestamp: string }> {
  const blob = await exportSolution(token, orgUrl, solutionName, false);
  const buffer = await blob.arrayBuffer();
  return {
    snapshotData: buffer,
    timestamp: new Date().toISOString(),
  };
}

export async function restoreSnapshot(
  token: string,
  orgUrl: string,
  snapshotData: ArrayBuffer
): Promise<{ importJobId: string }> {
  return importSolution(token, orgUrl, snapshotData, true, true);
}
