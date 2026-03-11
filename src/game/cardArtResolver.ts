import type { CardArtReference } from "./types";

export type CardArtSize = "thumb" | "medium" | "full";

const FALLBACK_ART_URL = "/card-art/fallback.svg";

export const getFallbackCardArtUrl = (): string => FALLBACK_ART_URL;

export const getCardArtUrl = (assetId: string, size: CardArtSize = "medium"): string => {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) return FALLBACK_ART_URL;
  return `/card-art/${normalizedAssetId}/${size}.png`;
};

export const resolveCardArtUrl = (art?: CardArtReference, size: CardArtSize = "medium"): string => {
  if (!art?.assetId) return FALLBACK_ART_URL;
  return getCardArtUrl(art.assetId, size);
};
