export const TOOLS = [
  {
    name: "search_datasets",
    description: "CKANポータルでデータセットをキーワード検索する",
    inputSchema: {
      type: "object",
      properties: {
        portal: {
          type: "string",
          enum: ["sendai", "geospatial", "bodik", "shizuoka"],
          description: "対象ポータル",
        },
        keyword: {
          type: "string",
          description: "検索キーワード",
        },
        limit: {
          type: "number",
          default: 10,
          description: "取得件数",
        },
        offset: {
          type: "number",
          default: 0,
          description: "オフセット",
        },
      },
      required: ["portal", "keyword"],
    },
  },
  {
    name: "get_dataset",
    description: "データセットの詳細情報とリソース一覧を取得する",
    inputSchema: {
      type: "object",
      properties: {
        portal: {
          type: "string",
          enum: ["sendai", "geospatial", "bodik", "shizuoka"],
          description: "対象ポータル",
        },
        id: {
          type: "string",
          description: "データセットID",
        },
      },
      required: ["portal", "id"],
    },
  },
  {
    name: "search_records",
    description: "データセット内のレコードを検索・絞り込みする",
    inputSchema: {
      type: "object",
      properties: {
        portal: {
          type: "string",
          enum: ["sendai", "geospatial", "bodik", "shizuoka"],
          description: "対象ポータル",
        },
        resource_id: {
          type: "string",
          description: "リソースID",
        },
        query: {
          type: "string",
          description: "検索クエリ",
        },
        limit: {
          type: "number",
          default: 20,
          description: "取得件数",
        },
        filters: {
          type: "object",
          description: "フィールドによる絞り込み",
        },
      },
      required: ["portal", "resource_id"],
    },
  },
  {
    name: "list_organizations",
    description: "ポータルの組織一覧を取得する",
    inputSchema: {
      type: "object",
      properties: {
        portal: {
          type: "string",
          enum: ["sendai", "geospatial", "bodik", "shizuoka"],
          description: "対象ポータル",
        },
        limit: {
          type: "number",
          default: 20,
          description: "取得件数",
        },
      },
      required: ["portal"],
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];
