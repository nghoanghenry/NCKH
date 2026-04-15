import { getAdminToken, saveAdminSession } from "./adminAuth";

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

export function resolveAdminAssetUrl(assetPath: string | null | undefined) {
  if (!assetPath) return "";
  if (/^(https?:)?\/\//i.test(assetPath) || assetPath.startsWith("data:") || assetPath.startsWith("blob:")) {
    return assetPath;
  }
  return toUrl(assetPath);
}

async function request(path: string, options: RequestInit = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(toUrl(path), {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export interface SpeciesAdminPayload {
  slug?: string;
  commonName?: string;
  commonNameVi?: string;
  commonNameEn?: string;
  scientificName?: string;
  category?: string;
  habitat?: string;
  habitatVi?: string;
  habitatEn?: string;
  diet?: string;
  dietVi?: string;
  dietEn?: string;
  description?: string;
  descriptionVi?: string;
  descriptionEn?: string;
  imageUrl?: string;
  conservationStatus?: string;
  conservationStatusVi?: string;
  conservationStatusEn?: string;
  distribution?: string;
  distributionVi?: string;
  distributionEn?: string;
  sourceGroup?: string;
}

export interface SpeciesImageItem {
  id: number;
  fileName: string;
  url: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
}

export interface AdminSpeciesCoordinateItem {
  coordinateId: number;
  featureId: number;
  geomType: string;
  partIndex: number;
  ringIndex: number;
  pointOrder: number;
  lon: number;
  lat: number;
}

export interface AdminSpeciesFeatureSummaryItem {
  featureId: number;
  geomType: string;
  pointCount: number;
  centroidLon: number | null;
  centroidLat: number | null;
  properties: Record<string, unknown>;
}

export interface AdminSpeciesFeaturePayload {
  geomType: string;
  properties?: Record<string, unknown>;
}

export interface AdminSpeciesCoordinatePayload {
  featureId: number;
  partIndex?: number;
  ringIndex?: number;
  pointOrder: number;
  lon: number;
  lat: number;
}

export interface AdminSpeciesCoordinateUpdatePayload {
  featureId?: number;
  partIndex?: number;
  ringIndex?: number;
  pointOrder?: number;
  lon?: number;
  lat?: number;
}

export interface AdminSpeciesPositionsPayload {
  species: {
    id: number;
    slug: string;
    commonName: string;
    commonNameVi?: string | null;
    commonNameEn?: string | null;
  };
  featureSummary: AdminSpeciesFeatureSummaryItem[];
  coordinates: AdminSpeciesCoordinateItem[];
}

export interface AdminSpeciesPositionsMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface AdminCategoryItem {
  id: number;
  name: string;
  nameVi?: string | null;
  nameEn?: string | null;
  speciesCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminCategoryPayload {
  name?: string;
  nameVi?: string;
  nameEn?: string;
}

export interface AdminUserItem {
  id: number;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  role: "ADMIN" | "CONTRIBUTOR" | "USER";
  createdAt: string;
  updatedAt: string;
}

export interface AdminCreateUserPayload {
  email: string;
  password: string;
  fullName?: string;
  role?: "ADMIN" | "CONTRIBUTOR" | "USER";
}

export async function adminLogin(email: string, password: string) {
  const payload = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  const role = payload?.user?.role;
  if (!payload?.user?.isAdmin && role !== "ADMIN" && role !== "CONTRIBUTOR") {
    throw new Error("Tài khoản không có quyền quản trị");
  }

  saveAdminSession(payload.token, payload.user);
  return payload;
}

export async function getAdminSpecies(params: { search?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return request(`/api/admin/species${suffix}`);
}

export async function getAdminCategories() {
  return request("/api/admin/categories") as Promise<{ data: AdminCategoryItem[] }>;
}

export async function createAdminCategory(payload: AdminCategoryPayload) {
  return request("/api/admin/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ data: AdminCategoryItem }>;
}

export async function updateAdminCategory(id: number, payload: AdminCategoryPayload) {
  return request(`/api/admin/categories/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }) as Promise<{ data: AdminCategoryItem }>;
}

export async function deleteAdminCategory(id: number) {
  return request(`/api/admin/categories/${id}`, {
    method: "DELETE",
  });
}

export async function getAdminSpeciesDetail(id: number, language?: Language) {
  const query = new URLSearchParams();
  query.set("lang", toApiLang(language));
  return request(`/api/admin/species/${id}?${query.toString()}`);
}

export async function getAdminSpeciesGeoJson(speciesId: number, language?: Language) {
  const query = new URLSearchParams();
  query.set("lang", toApiLang(language));
  return request(`/api/admin/species/${speciesId}/geojson?${query.toString()}`);
}

export async function getAdminSpeciesPositions(
  speciesId: number,
  language?: Language,
  params: { limit?: number; offset?: number } = {},
): Promise<{ data: AdminSpeciesPositionsPayload; meta: AdminSpeciesPositionsMeta }> {
  const query = new URLSearchParams();
  query.set("lang", toApiLang(language));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return request(`/api/admin/species/${speciesId}/positions?${query.toString()}`);
}

export async function createAdminSpeciesFeature(
  speciesId: number,
  payload: AdminSpeciesFeaturePayload,
) {
  return request(`/api/admin/species/${speciesId}/features`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAdminSpeciesFeature(
  speciesId: number,
  featureId: number,
  payload: AdminSpeciesFeaturePayload,
) {
  return request(`/api/admin/species/${speciesId}/features/${featureId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminSpeciesFeature(speciesId: number, featureId: number) {
  return request(`/api/admin/species/${speciesId}/features/${featureId}`, {
    method: "DELETE",
  });
}

export async function createAdminSpeciesCoordinate(
  speciesId: number,
  payload: AdminSpeciesCoordinatePayload,
) {
  return request(`/api/admin/species/${speciesId}/coordinates`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAdminSpeciesCoordinate(
  speciesId: number,
  coordinateId: number,
  payload: AdminSpeciesCoordinateUpdatePayload,
) {
  return request(`/api/admin/species/${speciesId}/coordinates/${coordinateId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminSpeciesCoordinate(speciesId: number, coordinateId: number) {
  return request(`/api/admin/species/${speciesId}/coordinates/${coordinateId}`, {
    method: "DELETE",
  });
}

export async function createAdminSpecies(payload: SpeciesAdminPayload) {
  return request("/api/admin/species", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAdminSpecies(id: number, payload: Partial<SpeciesAdminPayload>) {
  return request(`/api/admin/species/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminSpecies(id: number) {
  return request(`/api/admin/species/${id}`, {
    method: "DELETE",
  });
}

export async function getSpeciesImages(speciesId: number): Promise<{ data: SpeciesImageItem[] }> {
  return request(`/api/admin/species/${speciesId}/images`);
}

export async function uploadSpeciesImages(speciesId: number, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("images", file);
  });

  return request(`/api/admin/species/${speciesId}/images`, {
    method: "POST",
    body: formData,
  });
}

export async function deleteSpeciesImage(speciesId: number, imageId: number) {
  return request(`/api/admin/species/${speciesId}/images/${imageId}`, {
    method: "DELETE",
  });
}

export async function setPrimarySpeciesImage(speciesId: number, imageId: number) {
  return request(`/api/admin/species/${speciesId}/images/${imageId}/primary`, {
    method: "PATCH",
  });
}

export async function uploadSpeciesGeoJson(
  speciesId: number,
  geojson: unknown,
  replaceExisting = true,
) {
  return request(`/api/admin/species/${speciesId}/geojson`, {
    method: "POST",
    body: JSON.stringify({ geojson, replaceExisting }),
  });
}

export async function getAdminUsers(params: { search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/admin/users${suffix}`) as Promise<{ data: AdminUserItem[] }>;
}

export async function createAdminUser(payload: AdminCreateUserPayload) {
  return request("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ data: AdminUserItem }>;
}

export async function deleteAdminUser(id: number) {
  return request(`/api/admin/users/${id}`, {
    method: "DELETE",
  });
}
