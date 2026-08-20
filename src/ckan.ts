import type { ApiStyle } from "./portals";

type CkanResponse<T> = {
  success: boolean;
  result?: T;
  error?: { message?: string };
};

type CkanError = { success: false; error: string };

function isCkanError<T>(value: T | CkanError): value is CkanError {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as CkanError).success === false
  );
}

function actionPath(apiStyle: ApiStyle, action: string): string {
  return apiStyle === "shirasagi" ? `api/${action}` : `api/3/action/${action}`;
}

async function ckanGet<T>(
  baseUrl: string,
  apiStyle: ApiStyle,
  action: string,
  params: Record<string, string | number | undefined>
): Promise<T | CkanError> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(actionPath(apiStyle, action), base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "ckan-mcp-worker/1.0 (Cloudflare Workers)",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    let data: CkanResponse<T>;
    try {
      data = (await response.json()) as CkanResponse<T>;
    } catch {
      return { success: false, error: "Invalid JSON response from CKAN API" };
    }

    if (!data.success) {
      return {
        success: false,
        error: data.error?.message ?? "CKAN API error",
      };
    }

    return data.result as T;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isDatastoreUnavailable(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("datastore") ||
    lower.includes("data store") ||
    lower.includes("not found") ||
    lower.includes("no such resource") ||
    // Some responses carry an empty statusText, leaving just the status code.
    lower.includes("404")
  );
}

export async function searchDatasets(
  baseUrl: string,
  apiStyle: ApiStyle,
  keyword: string,
  limit: number,
  offset: number
) {
  return ckanGet(baseUrl, apiStyle, "package_search", {
    q: keyword,
    rows: limit,
    start: offset,
  });
}

export async function getDataset(
  baseUrl: string,
  apiStyle: ApiStyle,
  id: string
) {
  return ckanGet(baseUrl, apiStyle, "package_show", { id });
}

export async function searchRecords(
  baseUrl: string,
  apiStyle: ApiStyle,
  resourceId: string,
  query: string | undefined,
  limit: number,
  offset: number,
  filters?: Record<string, unknown>
) {
  const params: Record<string, string | number | undefined> = {
    resource_id: resourceId,
    limit,
    offset,
  };

  if (query) {
    params.q = query;
  }

  if (filters && Object.keys(filters).length > 0) {
    params.filters = JSON.stringify(filters);
  }

  const result = await ckanGet(baseUrl, apiStyle, "datastore_search", params);

  if (isCkanError(result)) {
    if (isDatastoreUnavailable(result.error)) {
      return { available: false as const };
    }
    return result;
  }

  return result;
}

export async function listOrganizations(
  baseUrl: string,
  apiStyle: ApiStyle,
  limit: number
) {
  return ckanGet(baseUrl, apiStyle, "organization_list", {
    limit,
    all_fields: "true",
  });
}

export { isCkanError };
