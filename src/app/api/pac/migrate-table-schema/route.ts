import { NextRequest, NextResponse } from "next/server";

function isValidEnvUrl(url: string): boolean {
  return /^https:\/\/[a-zA-Z0-9._-]+\.(dynamics\.com|crm[0-9]*\.dynamics\.com)\/?$/.test(
    url.replace(/\/$/, "") + "/"
  );
}

interface AttributeDef {
  LogicalName: string;
  SchemaName: string;
  AttributeType: string;
  AttributeTypeName?: { Value: string };
  DisplayName?: { LocalizedLabels?: { Label: string; LanguageCode: number }[] };
  Description?: { LocalizedLabels?: { Label: string; LanguageCode: number }[] };
  RequiredLevel?: { Value: string };
  MaxLength?: number;
  FormatName?: { Value: string };
  Format?: string;
  MaxValue?: number;
  MinValue?: number;
  Precision?: number;
  ImeMode?: string;
  Targets?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// Attribute types that are system-managed and should never be created manually
const SKIP_ATTR_TYPES = new Set([
  "Virtual", "Uniqueidentifier", "EntityName", "Owner", "PartyList",
  "CalendarRules", "ManagedProperty",
]);

// System columns that Dataverse creates automatically
const SYSTEM_COLUMNS = new Set([
  "createdon", "createdby", "modifiedon", "modifiedby", "ownerid",
  "owninguser", "owningteam", "owningbusinessunit", "organizationid",
  "versionnumber", "overriddencreatedon", "importsequencenumber",
  "timezoneruleversionnumber", "utcconversiontimezonecode",
  "statecode", "statuscode", "createdbyname", "modifiedbyname",
  "owneridname", "owneridtype", "createdonbehalfby", "modifiedonbehalfby",
  "createdonbehalfbyname", "modifiedonbehalfbyname",
]);

async function apiGet(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url.split("?")[0]} failed (${res.status}): ${text.substring(0, 500)}`);
  }
  return res.json();
}

async function apiPost(url: string, token: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url.split("?")[0]} failed (${res.status}): ${text.substring(0, 500)}`);
  }
  return res;
}

function getLabel(displayName?: { LocalizedLabels?: { Label: string; LanguageCode: number }[] }) {
  return displayName?.LocalizedLabels?.[0]?.Label || "";
}

function makeLabelObj(text: string) {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.Label",
    LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: 1033 }],
  };
}

/**
 * Check if an entity already exists in the target environment.
 */
async function entityExistsInTarget(targetUrl: string, targetToken: string, logicalName: string): Promise<boolean> {
  try {
    await apiGet(
      `${targetUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName`,
      targetToken
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate a Dataverse table SCHEMA from source to target using the Metadata API.
 *
 * This approach:
 * - Reads entity + attribute definitions from source
 * - Creates the entity in target with basic columns
 * - Skips lookup columns that reference tables not yet in target
 * - No solution packaging needed — avoids cascading dependency issues
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sourceUrl, targetUrl, tableLogicalName, sourceToken, targetToken } = body as {
    sourceUrl: string;
    targetUrl: string;
    tableLogicalName: string;
    sourceToken: string;
    targetToken: string;
  };

  if (!sourceUrl || !targetUrl || !tableLogicalName || !sourceToken || !targetToken) {
    return NextResponse.json(
      { error: "sourceUrl, targetUrl, tableLogicalName, sourceToken, and targetToken are required" },
      { status: 400 }
    );
  }
  if (!isValidEnvUrl(sourceUrl) || !isValidEnvUrl(targetUrl)) {
    return NextResponse.json({ error: "Invalid environment URL" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(tableLogicalName)) {
    return NextResponse.json({ error: "Invalid table logical name" }, { status: 400 });
  }

  const src = sourceUrl.replace(/\/$/, "");
  const tgt = targetUrl.replace(/\/$/, "");
  const steps: string[] = [];
  const skippedColumns: string[] = [];

  try {
    // ── 0. Check if table already exists in target ──
    const alreadyExists = await entityExistsInTarget(tgt, targetToken, tableLogicalName);
    if (alreadyExists) {
      steps.push(`Table '${tableLogicalName}' already exists in target — skipping schema creation.`);
      return NextResponse.json({
        success: true,
        steps,
        skippedColumns: [],
        message: `Table '${tableLogicalName}' already exists in target`,
      });
    }

    // ── 1. Read entity definition from source ──
    steps.push("Reading table definition from source...");
    const entityDef = await apiGet(
      `${src}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')?$select=SchemaName,LogicalName,DisplayName,DisplayCollectionName,Description,OwnershipType,HasNotes,HasActivities,PrimaryNameAttribute,TableType,IsActivity`,
      sourceToken
    );

    // ── 2. Read attributes from source ──
    steps.push("Reading column definitions from source...");
    const attrData = await apiGet(
      `${src}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes?$select=LogicalName,SchemaName,AttributeType,AttributeTypeName,DisplayName,Description,RequiredLevel,MaxLength,FormatName,Format,MaxValue,MinValue,Precision,ImeMode,DateTimeBehavior&$filter=IsCustomAttribute eq true`,
      sourceToken
    );
    const sourceAttrs: AttributeDef[] = attrData.value || [];

    // For picklist attributes, fetch OptionSet options separately
    for (const attr of sourceAttrs) {
      const typeName = attr.AttributeTypeName?.Value || attr.AttributeType;
      if (typeName === "PicklistType" || typeName === "MultiSelectPicklistType") {
        try {
          const castType = typeName === "PicklistType"
            ? "Microsoft.Dynamics.CRM.PicklistAttributeMetadata"
            : "Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata";
          const optData = await apiGet(
            `${src}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes(LogicalName='${attr.LogicalName}')/${castType}?$select=LogicalName&$expand=OptionSet($select=Options,IsGlobal,Name)`,
            sourceToken
          );
          attr.OptionSet = optData.OptionSet;
        } catch { /* use empty options */ }
      }
    }

    // ── 3. Read the primary name attribute details ──
    const primaryNameAttr = entityDef.PrimaryNameAttribute as string;
    let primaryNameDef: AttributeDef | null = null;
    try {
      primaryNameDef = await apiGet(
        `${src}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes(LogicalName='${primaryNameAttr}')?$select=LogicalName,SchemaName,AttributeType,DisplayName,Description,MaxLength,RequiredLevel,FormatName`,
        sourceToken
      );
    } catch {
      // fallback — use defaults
    }

    // ── 4. Create the entity in target ──
    steps.push(`Creating table '${tableLogicalName}' in target...`);

    const primaryNameSchema = primaryNameDef?.SchemaName || entityDef.SchemaName + "_name";
    const primaryNameLabel = getLabel(primaryNameDef?.DisplayName) || "Name";
    const primaryNameMaxLen = primaryNameDef?.MaxLength || 100;

    const createEntityBody: Record<string, unknown> = {
      SchemaName: entityDef.SchemaName,
      DisplayName: entityDef.DisplayName || makeLabelObj(entityDef.SchemaName),
      DisplayCollectionName: entityDef.DisplayCollectionName || makeLabelObj(entityDef.SchemaName + "s"),
      Description: entityDef.Description || makeLabelObj(""),
      OwnershipType: entityDef.OwnershipType || "UserOwned",
      HasNotes: entityDef.HasNotes ?? false,
      HasActivities: entityDef.HasActivities ?? false,
      PrimaryNameAttribute: primaryNameAttr,
      "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
      Attributes: [
        {
          "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
          SchemaName: primaryNameSchema,
          DisplayName: makeLabelObj(primaryNameLabel),
          Description: primaryNameDef?.Description || makeLabelObj(""),
          RequiredLevel: { Value: "ApplicationRequired", CanBeChanged: true, ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings" },
          MaxLength: primaryNameMaxLen,
          IsPrimaryName: true,
          FormatName: { Value: "Text" },
        },
      ],
    };

    await apiPost(`${tgt}/api/data/v9.2/EntityDefinitions`, targetToken, createEntityBody);
    steps.push(`Table '${tableLogicalName}' created successfully.`);

    // ── 5. Add custom columns one by one ──
    steps.push("Adding custom columns...");
    let addedCount = 0;

    for (const attr of sourceAttrs) {
      const logName = attr.LogicalName;
      const typeName = attr.AttributeTypeName?.Value || attr.AttributeType;

      // Skip the primary name attribute (already created)
      if (logName === primaryNameAttr) continue;
      // Skip system/virtual columns
      if (SYSTEM_COLUMNS.has(logName)) continue;
      if (SKIP_ATTR_TYPES.has(attr.AttributeType)) continue;
      // Skip auto-generated columns (id column, etc.)
      if (logName === `${tableLogicalName}id`) continue;

      // For Lookup columns, create via relationship instead of attribute
      if (attr.AttributeType === "Lookup" || attr.AttributeType === "Customer") {
        // Get the target entities for this lookup
        let targets: string[] = [];
        try {
          const lookupMeta = await apiGet(
            `${src}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes(LogicalName='${logName}')/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=Targets,SchemaName`,
            sourceToken
          );
          targets = lookupMeta.Targets || [];
        } catch { /* skip if we can't read metadata */ }

        // Check if all target entities exist in target env
        let allTargetsExist = true;
        for (const targetEntity of targets) {
          const exists = await entityExistsInTarget(tgt, targetToken, targetEntity);
          if (!exists) {
            allTargetsExist = false;
            break;
          }
        }
        if (!allTargetsExist) {
          skippedColumns.push(`${logName} (lookup → ${targets.join(", ")} not in target)`);
          continue;
        }

        // Create a One-to-Many relationship (which auto-creates the lookup column)
        if (targets.length > 0) {
          try {
            // Read the relationship from source
            const relData = await apiGet(
              `${src}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')/ManyToOneRelationships?$filter=ReferencingAttribute eq '${logName}'&$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencingAttribute,CascadeConfiguration`,
              sourceToken
            );
            const rel = relData.value?.[0];
            if (rel) {
              await apiPost(`${tgt}/api/data/v9.2/RelationshipDefinitions`, targetToken, {
                "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
                SchemaName: rel.SchemaName,
                ReferencedEntity: rel.ReferencedEntity,
                ReferencingEntity: rel.ReferencingEntity,
                Lookup: {
                  SchemaName: attr.SchemaName,
                  DisplayName: attr.DisplayName || makeLabelObj(attr.SchemaName),
                  Description: attr.Description || makeLabelObj(""),
                  RequiredLevel: attr.RequiredLevel || { Value: "None", CanBeChanged: true, ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings" },
                },
                CascadeConfiguration: rel.CascadeConfiguration || {
                  Assign: "NoCascade", Delete: "RemoveLink", Merge: "NoCascade",
                  Reparent: "NoCascade", Share: "NoCascade", Unshare: "NoCascade",
                },
              });
              addedCount++;
            } else {
              skippedColumns.push(`${logName} (no relationship found in source)`);
            }
          } catch (relErr) {
            const msg = relErr instanceof Error ? relErr.message : String(relErr);
            if (msg.includes("already exists") || msg.includes("DuplicateRelationship")) {
              addedCount++;
            } else {
              skippedColumns.push(`${logName} (relationship error: ${msg.substring(0, 100)})`);
            }
          }
        }
        continue;
      }

      // Build attribute creation payload based on type
      try {
        const attrBody = buildAttributePayload(attr, typeName);
        if (!attrBody) {
          skippedColumns.push(`${logName} (unsupported type: ${typeName})`);
          continue;
        }

        await apiPost(
          `${tgt}/api/data/v9.2/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes`,
          targetToken,
          attrBody
        );
        addedCount++;
      } catch (attrErr) {
        const msg = attrErr instanceof Error ? attrErr.message : String(attrErr);
        // If column already exists (e.g., from a prior partial run), skip it
        if (msg.includes("already exists") || msg.includes("DuplicateAttributeSchemaName")) {
          addedCount++;
          continue;
        }
        skippedColumns.push(`${logName} (error: ${msg.substring(0, 100)})`);
      }
    }

    steps.push(`Added ${addedCount} columns. Skipped ${skippedColumns.length} columns.`);

    // ── 6. Publish customizations ──
    steps.push("Publishing customizations...");
    await apiPost(`${tgt}/api/data/v9.2/PublishXml`, targetToken, {
      ParameterXml: `<importexportxml><entities><entity>${tableLogicalName}</entity></entities></importexportxml>`,
    });

    return NextResponse.json({
      success: true,
      steps,
      skippedColumns,
      message: `Table '${tableLogicalName}' schema created in target (${addedCount} columns added, ${skippedColumns.length} skipped)`,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail, steps, skippedColumns }, { status: 500 });
  }
}

/**
 * Build the attribute creation payload for the target environment.
 */
function buildAttributePayload(attr: AttributeDef, typeName: string): Record<string, unknown> | null {
  const base: Record<string, unknown> = {
    SchemaName: attr.SchemaName,
    DisplayName: attr.DisplayName || makeLabelObj(attr.SchemaName),
    Description: attr.Description || makeLabelObj(""),
    RequiredLevel: attr.RequiredLevel || { Value: "None", CanBeChanged: true, ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings" },
  };

  switch (typeName) {
    case "StringType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        MaxLength: attr.MaxLength || 100,
        FormatName: attr.FormatName || { Value: "Text" },
      };

    case "MemoType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        MaxLength: attr.MaxLength || 2000,
        FormatName: attr.FormatName || { Value: "Text" },
      };

    case "IntegerType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
        MaxValue: attr.MaxValue ?? 2147483647,
        MinValue: attr.MinValue ?? -2147483648,
        Format: attr.Format || "None",
      };

    case "DecimalType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
        MaxValue: attr.MaxValue ?? 100000000000,
        MinValue: attr.MinValue ?? -100000000000,
        Precision: attr.Precision ?? 2,
      };

    case "DoubleType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.DoubleAttributeMetadata",
        MaxValue: attr.MaxValue ?? 100000000000,
        MinValue: attr.MinValue ?? -100000000000,
        Precision: attr.Precision ?? 2,
      };

    case "MoneyType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.MoneyAttributeMetadata",
        MaxValue: attr.MaxValue ?? 922337203685477,
        MinValue: attr.MinValue ?? -922337203685477,
        Precision: attr.Precision ?? 2,
        PrecisionSource: attr.PrecisionSource ?? 2,
      };

    case "BooleanType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        OptionSet: {
          TrueOption: { Value: 1, Label: makeLabelObj("Yes") },
          FalseOption: { Value: 0, Label: makeLabelObj("No") },
          OptionSetType: "Boolean",
        },
      };

    case "DateTimeType":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        Format: attr.Format || "DateAndTime",
        DateTimeBehavior: attr.DateTimeBehavior || { Value: "UserLocal" },
      };

    case "PicklistType": {
      // Need to read the option set values from source
      // For now create with an empty local option set — values will be populated by data
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        OptionSet: {
          IsGlobal: false,
          OptionSetType: "Picklist",
          Options: attr.OptionSet?.Options?.map((o: { Value: number; Label?: unknown }) => ({
            Value: o.Value,
            Label: o.Label || makeLabelObj(`Option ${o.Value}`),
          })) || [],
        },
      };
    }

    case "MultiSelectPicklistType": {
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata",
        OptionSet: {
          IsGlobal: false,
          OptionSetType: "Picklist",
          Options: attr.OptionSet?.Options?.map((o: { Value: number; Label?: unknown }) => ({
            Value: o.Value,
            Label: o.Label || makeLabelObj(`Option ${o.Value}`),
          })) || [],
        },
      };
    }

    case "LookupType":
      // Lookups are handled specially — need a relationship, not just an attribute
      // We create a 1:N relationship which creates the lookup column automatically
      return null; // Will be handled separately by the caller if target entity exists

    default:
      return null;
  }
}
