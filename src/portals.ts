export type ApiStyle = "ckan" | "shirasagi";

export const PORTALS = {
  sendai: {
    name: "仙台市オープンデータ",
    url: "https://data.city.sendai.jp",
    apiStyle: "ckan",
  },
  geospatial: {
    name: "G空間情報センター",
    url: "https://www.geospatial.jp/ckan",
    apiStyle: "ckan",
  },
  bodik: {
    name: "BODIK（全国自治体オープンデータ）",
    url: "https://data.bodik.jp",
    apiStyle: "ckan",
  },
  shizuoka: {
    name: "静岡県オープンデータ",
    url: "https://opendata.pref.shizuoka.jp",
    /**
     * 標準CKANではなくCMS「シラサギ」独自API。
     * パスが `api/{action}`（`api/3/action/{action}` ではない）で、
     * organization_list / datastore_search は非対応（404）。
     * データセットIDは検索結果の `name`（タイトル文字列）ではなく `uuid` または `id` を使う。
     */
    apiStyle: "shirasagi",
  },
} as const satisfies Record<string, { name: string; url: string; apiStyle: ApiStyle }>;

export type PortalKey = keyof typeof PORTALS;
