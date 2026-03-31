import type { ApiError } from "@/lib/types";

const POWER_PLATFORM_ERROR_MAP: Record<string, string> = {
  "0x80040216": "The record was not found. It may have been deleted.",
  "0x80040217": "You do not have permission to perform this action.",
  "0x80040220": "A duplicate record was found.",
  "0x80040237": "The solution import failed due to missing dependencies.",
  "0x80048408": "The user does not have sufficient privileges.",
  "0x8004431A": "The environment variable value is not valid.",
  "0x80060891": "A business rule validation error occurred.",
  "0x80072560": "The connection reference could not be resolved.",
  "0x80072322": "The solution cannot be uninstalled because other solutions depend on it.",
};

export function mapApiError(error: unknown): ApiError {
  if (error instanceof Response || (error && typeof error === "object" && "status" in error)) {
    const resp = error as Response;
    return {
      code: String(resp.status),
      message: resp.statusText || "Request failed",
      retryable: resp.status === 429 || resp.status >= 500,
    };
  }
  if (error && typeof error === "object" && "code" in error) {
    const e = error as { code: string; message?: string };
    return {
      code: e.code,
      message: POWER_PLATFORM_ERROR_MAP[e.code] || e.message || "An error occurred",
      retryable: false,
    };
  }
  return {
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "An unexpected error occurred",
    retryable: false,
  };
}

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOpts: RetryOptions = {}
): Promise<Response> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 30000 } = retryOpts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) return response;

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

        if (attempt < maxRetries) {
          await sleep(delay);
          continue;
        }
      }

      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(Math.min(baseDelay * Math.pow(2, attempt), maxDelay));
        continue;
      }

      const body = await response.json().catch(() => ({}));
      throw {
        status: response.status,
        statusText: response.statusText,
        code: body?.error?.code || String(response.status),
        message: body?.error?.message || response.statusText,
      };
    } catch (err) {
      lastError = err;
      if (
        attempt < maxRetries &&
        err instanceof TypeError &&
        err.message.includes("fetch")
      ) {
        await sleep(Math.min(baseDelay * Math.pow(2, attempt), maxDelay));
        continue;
      }
      if (attempt === maxRetries) throw err;
    }
  }

  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
  };
}
