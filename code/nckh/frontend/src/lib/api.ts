const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

type Language = "vn" | "en" | "vi";

function toApiLang(language?: Language) {
  if (language === "en") return "en";
  return "vi";
}

function toUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function resolveAssetUrl(assetPath: string | null | undefined) {
  if (!assetPath) return "";
  if (/^(https?:)?\/\//i.test(assetPath) || assetPath.startsWith("data:") || assetPath.startsWith("blob:")) {
    return assetPath;
  }
  return toUrl(assetPath);
}

export interface SpeciesPoint {
  id: number;
  slug: string;
  markerId?: number;
  commonName: string;
  commonNameVi?: string | null;
  commonNameEn?: string | null;
  scientificName: string | null;
  category: string | null;
  habitat: string | null;
  habitatVi?: string | null;
  habitatEn?: string | null;
  diet: string | null;
  dietVi?: string | null;
  dietEn?: string | null;
  description: string | null;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  imageUrl: string | null;
  lat: number;
  lon: number;
}

export interface SpeciesImage {
  id: number;
  fileName: string;
  url: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
  createdAt: string;
}

export interface SpeciesDetail {
  id: number;
  slug: string;
  commonName: string;
  commonNameVi?: string | null;
  commonNameEn?: string | null;
  scientificName: string | null;
  category: string | null;
  habitat: string | null;
  habitatVi?: string | null;
  habitatEn?: string | null;
  diet: string | null;
  dietVi?: string | null;
  dietEn?: string | null;
  description: string | null;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  imageUrl: string | null;
  conservationStatus: string | null;
  conservationStatusVi?: string | null;
  conservationStatusEn?: string | null;
  distribution: string | null;
  distributionVi?: string | null;
  distributionEn?: string | null;
  images: SpeciesImage[];
  characteristics: string[];
  threats: string[];
}

export async function fetchSpeciesPoints(
  params: { category?: string; slug?: string; language?: Language } = {},
): Promise<SpeciesPoint[]> {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.slug) query.set("slug", params.slug);
  query.set("lang", toApiLang(params.language));
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await fetch(toUrl(`/api/species/points${suffix}`));
  if (!response.ok) {
    throw new Error("Cannot fetch species points");
  }
  const payload = await response.json();
  return payload.data || [];
}

export async function fetchSpeciesBySlug(
  slug: string,
  language?: Language,
): Promise<SpeciesDetail | null> {
  const query = new URLSearchParams();
  query.set("lang", toApiLang(language));
  const suffix = `?${query.toString()}`;
  const response = await fetch(
    toUrl(`/api/species/slug/${encodeURIComponent(slug)}${suffix}`),
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Cannot fetch species by slug");
  }
  const payload = await response.json();
  return payload.data || null;
}

export async function fetchSpeciesGeoJson(speciesId: number, language?: Language) {
  const query = new URLSearchParams();
  query.set("lang", toApiLang(language));
  const response = await fetch(
    toUrl(`/api/species/${speciesId}/geojson?${query.toString()}`),
  );
  if (!response.ok) {
    throw new Error("Cannot fetch species geojson");
  }
  return response.json();
}

export async function fetchSpeciesImages(speciesId: number): Promise<SpeciesImage[]> {
  const response = await fetch(toUrl(`/api/species/${speciesId}/images`));
  if (!response.ok) {
    throw new Error("Cannot fetch species images");
  }

  const payload = await response.json();
  return payload.data || [];
}
