import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    const { stdout } = await execFileAsync("pac", ["auth", "list"], {
      timeout: 15_000,
    });
    return NextResponse.json({ available: true, output: stdout });
  } catch {
    return NextResponse.json({ available: false, output: "PAC CLI not found or not authenticated. Run: pac auth create --url <envUrl>" });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { environmentUrl } = body as { environmentUrl: string };

  if (!environmentUrl) {
    return NextResponse.json({ error: "environmentUrl is required" }, { status: 400 });
  }

  // Validate environment URL
  if (!/^https:\/\/[a-zA-Z0-9._-]+\.(dynamics\.com|crm[0-9]*\.dynamics\.com)\/?$/.test(environmentUrl.replace(/\/$/, "") + "/")) {
    return NextResponse.json({ error: "Invalid environment URL" }, { status: 400 });
  }

  try {
    // Check if there's already an auth profile for this URL
    const { stdout: listOut } = await execFileAsync("pac", ["auth", "list"], {
      timeout: 15_000,
    });

    const normalizedUrl = environmentUrl.replace(/\/$/, "").toLowerCase();
    const hasAuth = listOut.toLowerCase().includes(normalizedUrl);

    if (!hasAuth) {
      // Create a new auth profile — this will open a browser for interactive login
      const { stdout, stderr } = await execFileAsync(
        "pac",
        ["auth", "create", "--url", environmentUrl.replace(/\/$/, "")],
        { timeout: 120_000 }
      );
      return NextResponse.json({
        success: true,
        message: "Auth profile created",
        output: [stdout, stderr].filter(Boolean).join("\n"),
      });
    }

    // Select the existing auth profile for this URL
    // Find the index of the matching profile
    const lines = listOut.split("\n");
    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]/);
      if (match && line.toLowerCase().includes(normalizedUrl)) {
        await execFileAsync(
          "pac",
          ["auth", "select", "--index", match[1]],
          { timeout: 15_000 }
        );
        return NextResponse.json({
          success: true,
          message: `Selected existing auth profile [${match[1]}]`,
        });
      }
    }

    // No matching profile found by URL, create one
    const { stdout, stderr } = await execFileAsync(
      "pac",
      ["auth", "create", "--url", environmentUrl.replace(/\/$/, "")],
      { timeout: 120_000 }
    );
    return NextResponse.json({
      success: true,
      message: "Auth profile created",
      output: [stdout, stderr].filter(Boolean).join("\n"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
