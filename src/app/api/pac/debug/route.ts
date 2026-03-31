import { NextRequest, NextResponse } from "next/server";

/**
 * Debug endpoint to check EntitySetName for a table.
 * Usage: GET /api/pac/debug?logicalName=cr9ef_tbl_hazard
 * (Uses the MSAL token passed in Authorization header)
 */
export async function GET(req: NextRequest) {
  const logicalName = req.nextUrl.searchParams.get("logicalName");
  const orgUrl = req.nextUrl.searchParams.get("orgUrl");
  const authHeader = req.headers.get("Authorization");

  if (!logicalName || !orgUrl || !authHeader) {
    return NextResponse.json(
      { error: "logicalName, orgUrl query params and Authorization header required" },
      { status: 400 }
    );
  }

  try {
    const url = `${orgUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,LogicalName,SchemaName,CollectionSchemaName`;
    const resp = await fetch(url, {
      headers: { Authorization: authHeader },
    });
    const data = await resp.json();
    return NextResponse.json({
      status: resp.status,
      EntitySetName: data.EntitySetName,
      PrimaryIdAttribute: data.PrimaryIdAttribute,
      PrimaryNameAttribute: data.PrimaryNameAttribute,
      LogicalName: data.LogicalName,
      SchemaName: data.SchemaName,
      CollectionSchemaName: data.CollectionSchemaName,
      rawKeys: Object.keys(data),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
