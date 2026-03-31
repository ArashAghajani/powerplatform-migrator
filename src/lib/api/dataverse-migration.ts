/**
 * Dataverse Data Migration Module
 *
 * Handles row-level data migration between Dataverse environments including:
 * - Paginated export with configurable batch sizes
 * - Lookup field GUID re-mapping across environments
 * - FetchXML filter support
 * - Per-record conflict handling (skip, upsert, overwrite)
 */

import {
  fetchWithRetry,
  buildAuthHeaders,
} from "@/lib/api/api-utils";
import type { ConflictResolution, DataverseTable, DataverseColumn } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────

export interface DataMigrationConfig {
  sourceUrl: string;
  targetUrl: string;
  sourceToken: string;
  targetToken: string;
  tables: TableMigrationConfig[];
  batchSize?: number;
  onProgress?: (event: DataMigrationProgress) => void;
}

export interface TableMigrationConfig {
  logicalName: string;
  displayName: string;
  conflictResolution: ConflictResolution;
  fetchXmlFilter?: string;
  /** Columns to migrate — if empty, all columns are included */
  selectedColumns?: string[];
}

export interface DataMigrationProgress {
  tableName: string;
  phase: "exporting" | "mapping" | "importing";
  current: number;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

interface DataverseRecord {
  [key: string]: unknown;
}

interface LookupMapping {
  /** source GUID → target GUID */
  [sourceGuid: string]: string;
}

// ─── Helpers ──────────────────────────────────────────────

function isLookupColumn(column: DataverseColumn): boolean {
  return (
    (column.attributeType === "Lookup" ||
      column.attributeType === "Customer" ||
      column.attributeType === "Owner") &&
    !!column.lookupTarget
  );
}

/** Read-only / system-managed attributes that must not be sent in a write request */
const READ_ONLY_FIELDS = new Set([
  "versionnumber", "modifiedon", "createdon", "modifiedby", "createdby",
  "modifiedonbehalfby", "createdonbehalfby", "owninguser", "owningteam",
  "owningbusinessunit", "organizationid", "overriddencreatedon",
  "importsequencenumber", "timezoneruleversionnumber", "utcconversiontimezonecode",
  "statecode", "statuscode",
  "ownerid", "owneridtype",
  "_ownerid_value", "_createdby_value", "_modifiedby_value",
  "_owninguser_value", "_owningteam_value", "_owningbusinessunit_value",
  "_organizationid_value", "_modifiedonbehalfby_value", "_createdonbehalfby_value",
]);

function stripODataAnnotations(record: DataverseRecord, primaryIdColumn: string): DataverseRecord {
  const clean: DataverseRecord = {};
  for (const [key, value] of Object.entries(record)) {
    // Skip OData metadata annotations
    if (key.startsWith("@odata") || key.startsWith("@Microsoft")) continue;
    // Skip raw lookup value columns (_xxx_value) — these are read-only projections
    if (key.startsWith("_") && key.endsWith("_value")) continue;
    // Skip the primary ID column (it's in the URL for PATCH)
    if (key === primaryIdColumn) continue;
    // Skip known read-only / system fields
    if (READ_ONLY_FIELDS.has(key)) continue;
    // Skip null values — no point sending them
    if (value === null || value === undefined) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Fetch all records from a Dataverse table, handling server-side paging.
 */
async function fetchAllRecords(
  envUrl: string,
  token: string,
  tableName: string,
  fetchXml?: string,
  selectColumns?: string[],
  batchSize: number = 500
): Promise<DataverseRecord[]> {
  const allRecords: DataverseRecord[] = [];
  let nextLink: string | null = null;

  // Build initial URL
  let initialUrl: string;
  if (fetchXml) {
    const encoded = encodeURIComponent(fetchXml);
    initialUrl = `${envUrl}/api/data/v9.2/${tableName}?fetchXml=${encoded}`;
  } else {
    const params: string[] = [`$top=${batchSize}`];
    if (selectColumns && selectColumns.length > 0) {
      params.push(`$select=${selectColumns.join(",")}`);
    }
    initialUrl = `${envUrl}/api/data/v9.2/${tableName}?${params.join("&")}`;
  }

  let url: string | null = initialUrl;

  while (url) {
    const response = await fetchWithRetry(url, {
      headers: buildAuthHeaders(token),
    });

    const data = await response.json();
    const records: DataverseRecord[] = data.value || [];
    allRecords.push(...records);

    // Handle @odata.nextLink for pagination
    nextLink = data["@odata.nextLink"] || null;
    url = nextLink;
  }

  return allRecords;
}

/**
 * Build a lookup GUID mapping by matching records on alternate key or name field.
 * For related tables, exports records from both source and target, then maps by primary name column.
 */
async function buildLookupMapping(
  sourceUrl: string,
  targetUrl: string,
  sourceToken: string,
  targetToken: string,
  relatedTableEntitySetName: string,
  primaryNameColumn: string,
  relatedTableLogicalName: string
): Promise<LookupMapping> {
  const [sourceRecords, targetRecords] = await Promise.all([
    fetchAllRecords(sourceUrl, sourceToken, relatedTableEntitySetName, undefined, [primaryNameColumn]),
    fetchAllRecords(targetUrl, targetToken, relatedTableEntitySetName, undefined, [primaryNameColumn]),
  ]);

  const targetByName = new Map<string, string>();
  for (const rec of targetRecords) {
    const name = String(rec[primaryNameColumn] || "").toLowerCase();
    const id = String(rec[`${relatedTableLogicalName}id`] || rec["activityid"] || "");
    if (name && id) targetByName.set(name, id);
  }

  const mapping: LookupMapping = {};
  for (const rec of sourceRecords) {
    const name = String(rec[primaryNameColumn] || "").toLowerCase();
    const sourceId = String(rec[`${relatedTableLogicalName}id`] || rec["activityid"] || "");
    const targetId = targetByName.get(name);
    if (sourceId && targetId) {
      mapping[sourceId] = targetId;
    }
  }

  return mapping;
}

/**
 * Remap lookup GUIDs in a record using prebuilt mappings.
 */
function remapLookups(
  record: DataverseRecord,
  lookupColumns: DataverseColumn[],
  lookupMappings: Map<string, LookupMapping>,
  entitySetNames: Map<string, string>
): DataverseRecord {
  const remapped = { ...record };

  for (const col of lookupColumns) {
    const navProperty = col.logicalName;
    // Dataverse returns lookup values as _fieldname_value
    const valueKey = `_${navProperty}_value`;
    const sourceGuid = record[valueKey] as string | undefined;

    if (!sourceGuid) continue;

    const target = col.lookupTarget;
    if (target) {
      const mapping = lookupMappings.get(target);
      if (mapping && mapping[sourceGuid]) {
        // Use EntitySetName for the @odata.bind reference
        const setName = entitySetNames.get(target) || target;
        remapped[`${navProperty}@odata.bind`] = `/${setName}(${mapping[sourceGuid]})`;
      }
    }
    // Remove raw lookup value keys
    delete remapped[valueKey];
  }

  return remapped;
}

/**
 * Upsert a single record in the target environment.
 * Returns true on success, false on failure.
 */
async function upsertRecord(
  envUrl: string,
  token: string,
  tableName: string,
  record: DataverseRecord,
  primaryIdColumn: string,
  conflictResolution: ConflictResolution
): Promise<{ success: boolean; skipped: boolean }> {
  const recordId = record[primaryIdColumn] as string;
  const url = `${envUrl}/api/data/v9.2/${tableName}(${recordId})`;
  const headers = {
    ...buildAuthHeaders(token),
    "Content-Type": "application/json",
  };

  if (conflictResolution === "skip") {
    // Check if record exists first
    try {
      const checkResp = await fetchWithRetry(url, {
        headers: buildAuthHeaders(token),
        method: "GET",
      }, { maxRetries: 0 });
      if (checkResp.ok) {
        return { success: true, skipped: true };
      }
    } catch {
      // Record doesn't exist — proceed with create
    }
  }

  const payload = stripODataAnnotations(record, primaryIdColumn);

  // PATCH without If-Match or If-None-Match = true upsert (creates if missing, updates if exists)
  // PATCH with If-Match: * = update only (fails if record doesn't exist)
  // PATCH with If-None-Match: * = create only (fails if record already exists)
  const conditionalHeaders: Record<string, string> = {};
  if (conflictResolution === "skip") {
    // Should not reach here (handled above), but as safeguard: create-only
    conditionalHeaders["If-None-Match"] = "*";
  }
  // For "upsert" and "overwrite" — plain PATCH with no condition = true upsert

  try {
    const resp = await fetchWithRetry(url, {
      method: "PATCH",
      headers: { ...headers, ...conditionalHeaders },
      body: JSON.stringify(payload),
    }, { maxRetries: 1 });

    return { success: resp.ok || resp.status === 204, skipped: false };
  } catch (err) {
    // If skip mode and 412 Precondition Failed — record already exists
    if (conflictResolution === "skip" && err && typeof err === "object" && (err as Record<string, unknown>).status === 412) {
      return { success: true, skipped: true };
    }
    throw err;
  }
}

// ─── Main Migration Function ──────────────────────────────

export async function migrateTableData(
  config: DataMigrationConfig
): Promise<{
  results: Array<{
    table: string;
    exported: number;
    imported: number;
    failed: number;
    skipped: number;
    errors?: string[];
  }>;
}> {
  const results: Array<{
    table: string;
    exported: number;
    imported: number;
    failed: number;
    skipped: number;
    errors?: string[];
  }> = [];

  for (const tableConfig of config.tables) {
    const { logicalName, conflictResolution, fetchXmlFilter, selectedColumns } = tableConfig;

    // 1. Fetch table metadata to identify columns and lookups
    // First get core entity properties (separate from $expand to ensure they're returned)
    // Fetch EntitySetName from TARGET (where we'll write) — the table must exist there
    // After schema migration, metadata may take a moment to propagate, so retry on 404
    let entitySetName = "";
    let entityDef: Record<string, unknown> = {};
    const META_RETRY_COUNT = 6;
    const META_RETRY_DELAY = 5000; // 5 seconds between retries
    let metaFound = false;
    for (let metaAttempt = 0; metaAttempt < META_RETRY_COUNT; metaAttempt++) {
      try {
        const targetEntityResp = await fetchWithRetry(
          `${config.targetUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,LogicalName`,
          { headers: buildAuthHeaders(config.targetToken) },
          { maxRetries: 0 }
        );
        entityDef = await targetEntityResp.json();
        entitySetName = (entityDef.EntitySetName as string) || "";
        console.log(`[DataMigration] Target has table ${logicalName} → EntitySetName: ${entitySetName}`);
        metaFound = true;
        break;
      } catch (metaErr) {
        const status = (metaErr as { status?: number })?.status;
        if (status === 404 && metaAttempt < META_RETRY_COUNT - 1) {
          console.log(`[DataMigration] Table '${logicalName}' metadata not yet available in target (attempt ${metaAttempt + 1}/${META_RETRY_COUNT}), retrying in ${META_RETRY_DELAY / 1000}s...`);
          config.onProgress?.({
            phase: "importing",
            tableName: logicalName,
            current: 0,
            total: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
          });
          await new Promise(r => setTimeout(r, META_RETRY_DELAY));
          continue;
        }
        // Final attempt or non-404 error — table doesn't exist
        const errMsg = `Table '${logicalName}' does not exist in the target environment. Deploy the solution containing this table first.`;
        console.error(`[DataMigration] ${errMsg}`);
        results.push({
          table: logicalName,
          exported: 0,
          imported: 0,
          failed: 0,
          skipped: 0,
          errors: [errMsg],
        });
        metaFound = false;
        break;
      }
    }
    if (!metaFound) continue;

    if (!entitySetName) {
      // Fallback: try source metadata
      const sourceEntityResp = await fetchWithRetry(
        `${config.sourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,LogicalName`,
        { headers: buildAuthHeaders(config.sourceToken) }
      );
      const sourceDef = await sourceEntityResp.json();
      entitySetName = (sourceDef.EntitySetName as string) || `${logicalName}s`;
      entityDef = { ...entityDef, ...sourceDef };
    }

    console.log(`[DataMigration] Table: ${logicalName} → EntitySetName: ${entitySetName}, PrimaryId: ${entityDef.PrimaryIdAttribute}`);

    // Then fetch attributes
    const metaResp = await fetchWithRetry(
      `${config.sourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes`,
      { headers: buildAuthHeaders(config.sourceToken) }
    );
    const metadata = await metaResp.json();
    const attributes = metadata.value || [];
    const primaryIdColumn: string = (entityDef.PrimaryIdAttribute as string) || `${logicalName}id`;
    const primaryNameColumn: string = (entityDef.PrimaryNameAttribute as string) || "name";
    const allColumns: DataverseColumn[] = (attributes).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (attr: any) => ({
        logicalName: attr.LogicalName,
        displayName: attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName,
        attributeType: attr.AttributeTypeName?.Value || attr.AttributeType || "String",
        isPrimaryId: attr.LogicalName === primaryIdColumn,
        isPrimaryName: attr.LogicalName === primaryNameColumn,
        isCustomAttribute: attr.IsCustomAttribute ?? false,
        requiredLevel: attr.RequiredLevel?.Value || "None",
        lookupTarget: attr.Targets?.[0] || undefined,
      })
    );

    const lookupColumns = allColumns.filter(isLookupColumn);

    // Validate EntitySetName works on target before proceeding
    try {
      await fetchWithRetry(
        `${config.targetUrl}/api/data/v9.2/${entitySetName}?$top=1&$select=${primaryIdColumn}`,
        { headers: buildAuthHeaders(config.targetToken) },
        { maxRetries: 1 }
      );
    } catch (valErr) {
      const msg = valErr && typeof valErr === "object" && "message" in valErr
        ? (valErr as { message: string }).message : String(valErr);
      console.error(`[DataMigration] EntitySetName '${entitySetName}' not valid on target: ${msg}`);
      results.push({
        table: logicalName,
        exported: 0,
        imported: 0,
        failed: 0,
        skipped: 0,
        errors: [`Table '${logicalName}' (EntitySet: '${entitySetName}') not accessible on target: ${msg}`],
      });
      continue;
    }

    // 2. Export records from source
    config.onProgress?.({
      tableName: logicalName,
      phase: "exporting",
      current: 0,
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    const records = await fetchAllRecords(
      config.sourceUrl,
      config.sourceToken,
      entitySetName,
      fetchXmlFilter,
      selectedColumns,
      config.batchSize
    );

    config.onProgress?.({
      tableName: logicalName,
      phase: "exporting",
      current: records.length,
      total: records.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    // 3. Build lookup mappings
    config.onProgress?.({
      tableName: logicalName,
      phase: "mapping",
      current: 0,
      total: lookupColumns.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    const lookupMappings = new Map<string, LookupMapping>();
    const entitySetNames = new Map<string, string>();
    for (const col of lookupColumns) {
      const target = col.lookupTarget;
      if (target && !lookupMappings.has(target)) {
        try {
          // Get primary name attribute and EntitySetName of the related table
          const relMeta = await fetchWithRetry(
            `${config.sourceUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(target)}')?$select=PrimaryNameAttribute,EntitySetName`,
            { headers: buildAuthHeaders(config.sourceToken) }
          );
          const relData = await relMeta.json();
          const relPrimaryName = relData.PrimaryNameAttribute || "name";
          const relEntitySetName = relData.EntitySetName || target;
          entitySetNames.set(target, relEntitySetName);

          const mapping = await buildLookupMapping(
            config.sourceUrl,
            config.targetUrl,
            config.sourceToken,
            config.targetToken,
            relEntitySetName,
            relPrimaryName,
            target
          );
          lookupMappings.set(target, mapping);
        } catch {
          // If we can't map this lookup, we'll skip remapping for it
          lookupMappings.set(target, {});
        }
      }
    }

    // 4. Import into target
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i++) {
      let record = records[i];

      // Remap lookup GUIDs
      record = remapLookups(record, lookupColumns, lookupMappings, entitySetNames);

      if (i === 0) {
        const recordId = record[primaryIdColumn] as string;
        console.log(`[DataMigration] First upsert URL: ${config.targetUrl}/api/data/v9.2/${entitySetName}(${recordId})`);
      }

      try {
        const result = await upsertRecord(
          config.targetUrl,
          config.targetToken,
          entitySetName,
          record,
          primaryIdColumn,
          conflictResolution
        );
        if (result.skipped) {
          skipped++;
        } else if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        // Log the error for debugging — visible in browser console
        const errMsg = err && typeof err === "object" && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
        console.error(`[DataMigration] Failed to upsert record ${i + 1}/${records.length} in ${logicalName}:`, errMsg);
      }

      config.onProgress?.({
        tableName: logicalName,
        phase: "importing",
        current: i + 1,
        total: records.length,
        succeeded,
        failed,
        skipped,
      });
    }

    results.push({
      table: logicalName,
      exported: records.length,
      imported: succeeded,
      failed,
      skipped,
    });
  }

  return { results };
}
