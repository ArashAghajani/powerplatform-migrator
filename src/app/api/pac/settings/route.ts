import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * GET — read a Dataverse environment setting
 * POST — update a Dataverse environment setting
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  const env = req.nextUrl.searchParams.get("environment");

  if (!name) {
    return NextResponse.json({ error: "name query param is required" }, { status: 400 });
  }
  if (!/^[a-zA-Z_]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid setting name" }, { status: 400 });
  }

  try {
    const args = ["env", "list-settings", "--filter", name];
    if (env) {
      if (!/^https:\/\/[a-zA-Z0-9._-]+\.(dynamics\.com|crm[0-9]*\.dynamics\.com)\/?$/.test(env.replace(/\/$/, "") + "/")) {
        return NextResponse.json({ error: "Invalid environment URL" }, { status: 400 });
      }
      args.push("--environment", env.replace(/\/$/, ""));
    }

    const { stdout } = await execFileAsync("pac", args, { timeout: 30_000 });

    // Parse the table output: "Setting  Value\nmaxuploadfilesize  5,242,880"
    const lines = stdout.trim().split("\n").filter((l) => l.trim());
    if (lines.length >= 2) {
      const valueLine = lines[lines.length - 1];
      const parts = valueLine.split(/\s{2,}/);
      const value = parts.length >= 2 ? parts[parts.length - 1].replace(/,/g, "") : null;
      return NextResponse.json({ name, value });
    }

    return NextResponse.json({ name, value: null, raw: stdout });
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    return NextResponse.json({ error: execErr.stderr || execErr.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, value, environment } = body as {
    name: string;
    value: string;
    environment?: string;
  };

  if (!name || value === undefined) {
    return NextResponse.json({ error: "name and value are required" }, { status: 400 });
  }
  if (!/^[a-zA-Z_]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid setting name" }, { status: 400 });
  }

  try {
    const args = ["env", "update-settings", "--name", name, "--value", String(value)];
    if (environment) {
      if (!/^https:\/\/[a-zA-Z0-9._-]+\.(dynamics\.com|crm[0-9]*\.dynamics\.com)\/?$/.test(environment.replace(/\/$/, "") + "/")) {
        return NextResponse.json({ error: "Invalid environment URL" }, { status: 400 });
      }
      args.push("--environment", environment.replace(/\/$/, ""));
    }

    const { stdout } = await execFileAsync("pac", args, { timeout: 30_000 });
    return NextResponse.json({ success: true, output: stdout.trim() });
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    return NextResponse.json({ error: execErr.stderr || execErr.message || String(err) }, { status: 500 });
  }
}
