import type { Context } from "hono";
import {
  getDataset,
  isCkanError,
  listOrganizations,
  searchDatasets,
  searchRecords,
} from "./ckan";
import { CACHE_TTL, withCache } from "./cache";
import type { Env } from "./env";
import { summarizeArgs } from "./logger";
import { PORTALS, type PortalKey } from "./portals";
import type { ToolName } from "./tools";

type McpContent = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolCallOutcome = {
  response: Response;
  tool: string;
  portal: string | null;
  keyword: string | null;
  argsJson: string;
  status: number;
  isError: boolean;
  cacheHit: boolean;
};

function mcpText(text: string, isError = false): McpContent {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function mcpJson(result: unknown, isError = false): McpContent {
  return mcpText(JSON.stringify(result, null, 2), isError);
}

type OutcomeMeta = Omit<ToolCallOutcome, "response" | "status">;

function jsonResponse(
  body: McpContent | { error: string },
  status: number,
  outcome: OutcomeMeta
): ToolCallOutcome {
  return {
    response: Response.json(body, { status }),
    status,
    ...outcome,
  };
}

function isPortalKey(value: unknown): value is PortalKey {
  return typeof value === "string" && value in PORTALS;
}

function getPortalBaseUrl(portal: PortalKey): string {
  return PORTALS[portal].url;
}

export async function handleToolCall(
  c: Context<{ Bindings: Env }>,
  body: { name?: string; arguments?: Record<string, unknown> }
): Promise<ToolCallOutcome> {
  const args = body.arguments ?? {};
  const { json: argsJson, keyword: argsKeyword } = summarizeArgs(args);
  const baseOutcome = {
    tool: typeof body.name === "string" ? body.name : "unknown",
    portal: typeof args.portal === "string" ? args.portal : null,
    keyword: argsKeyword,
    argsJson,
    cacheHit: false,
  };

  const { name } = body;

  if (!name || typeof name !== "string") {
    return jsonResponse(mcpJson("Tool name is required", true), 400, {
      ...baseOutcome,
      isError: true,
    });
  }

  const portal = args.portal;
  if (!isPortalKey(portal)) {
    return jsonResponse(
      mcpJson(
        `Invalid portal. Must be one of: ${Object.keys(PORTALS).join(", ")}`,
        true
      ),
      400,
      { ...baseOutcome, tool: name, isError: true }
    );
  }

  const baseUrl = getPortalBaseUrl(portal);

  try {
    switch (name as ToolName) {
      case "search_datasets": {
        const keyword = args.keyword;
        if (typeof keyword !== "string" || keyword.length === 0) {
          return jsonResponse(mcpJson("keyword is required", true), 400, {
            ...baseOutcome,
            tool: name,
            portal,
            isError: true,
          });
        }

        const limit = typeof args.limit === "number" ? args.limit : 10;
        const offset = typeof args.offset === "number" ? args.offset : 0;
        const cacheKey = `search_datasets:${portal}:${keyword}:${limit}:${offset}`;

        const { value: result, cacheHit } = await withCache(
          c.env.CACHE_KV,
          cacheKey,
          CACHE_TTL.DATASET_SEARCH,
          () => searchDatasets(baseUrl, keyword, limit, offset)
        );

        if (isCkanError(result)) {
          return jsonResponse(mcpJson(result.error, true), 200, {
            ...baseOutcome,
            tool: name,
            portal,
            keyword,
            isError: true,
            cacheHit,
          });
        }

        return jsonResponse(mcpJson(result), 200, {
          ...baseOutcome,
          tool: name,
          portal,
          keyword,
          isError: false,
          cacheHit,
        });
      }

      case "get_dataset": {
        const id = args.id;
        if (typeof id !== "string" || id.length === 0) {
          return jsonResponse(mcpJson("id is required", true), 400, {
            ...baseOutcome,
            tool: name,
            portal,
            isError: true,
          });
        }

        const cacheKey = `get_dataset:${portal}:${id}`;
        const { value: result, cacheHit } = await withCache(
          c.env.CACHE_KV,
          cacheKey,
          CACHE_TTL.DATASET_DETAIL,
          () => getDataset(baseUrl, id)
        );

        if (isCkanError(result)) {
          return jsonResponse(mcpJson(result.error, true), 200, {
            ...baseOutcome,
            tool: name,
            portal,
            isError: true,
            cacheHit,
          });
        }

        return jsonResponse(mcpJson(result), 200, {
          ...baseOutcome,
          tool: name,
          portal,
          isError: false,
          cacheHit,
        });
      }

      case "search_records": {
        const resourceId = args.resource_id;
        if (typeof resourceId !== "string" || resourceId.length === 0) {
          return jsonResponse(mcpJson("resource_id is required", true), 400, {
            ...baseOutcome,
            tool: name,
            portal,
            isError: true,
          });
        }

        const query = typeof args.query === "string" ? args.query : undefined;
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const offset = typeof args.offset === "number" ? args.offset : 0;
        const filters =
          args.filters &&
          typeof args.filters === "object" &&
          !Array.isArray(args.filters)
            ? (args.filters as Record<string, unknown>)
            : undefined;

        const cacheKey = `search_records:${portal}:${resourceId}:${query ?? ""}:${limit}:${offset}:${JSON.stringify(filters ?? {})}`;

        const { value: result, cacheHit } = await withCache(
          c.env.CACHE_KV,
          cacheKey,
          CACHE_TTL.RECORD_SEARCH,
          () =>
            searchRecords(
              baseUrl,
              resourceId,
              query,
              limit,
              offset,
              filters
            )
        );

        if (isCkanError(result)) {
          return jsonResponse(mcpJson(result.error, true), 200, {
            ...baseOutcome,
            tool: name,
            portal,
            isError: true,
            cacheHit,
          });
        }

        return jsonResponse(mcpJson(result), 200, {
          ...baseOutcome,
          tool: name,
          portal,
          isError: false,
          cacheHit,
        });
      }

      case "list_organizations": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const cacheKey = `list_organizations:${portal}:${limit}`;

        const { value: result, cacheHit } = await withCache(
          c.env.CACHE_KV,
          cacheKey,
          CACHE_TTL.ORGANIZATIONS,
          () => listOrganizations(baseUrl, limit)
        );

        if (isCkanError(result)) {
          return jsonResponse(mcpJson(result.error, true), 200, {
            ...baseOutcome,
            tool: name,
            portal,
            isError: true,
            cacheHit,
          });
        }

        return jsonResponse(mcpJson(result), 200, {
          ...baseOutcome,
          tool: name,
          portal,
          isError: false,
          cacheHit,
        });
      }

      default:
        return jsonResponse(mcpJson(`Unknown tool: ${name}`, true), 400, {
          ...baseOutcome,
          tool: name,
          isError: true,
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(mcpJson(message, true), 500, {
      ...baseOutcome,
      tool: name,
      portal,
      isError: true,
    });
  }
}
