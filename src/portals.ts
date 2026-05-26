export const PORTALS = {
  sendai: {
    name: "仙台市オープンデータ",
    url: "https://data.city.sendai.jp",
  },
  geospatial: {
    name: "G空間情報センター",
    url: "https://www.geospatial.jp/ckan",
  },
  bodik: {
    name: "BODIK（全国自治体オープンデータ）",
    url: "https://data.bodik.jp",
  },
} as const;

export type PortalKey = keyof typeof PORTALS;
