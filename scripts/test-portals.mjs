#!/usr/bin/env node
/**
 * End-to-end search scenario for all CKAN portals (src/portals.ts).
 *
 * Per portal:
 *   1. search_datasets  — keyword search, expect hits
 *   2. get_dataset      — detail for first hit
 *   3. list_organizations
 *   4. search_records   — DataStore (sendai/bodik: records required;
 *                         geospatial: { available: false } is expected)
 *
 * Usage:
 *   npm run test:portals
 *   npm run test:portals:worker          # via Worker (npm run dev first)
 *   CKAN_MCP_BASE_URL=https://... npm run test:portals:worker
 *
 * Exit code: 0 if all checks pass, 1 otherwise.
 */

const PORTALS = {
  sendai: {
    name: "仙台市オープンデータ",
    url: "https://data.city.sendai.jp",
    apiStyle: "ckan",
    keyword: "公共施設",
    minCount: 1,
    expectDatastoreRecords: true,
    expectOrganizations: true,
  },
  geospatial: {
    name: "G空間情報センター",
    url: "https://www.geospatial.jp/ckan",
    apiStyle: "ckan",
    keyword: "PLATEAU",
    minCount: 1,
    /** This portal does not expose datastore_search. */
    expectDatastoreRecords: false,
    expectOrganizations: true,
  },
  bodik: {
    name: "BODIK（全国自治体オープンデータ）",
    url: "https://data.bodik.jp",
    apiStyle: "ckan",
    keyword: "施設",
    minCount: 1,
    expectDatastoreRecords: true,
    expectOrganizations: true,
  },
  shizuoka: {
    name: "静岡県オープンデータ",
    url: "https://opendata.pref.shizuoka.jp",
    /** Custom "Shirasagi" CMS API: `api/{action}`, not standard CKAN `api/3/action/{action}`. */
    apiStyle: "shirasagi",
    keyword: "人口",
    minCount: 1,
    /** Shirasagi does not expose datastore_search / organization_list. */
    expectDatastoreRecords: false,
    expectOrganizations: false,
  },
};

const USER_AGENT = "ckan-mcp-worker/1.0 (portal-search-test)";
const TIMEOUT_MS = 60_000;
const SEARCH_LIMIT = 5;
const ORG_LIMIT = 5;
const RECORD_LIMIT = 3;

function parseArgs(argv) {
  const worker = argv.includes("--worker");
  const baseIdx = argv.indexOf("--base");
  const baseUrl =
    (baseIdx >= 0 ? argv[baseIdx + 1] : undefined) ??
    process.env.CKAN_MCP_BASE_URL ??
    "http://localhost:8787";
  return { worker, baseUrl: baseUrl.replace(/\/$/, "") };
}

function actionPath(apiStyle, action) {
  return apiStyle === "shirasagi" ? `api/${action}` : `api/3/action/${action}`;
}

async function ckanAction(baseUrl, apiStyle, action, params) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(actionPath(apiStyle, action), base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const started = Date.now();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - started;

  if (!response.ok) {
    return { ok: false, ms, error: `HTTP ${response.status} ${response.statusText}` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, ms, error: "Invalid JSON" };
  }

  if (!data.success) {
    return { ok: false, ms, error: data.error?.message ?? "CKAN API error" };
  }

  return { ok: true, ms, result: data.result };
}

async function callWorkerTool(baseUrl, name, args) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - started;

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, ms, status: response.status, error: "Invalid JSON response" };
  }

  if (body.isError) {
    const text = body.content?.[0]?.text ?? "tool error";
    return { ok: false, ms, status: response.status, error: text };
  }

  let data;
  try {
    const text = body.content?.[0]?.text ?? "";
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      ms,
      status: response.status,
      error: "Could not parse tool result JSON",
    };
  }

  return { ok: true, ms, status: response.status, data };
}

function firstDatastoreResource(dataset) {
  const resources = dataset?.resources ?? [];
  return resources.find((r) => r.datastore_active) ?? null;
}

/**
 * Standard CKAN uses the `name` slug as the stable dataset identifier.
 * Shirasagi's `name` is just the human title, so `uuid` (or numeric `id`)
 * must be used instead when calling package_show.
 */
function resolveDatasetId(portal, hit) {
  return portal.apiStyle === "shirasagi"
    ? (hit.uuid ?? hit.id)
    : (hit.name ?? hit.id);
}

/** Find first datastore_active resource by checking search hits (up to max). */
async function findDatastoreViaSearch(portal, fetchDataset, results, max = 5) {
  for (const hit of results.slice(0, max)) {
    const id = resolveDatasetId(portal, hit);
    const fromHit = firstDatastoreResource(hit);
    if (fromHit) return { datasetId: id, resource: fromHit };

    const detail = await fetchDataset(id);
    if (!detail.ok) continue;
    const resource = firstDatastoreResource(detail.data);
    if (resource) return { datasetId: id, resource };
  }
  return null;
}

function formatTitles(results, max = 3) {
  return (results ?? [])
    .slice(0, max)
    .map((r) => r.title || r.name || r.id)
    .join(" | ");
}

function isDatastoreUnavailableError(message) {
  const lower = String(message).toLowerCase();
  return (
    lower.includes("datastore") ||
    lower.includes("data store") ||
    lower.includes("not found") ||
    lower.includes("no such resource") ||
    lower.includes("action name not known") ||
    lower.includes("bad request") ||
    // Some responses (e.g. HTTP/2 with no reason phrase) carry an empty
    // statusText, leaving just the status code as a signal.
    lower.includes("404")
  );
}

async function searchRecordsCkan(baseUrl, apiStyle, resourceId) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(actionPath(apiStyle, "datastore_search"), base);
  url.searchParams.set("resource_id", resourceId);
  url.searchParams.set("limit", String(RECORD_LIMIT));

  const started = Date.now();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - started;

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    if (!response.ok) {
      const msg = raw || `HTTP ${response.status}`;
      if (isDatastoreUnavailableError(msg)) {
        return { ok: true, ms, data: { available: false } };
      }
      return { ok: false, ms, error: msg };
    }
    return { ok: false, ms, error: "Invalid JSON" };
  }

  if (!response.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data?.error?.message ?? `HTTP ${response.status}`);
    if (isDatastoreUnavailableError(msg)) {
      return { ok: true, ms, data: { available: false } };
    }
    return { ok: false, ms, error: msg };
  }

  if (!data.success) {
    const msg = data.error?.message ?? "CKAN API error";
    if (isDatastoreUnavailableError(msg)) {
      return { ok: true, ms, data: { available: false } };
    }
    return { ok: false, ms, error: msg };
  }

  return { ok: true, ms, data: data.result };
}

function assertSearchRecords(lines, portal, resourceId, records) {
  if (!records.ok) {
    if (
      !portal.expectDatastoreRecords &&
      isDatastoreUnavailableError(records.error ?? "")
    ) {
      lines.push(
        `  ✓ search_records  resource=${resourceId} DataStore not available on portal (expected) (${records.ms}ms)`
      );
      return false;
    }
    lines.push(
      `  ✗ search_records  resource=${resourceId} ${records.error} (${records.ms}ms)`
    );
    return true;
  }

  if (records.data?.available === false) {
    if (portal.expectDatastoreRecords) {
      lines.push(
        `  ✗ search_records  resource=${resourceId} DataStore unavailable (expected records) (${records.ms}ms)`
      );
      return true;
    }
    lines.push(
      `  ✓ search_records  resource=${resourceId} DataStore not available on portal (expected) (${records.ms}ms)`
    );
    return false;
  }

  const total = records.data?.total ?? 0;
  const n = records.data?.records?.length ?? 0;
  if (portal.expectDatastoreRecords && (total < 1 || n < 1)) {
    lines.push(
      `  ✗ search_records  resource=${resourceId} total=${total} records=${n} (${records.ms}ms)`
    );
    return true;
  }

  lines.push(
    `  ✓ search_records  resource=${resourceId} total=${total} sample=${n} (${records.ms}ms)`
  );
  return false;
}

async function runPortalScenarioCkan(key, portal) {
  const lines = [];
  let failed = false;

  const search = await ckanAction(portal.url, portal.apiStyle, "package_search", {
    q: portal.keyword,
    rows: SEARCH_LIMIT,
  });
  if (!search.ok) {
    lines.push(`  ✗ search_datasets  ${search.error} (${search.ms}ms)`);
    return { key, name: portal.name, failed: true, lines };
  }

  const count = search.result?.count ?? 0;
  const results = search.result?.results ?? [];
  if (count < portal.minCount || results.length === 0) {
    lines.push(
      `  ✗ search_datasets  keyword="${portal.keyword}" count=${count} (expected >= ${portal.minCount}) (${search.ms}ms)`
    );
    return { key, name: portal.name, failed: true, lines };
  }

  lines.push(
    `  ✓ search_datasets  keyword="${portal.keyword}" count=${count} top: ${formatTitles(results)} (${search.ms}ms)`
  );

  const datasetId = resolveDatasetId(portal, results[0]);

  const detail = await ckanAction(portal.url, portal.apiStyle, "package_show", {
    id: datasetId,
  });
  if (!detail.ok) {
    failed = true;
    lines.push(`  ✗ get_dataset(${datasetId})  ${detail.error} (${detail.ms}ms)`);
  } else {
    const title = detail.result?.title ?? detail.result?.name ?? datasetId;
    const nRes = detail.result?.resources?.length ?? 0;
    lines.push(
      `  ✓ get_dataset  id=${datasetId} title="${title}" resources=${nRes} (${detail.ms}ms)`
    );
  }

  const orgs = await ckanAction(portal.url, portal.apiStyle, "organization_list", {
    limit: ORG_LIMIT,
    all_fields: "true",
  });
  if (!orgs.ok) {
    if (!portal.expectOrganizations && isDatastoreUnavailableError(orgs.error ?? "")) {
      lines.push(
        `  ✓ list_organizations  not available on portal (expected) (${orgs.ms}ms)`
      );
    } else {
      failed = true;
      lines.push(`  ✗ list_organizations  ${orgs.error} (${orgs.ms}ms)`);
    }
  } else {
    const names = (orgs.result ?? [])
      .slice(0, 3)
      .map((o) => o.title || o.name)
      .join(" | ");
    lines.push(
      `  ✓ list_organizations  count=${(orgs.result ?? []).length} top: ${names} (${orgs.ms}ms)`
    );
  }

  const fetchDataset = async (id) => {
    const r = await ckanAction(portal.url, portal.apiStyle, "package_show", { id });
    return r.ok ? { ok: true, data: r.result } : { ok: false };
  };
  const datastore = await findDatastoreViaSearch(portal, fetchDataset, results);
  if (!datastore) {
    if (portal.expectDatastoreRecords) {
      failed = true;
      lines.push(
        `  ✗ search_records  no datastore_active resource in top ${SEARCH_LIMIT} hits`
      );
    } else {
      lines.push(`  − search_records  skipped (no datastore_active resource in hits)`);
    }
    return { key, name: portal.name, failed, lines };
  }

  if (datastore.datasetId !== datasetId) {
    lines.push(
      `  · search_records  using dataset=${datastore.datasetId} resource=${datastore.resource.id}`
    );
  }

  const records = await searchRecordsCkan(portal.url, portal.apiStyle, datastore.resource.id);
  if (assertSearchRecords(lines, portal, datastore.resource.id, records)) {
    failed = true;
  }

  return { key, name: portal.name, failed, lines };
}

async function runPortalScenarioWorker(baseUrl, key, portal) {
  const lines = [];
  let failed = false;

  const search = await callWorkerTool(baseUrl, "search_datasets", {
    portal: key,
    keyword: portal.keyword,
    limit: SEARCH_LIMIT,
  });
  if (!search.ok) {
    lines.push(`  ✗ search_datasets  ${search.error} (${search.ms}ms)`);
    return { key, name: portal.name, failed: true, lines };
  }

  const count = search.data?.count ?? 0;
  const results = search.data?.results ?? [];
  if (count < portal.minCount || results.length === 0) {
    lines.push(
      `  ✗ search_datasets  keyword="${portal.keyword}" count=${count} (${search.ms}ms)`
    );
    return { key, name: portal.name, failed: true, lines };
  }

  lines.push(
    `  ✓ search_datasets  keyword="${portal.keyword}" count=${count} top: ${formatTitles(results)} (${search.ms}ms)`
  );

  const datasetId = resolveDatasetId(portal, results[0]);

  const detail = await callWorkerTool(baseUrl, "get_dataset", {
    portal: key,
    id: datasetId,
  });
  if (!detail.ok) {
    failed = true;
    lines.push(`  ✗ get_dataset(${datasetId})  ${detail.error} (${detail.ms}ms)`);
  } else {
    const title = detail.data?.title ?? detail.data?.name ?? datasetId;
    const nRes = detail.data?.resources?.length ?? 0;
    lines.push(
      `  ✓ get_dataset  id=${datasetId} title="${title}" resources=${nRes} (${detail.ms}ms)`
    );
  }

  const orgs = await callWorkerTool(baseUrl, "list_organizations", {
    portal: key,
    limit: ORG_LIMIT,
  });
  if (!orgs.ok) {
    if (!portal.expectOrganizations && isDatastoreUnavailableError(orgs.error ?? "")) {
      lines.push(
        `  ✓ list_organizations  not available on portal (expected) (${orgs.ms}ms)`
      );
    } else {
      failed = true;
      lines.push(`  ✗ list_organizations  ${orgs.error} (${orgs.ms}ms)`);
    }
  } else {
    const list = Array.isArray(orgs.data) ? orgs.data : [];
    const names = list
      .slice(0, 3)
      .map((o) => o.title || o.name)
      .join(" | ");
    lines.push(
      `  ✓ list_organizations  count=${list.length} top: ${names} (${orgs.ms}ms)`
    );
  }

  const fetchDataset = async (id) => {
    const r = await callWorkerTool(baseUrl, "get_dataset", { portal: key, id });
    return r.ok ? { ok: true, data: r.data } : { ok: false };
  };
  const datastore = await findDatastoreViaSearch(portal, fetchDataset, results);
  if (!datastore) {
    if (portal.expectDatastoreRecords) {
      failed = true;
      lines.push(
        `  ✗ search_records  no datastore_active resource in top ${SEARCH_LIMIT} hits`
      );
    } else {
      lines.push(`  − search_records  skipped (no datastore_active resource in hits)`);
    }
    return { key, name: portal.name, failed, lines };
  }

  if (datastore.datasetId !== datasetId) {
    lines.push(
      `  · search_records  using dataset=${datastore.datasetId} resource=${datastore.resource.id}`
    );
  }

  const records = await callWorkerTool(baseUrl, "search_records", {
    portal: key,
    resource_id: datastore.resource.id,
    limit: RECORD_LIMIT,
  });
  if (assertSearchRecords(lines, portal, datastore.resource.id, records)) {
    failed = true;
  }

  return { key, name: portal.name, failed, lines };
}

async function main() {
  const { worker, baseUrl } = parseArgs(process.argv.slice(2));
  const mode = worker ? `Worker (${baseUrl})` : "CKAN API (direct)";
  console.log(`ckan-mcp-worker search scenario — ${mode}\n`);

  let anyFailed = false;

  if (worker) {
    try {
      const health = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!health.ok) {
        console.error(`Worker unreachable: GET / returned HTTP ${health.status}`);
        console.error("Start with: npm run dev");
        process.exit(1);
      }
      const info = await health.json();
      console.log(`Worker: ${info.name} portals=${(info.portals ?? []).join(", ")}\n`);
    } catch (err) {
      console.error(`Worker unreachable at ${baseUrl}`);
      console.error(err instanceof Error ? err.message : String(err));
      console.error("\nStart with: npm run dev");
      process.exit(1);
    }
  }

  for (const [key, portal] of Object.entries(PORTALS)) {
    console.log(`${key} — ${portal.name}`);
    if (!worker) console.log(`  ${portal.url}`);

    const result = worker
      ? await runPortalScenarioWorker(baseUrl, key, portal)
      : await runPortalScenarioCkan(key, portal);

    for (const line of result.lines) console.log(line);
    if (result.failed) anyFailed = true;
    console.log();
  }

  if (anyFailed) {
    console.error("Some checks failed.");
    process.exit(1);
  }
  console.log("All search scenarios passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
