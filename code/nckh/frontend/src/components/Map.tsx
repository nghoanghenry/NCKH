import { useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSON,
  LayerGroup,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from "react-leaflet";
import L from "leaflet";
import proj4 from "proj4";
import { QRCodeSVG } from "qrcode.react";
import "leaflet/dist/leaflet.css";
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
import {
  fetchSpeciesImages,
  fetchSpeciesGeoJson,
  fetchSpeciesPoints,
  resolveAssetUrl,
  type SpeciesImage,
  type SpeciesPoint,
} from "../lib/api";
import vn from "../i18n/vn";
import en from "../i18n/en";

type Language = "vn" | "en";

let defaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

const EPSG_32648 = "+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs";
const MAP_DEBUG = true;
const MAP_DEBUG_PREFIX = "[MapDebug]";
const POINT_DEDUPE_PRECISION = 6;

function mapDebugLog(message: string, payload?: unknown) {
  if (!MAP_DEBUG) return;
  if (payload === undefined) {
    console.log(MAP_DEBUG_PREFIX, message);
    return;
  }
  console.log(MAP_DEBUG_PREFIX, message, payload);
}

function mapDebugWarn(message: string, payload?: unknown) {
  if (!MAP_DEBUG) return;
  if (payload === undefined) {
    console.warn(MAP_DEBUG_PREFIX, message);
    return;
  }
  console.warn(MAP_DEBUG_PREFIX, message, payload);
}

const reprojectToWGS84LngLat = (coord: [number, number]) =>
  proj4(EPSG_32648, "EPSG:4326", coord) as [number, number];

const getFirstCoordinatePair = (
  coordinates: unknown,
): [number, number] | null => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return [coordinates[0], coordinates[1]];
  }

  return getFirstCoordinatePair(coordinates[0]);
};

const isLikelyUtmCoordinateSet = (coordinates: unknown) => {
  const pair = getFirstCoordinatePair(coordinates);
  if (!pair) return false;
  return Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90;
};

const transformCoordinatesToWGS84 = (coordinates: unknown): unknown => {
  if (!Array.isArray(coordinates)) return coordinates;

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return reprojectToWGS84LngLat([coordinates[0], coordinates[1]]);
  }

  return coordinates.map((item) => transformCoordinatesToWGS84(item));
};

const normalizeGeoJsonToWGS84 = (geoJson: any) => {
  if (!geoJson?.features || !Array.isArray(geoJson.features)) return geoJson;

  return {
    ...geoJson,
    features: geoJson.features.map((feature: any) => {
      if (!feature?.geometry?.coordinates) return feature;
      if (!isLikelyUtmCoordinateSet(feature.geometry.coordinates))
        return feature;

      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: transformCoordinatesToWGS84(
            feature.geometry.coordinates,
          ),
        },
      };
    }),
  };
};

const normalizeMarkerPosition = (
  lat: number,
  lon: number,
): [number, number] | null => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return [lat, lon];
  }

  const [normalizedLon, normalizedLat] = reprojectToWGS84LngLat([lon, lat]);
  if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLon)) {
    return null;
  }

  return [normalizedLat, normalizedLon];
};

interface PointData {
  id: number;
  markerId: number | null;
  slug: string;
  position: [number, number];
  species: string;
  scientificName: string;
  category: string;
  habitat: string;
  diet: string;
  description: string;
  image: string;
}

function buildMarkerKey(point: PointData, index: number) {
  if (point.markerId !== null) {
    return `${point.slug}-${point.markerId}`;
  }

  // Fallback for older API payloads that do not include markerId.
  return `${point.slug}-${point.id}-${index}`;
}

function findDuplicateValues(values: string[]) {
  const counts = new globalThis.Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function summarizePointMarkers(points: PointData[]) {
  return points.map((point, index) => ({
    markerKey: buildMarkerKey(point, index),
    slug: point.slug,
    markerId: point.markerId,
    lat: Number(point.position[0].toFixed(6)),
    lon: Number(point.position[1].toFixed(6)),
  }));
}

function buildPointPositionKey(point: PointData) {
  const lat = point.position[0].toFixed(POINT_DEDUPE_PRECISION);
  const lon = point.position[1].toFixed(POINT_DEDUPE_PRECISION);
  return `${point.slug}|${lat}|${lon}`;
}

function dedupePointsForDisplay(source: PointData[]) {
  const grouped = new globalThis.Map<string, PointData>();

  for (const point of source) {
    const key = buildPointPositionKey(point);
    if (!grouped.has(key)) {
      grouped.set(key, point);
    }
  }

  return [...grouped.values()];
}

function stripGeoJsonPointFeatures(geoJson: any) {
  if (!geoJson?.features || !Array.isArray(geoJson.features)) {
    return geoJson;
  }

  return {
    ...geoJson,
    features: geoJson.features.filter(
      (feature: any) => feature?.geometry?.type !== "Point",
    ),
  };
}

function summarizeGeoJsonPointFeatures(geoJson: any) {
  if (!geoJson?.features || !Array.isArray(geoJson.features)) {
    return [] as Array<{
      featureId: unknown;
      lat: number;
      lon: number;
    }>;
  }

  return geoJson.features
    .filter(
      (feature: any) =>
        feature?.geometry?.type === "Point" &&
        Array.isArray(feature?.geometry?.coordinates) &&
        feature.geometry.coordinates.length >= 2,
    )
    .map((feature: any) => {
      const lon = Number(feature.geometry.coordinates[0]);
      const lat = Number(feature.geometry.coordinates[1]);
      return {
        featureId: feature?.properties?.featureId ?? null,
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
      };
    })
    .filter(
      (item: { lat: number; lon: number }) =>
        Number.isFinite(item.lat) && Number.isFinite(item.lon),
    );
}

interface GroupedSpeciesItem {
  slug: string;
  name: string;
}

interface MapProps {
  language: Language;
}

function toPointData(item: SpeciesPoint): PointData | null {
  const position = normalizeMarkerPosition(item.lat, item.lon);
  if (!position) return null;

  const numericMarkerId = Number(item.markerId);
  const markerId = Number.isFinite(numericMarkerId) ? numericMarkerId : null;

  return {
    id: item.id,
    markerId,
    slug: item.slug,
    species: item.commonName,
    scientificName: item.scientificName || "Không rõ",
    category: item.category || "Khác",
    habitat: item.habitat || "Không rõ",
    diet: item.diet || "Không rõ",
    description: item.description || "Chưa có mô tả chi tiết.",
    image: item.imageUrl || "/images/default.jpg",
    position,
  };
}

const SpeciesInfoPanel = ({
  selectedPoint,
  images,
  activeImageIndex,
  onPrevImage,
  onNextImage,
  onSelectImage,
  language,
  isVisible,
  onToggleVisibility,
}: {
  selectedPoint: PointData | null;
  images: SpeciesImage[];
  activeImageIndex: number;
  onPrevImage: () => void;
  onNextImage: () => void;
  onSelectImage: (index: number) => void;
  language: Language;
  isVisible: boolean;
  onToggleVisibility: () => void;
}) => {
  if (!selectedPoint || !isVisible) return null;

  const dict = language === "en" ? en : vn;
  const t = dict.map;

  const galleryUrls =
    images.length > 0
      ? images.map((img) => resolveAssetUrl(img.url)).filter((url) => !!url)
      : [resolveAssetUrl(selectedPoint.image) || "/images/default.jpg"];

  const safeIndex =
    galleryUrls.length > 0
      ? ((activeImageIndex % galleryUrls.length) + galleryUrls.length) %
        galleryUrls.length
      : 0;
  const currentImage = galleryUrls[safeIndex] || "/images/default.jpg";

  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        bottom: "20px",
        background: "#f3f3f3",
        color: "#000",
        borderRadius: "12px",
        padding: "16px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        zIndex: 1000,
        width: "300px",
        overflowY: "auto",
        touchAction: "pan-y",
        pointerEvents: "auto",
      }}
    >
      <button
        onClick={onToggleVisibility}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          background: "none",
          border: "none",
          fontSize: "20px",
          cursor: "pointer",
          color: "#000",
        }}
      >
        x
      </button>

      <h3
        style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px" }}
      >
        {t.infoTitle}
      </h3>

      <img
        src={currentImage}
        alt={selectedPoint.species}
        style={{
          width: "100%",
          height: "180px",
          objectFit: "cover",
          borderRadius: "8px",
          marginBottom: "10px",
        }}
      />

      {galleryUrls.length > 1 && (
        <div style={{ marginBottom: "12px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <button
              type="button"
              onClick={onPrevImage}
              style={{
                border: "1px solid #9ca3af",
                background: "#fff",
                borderRadius: "6px",
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              ◀
            </button>
            <span style={{ fontSize: "12px", color: "#4b5563" }}>
              {t.photoGallery} ({safeIndex + 1}/{galleryUrls.length})
            </span>
            <button
              type="button"
              onClick={onNextImage}
              style={{
                border: "1px solid #9ca3af",
                background: "#fff",
                borderRadius: "6px",
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              ▶
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "6px",
            }}
          >
            {galleryUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => onSelectImage(index)}
                style={{
                  border:
                    index === safeIndex
                      ? "2px solid #2563eb"
                      : "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: 0,
                  cursor: "pointer",
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                <img
                  src={url}
                  alt={`${selectedPoint.species}-${index + 1}`}
                  style={{
                    width: "100%",
                    height: "48px",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <p>
        <b>{t.commonName}:</b> {selectedPoint.species}
      </p>
      <p>
        <b>{t.scientificName}:</b> {selectedPoint.scientificName || t.unknown}
      </p>
      <p>
        <b>{t.group}:</b> {selectedPoint.category}
      </p>
      <p>
        <b>{t.habitat}:</b> {selectedPoint.habitat || t.unknown}
      </p>
      <p>
        <b>{t.diet}:</b> {selectedPoint.diet || t.unknown}
      </p>
      <p>
        <b>{t.description}:</b> {selectedPoint.description || t.noDescription}
      </p>

      <div style={{ marginTop: "20px", textAlign: "center" }}>
        <p style={{ fontWeight: "bold", marginBottom: "10px" }}>{t.scanQr}</p>
        <div
          style={{
            background: "white",
            padding: "15px",
            borderRadius: "8px",
            display: "inline-block",
          }}
        >
          <QRCodeSVG
            value={`${window.location.origin}/species/${selectedPoint.slug}`}
            size={200}
            level="H"
            includeMargin={true}
          />
        </div>
        <p
          style={{
            fontSize: "12px",
            color: "#666",
            marginTop: "10px",
            fontStyle: "italic",
          }}
        >
          <a href={`/species/${selectedPoint.slug}`}>{t.openDetail}</a>
        </p>
      </div>
    </div>
  );
};

const MapNavigator = ({
  groupedSpecies,
  selectedCategory,
  selectedSpeciesSlug,
  language,
  showEnvironment,
  showKenh,
  showKiemke,
  showRung,
  tileLayer,
  onToggleEnvironment,
  onToggleKenh,
  onToggleKiemke,
  onToggleRung,
  onToggleTileLayer,
  onCategorySelect,
  onSpeciesSelect,
  isVisible,
  onToggleVisibility,
}: {
  groupedSpecies: Record<string, GroupedSpeciesItem[]>;
  selectedCategory: string | null;
  selectedSpeciesSlug: string | null;
  language: Language;
  showEnvironment: boolean;
  showKenh: boolean;
  showKiemke: boolean;
  showRung: boolean;
  tileLayer: "street" | "satellite";
  onToggleEnvironment: () => void;
  onToggleKenh: () => void;
  onToggleKiemke: () => void;
  onToggleRung: () => void;
  onToggleTileLayer: () => void;
  onCategorySelect: (c: string) => void;
  onSpeciesSelect: (slug: string) => void;
  isVisible: boolean;
  onToggleVisibility: () => void;
}) => {
  const dict = language === "en" ? en : vn;
  const t = dict.map;
  const navigatorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = navigatorRef.current;
    if (!element) return;

    // Keep wheel/click interactions inside the selector panel.
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
  }, []);

  const toggleSwitch = (checked: boolean) => ({
    width: "40px",
    height: "20px",
    WebkitAppearance: "none" as const,
    MozAppearance: "none" as const,
    backgroundColor: checked ? "#4CAF50" : "#999",
    borderRadius: "20px",
    position: "relative" as const,
    outline: "none",
    cursor: "pointer",
    transition: "background-color 0.2s",
  });

  return (
    <div
      ref={navigatorRef}
      style={{
        position: "absolute",
        top: "20px",
        right: "20px",
        bottom: "20px",
        background: "#e9e7e7",
        color: "#000",
        borderRadius: "12px",
        padding: "14px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        zIndex: 1000,
        width: "280px",
        display: isVisible ? "flex" : "none",
        flexDirection: "column",
        overflowY: "auto",
        touchAction: "pan-y",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>
          {t.filterTitle}
        </h3>
        <button
          onClick={onToggleVisibility}
          style={{
            background: "none",
            border: "none",
            fontSize: "20px",
            cursor: "pointer",
            color: "#000",
          }}
        >
          x
        </button>
      </div>

      {[
        {
          label: t.satelliteLayer,
          checked: tileLayer === "satellite",
          onToggle: onToggleTileLayer,
        },
        {
          label: t.environmentLayer,
          checked: showEnvironment,
          onToggle: onToggleEnvironment,
        },
        { label: t.channelLayer, checked: showKenh, onToggle: onToggleKenh },
        {
          label: t.inventoryLayer,
          checked: showKiemke,
          onToggle: onToggleKiemke,
        },
        { label: t.forestLayer, checked: showRung, onToggle: onToggleRung },
      ].map((layer, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#555",
            borderRadius: "8px",
            padding: "10px 12px",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontSize: "14px", color: "#fff", fontWeight: 500 }}>
            {layer.label}
          </span>
          <label style={{ position: "relative" }}>
            <input
              type="checkbox"
              checked={layer.checked}
              onChange={layer.onToggle}
              style={toggleSwitch(layer.checked)}
            />
            <span
              style={{
                position: "absolute",
                top: "40%",
                transform: "translateY(-50%)",
                left: layer.checked ? "26px" : "5px",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
              }}
            />
          </label>
        </div>
      ))}

      <h4 style={{ marginBottom: "6px", fontSize: "14px", color: "#000" }}>
        {t.selectCategory}
      </h4>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          marginBottom: "10px",
        }}
      >
        {Object.keys(groupedSpecies).map((cat) => (
          <button
            key={cat}
            onClick={() =>
              onCategorySelect(selectedCategory === cat ? "" : cat)
            }
            style={{
              background: selectedCategory === cat ? "#dcdcdc" : "#ffffff",
              color: "#000",
              border: "1px solid #aaa",
              borderRadius: "6px",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: "13px",
              flex: "1 1 45%",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {selectedCategory && groupedSpecies[selectedCategory] && (
        <div
          style={{
            borderTop: "1px solid #ccc",
            marginTop: "8px",
            paddingTop: "8px",
          }}
        >
          <h4
            style={{ margin: "10px 0 8px 0", fontSize: "14px", color: "#000" }}
          >
            {t.speciesOfCategory.replace("{category}", selectedCategory)}
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {groupedSpecies[selectedCategory].map((item) => (
              <button
                key={item.slug}
                onClick={() => onSpeciesSelect(item.slug)}
                style={{
                  background:
                    selectedSpeciesSlug === item.slug ? "#dcdcdc" : "#ffffff",
                  color: "#000",
                  border: "1px solid #aaa",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  cursor: "pointer",
                  fontSize: "12px",
                  flex: "1 1 45%",
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function Map({ language }: MapProps) {
  const dict = language === "en" ? en : vn;
  const t = dict.map;

  const [allPoints, setAllPoints] = useState<PointData[]>([]);
  const [points, setPoints] = useState<PointData[]>([]);
  const [selectedImages, setSelectedImages] = useState<SpeciesImage[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [thucVatGeoJson, setThucVatGeoJson] = useState<any>(null);
  const [kenhGeoJson, setKenhGeoJson] = useState<any>(null);
  const [kiemkeGeoJson, setKiemkeGeoJson] = useState<any>(null);
  const [rungGeoJson, setRungGeoJson] = useState<any>(null);
  const [speciesGeoJson, setSpeciesGeoJson] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSpeciesSlug, setSelectedSpeciesSlug] = useState<string | null>(
    null,
  );
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [showKenh, setShowKenh] = useState(false);
  const [showKiemke, setShowKiemke] = useState(false);
  const [showRung, setShowRung] = useState(false);
  const [showSpeciesPanel, setShowSpeciesPanel] = useState(true);
  const [tileLayer, setTileLayer] = useState<"street" | "satellite">("street");
  const [showNavigatorPanel, setShowNavigatorPanel] = useState(true);
  const [activeMarkerKey, setActiveMarkerKey] = useState<string | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<globalThis.Map<string, L.Marker>>(
    new globalThis.Map<string, L.Marker>(),
  );
  const filterRequestSeqRef = useRef(0);

  const clearMarkerTransientState = () => {
    setActiveMarkerKey(null);
    markerRefs.current.forEach((marker) => marker.closePopup());
    markerRefs.current.clear();
    mapRef.current?.closePopup();
  };

  const setupPopupTouchScroll = (popup: L.Popup) => {
    const popupElement = popup.getElement();
    if (!popupElement) return;

    const scrollContainer =
      (popupElement.querySelector(
        ".species-marker-popup",
      ) as HTMLElement | null) ||
      (popupElement.querySelector(
        ".leaflet-popup-content",
      ) as HTMLElement | null);

    if (!scrollContainer) return;

    scrollContainer.style.touchAction = "pan-y";
    scrollContainer.style.overscrollBehavior = "contain";
    scrollContainer.style.setProperty("-webkit-overflow-scrolling", "touch");

    if (scrollContainer.dataset.scrollBound === "1") return;

    scrollContainer.dataset.scrollBound = "1";
    const stopPropagation = (event: Event) => {
      event.stopPropagation();
    };

    scrollContainer.addEventListener("touchstart", stopPropagation, {
      passive: true,
    });
    scrollContainer.addEventListener("touchmove", stopPropagation, {
      passive: true,
    });
    scrollContainer.addEventListener("wheel", stopPropagation, {
      passive: true,
    });

    L.DomEvent.disableClickPropagation(scrollContainer);
    L.DomEvent.disableScrollPropagation(scrollContainer);
  };

  const selectedPoint = useMemo(() => {
    if (!selectedSpeciesSlug) return null;
    return allPoints.find((item) => item.slug === selectedSpeciesSlug) || null;
  }, [allPoints, selectedSpeciesSlug]);

  const groupedSpecies = useMemo(() => {
    const grouped: Record<string, GroupedSpeciesItem[]> = {};
    const seen = new Set<string>();

    for (const p of allPoints) {
      if (!grouped[p.category]) grouped[p.category] = [];
      const key = `${p.category}-${p.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      grouped[p.category].push({ slug: p.slug, name: p.species });
    }

    return grouped;
  }, [allPoints]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setShowSpeciesPanel(false);
        setShowNavigatorPanel(false);
      } else {
        setShowSpeciesPanel(true);
        setShowNavigatorPanel(true);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const loadInitialPoints = async () => {
      try {
        setLoading(true);
        filterRequestSeqRef.current += 1;
        const data = await fetchSpeciesPoints({ language });
        const mapped = data
          .map((item) => toPointData(item))
          .filter((item): item is PointData => item !== null);

        const markerSummary = summarizePointMarkers(mapped);
        mapDebugLog("initial points loaded", {
          language,
          apiRows: data.length,
          mappedRows: mapped.length,
          uniqueSpeciesSlugCount: new Set(mapped.map((item) => item.slug)).size,
          duplicateMarkerKeys: findDuplicateValues(
            markerSummary.map((item) => item.markerKey),
          ),
        });

        setAllPoints(mapped);
        // Keep map clean on first load; markers appear only after
        // selecting a specific species.
        setPoints([]);
      } catch (error) {
        console.error(error);
        setErrorText("load_error");
      } finally {
        setLoading(false);
      }
    };

    loadInitialPoints();
  }, [language]);

  useEffect(() => {
    if (loading) return;

    const requestSeq = filterRequestSeqRef.current + 1;
    filterRequestSeqRef.current = requestSeq;

    mapDebugLog("filter effect triggered", {
      requestSeq,
      selectedCategory,
      selectedSpeciesSlug,
      allPointsCount: allPoints.length,
      currentPointsCount: points.length,
    });

    if (!selectedSpeciesSlug && !selectedCategory) {
      clearMarkerTransientState();
      setPoints([]);
      mapDebugLog("no category/species selected -> clear visible markers");
      return;
    }

    if (selectedCategory && !selectedSpeciesSlug) {
      // Selecting a category should only update the species list panel.
      // Do not show marker coordinates until a species is selected.
      clearMarkerTransientState();
      setPoints([]);
      mapDebugLog("category selected without species -> skip points API");
      return;
    }

    const localFallbackRaw = allPoints.filter(
      (item) => item.slug === selectedSpeciesSlug,
    );
    const localFallback = dedupePointsForDisplay(localFallbackRaw);

    const localFallbackSummary = summarizePointMarkers(localFallback);
    mapDebugLog("local fallback points prepared", {
      requestSeq,
      selectedSpeciesSlug,
      localFallbackRawCount: localFallbackRaw.length,
      localFallbackDisplayCount: localFallback.length,
      localFallbackMarkers: localFallbackSummary,
      duplicateMarkerKeys: findDuplicateValues(
        localFallbackSummary.map((item) => item.markerKey),
      ),
      duplicatePositionKeys: findDuplicateValues(
        localFallbackRaw.map((item) => buildPointPositionKey(item)),
      ),
    });

    // Apply local filter immediately to avoid stale markers while waiting
    // for API response.
    setPoints(localFallback);

    let cancelled = false;
    const loadFilteredPoints = async () => {
      try {
        const data = await fetchSpeciesPoints(
          selectedSpeciesSlug
            ? { slug: selectedSpeciesSlug, language }
            : { language },
        );

        if (cancelled || requestSeq !== filterRequestSeqRef.current) return;
        const mappedRaw = data
          .map((item) => toPointData(item))
          .filter((item): item is PointData => item !== null);
        const mapped = dedupePointsForDisplay(mappedRaw);

        const mappedSummary = summarizePointMarkers(mapped);
        mapDebugLog("filtered points API response", {
          requestSeq,
          selectedSpeciesSlug,
          selectedCategory,
          apiRows: data.length,
          mappedRowsRaw: mappedRaw.length,
          mappedRowsDisplay: mapped.length,
          mappedMarkers: mappedSummary,
          duplicateMarkerKeys: findDuplicateValues(
            mappedSummary.map((item) => item.markerKey),
          ),
          duplicatePositionKeys: findDuplicateValues(
            mappedRaw.map((item) => buildPointPositionKey(item)),
          ),
          apiPreview: data.map((item) => ({
            id: item.id,
            slug: item.slug,
            markerId: item.markerId ?? null,
            lat: item.lat,
            lon: item.lon,
          })),
        });

        if (mapped.length === 1 && localFallback.length > 1) {
          mapDebugWarn(
            "API returned 1 marker but local fallback had multiple markers",
            {
              requestSeq,
              selectedSpeciesSlug,
              localFallbackCount: localFallback.length,
              mappedCount: mapped.length,
            },
          );
        }

        setPoints(mapped.length > 0 ? mapped : localFallback);
      } catch (error) {
        console.error("Cannot load filtered points", error);
        if (!cancelled && requestSeq === filterRequestSeqRef.current) {
          setPoints(localFallback);
        }
      }
    };

    loadFilteredPoints();

    return () => {
      cancelled = true;
    };
  }, [allPoints, language, loading, selectedCategory, selectedSpeciesSlug]);

  useEffect(() => {
    if (!selectedSpeciesSlug) {
      setSpeciesGeoJson(null);
      mapDebugLog("species geojson cleared because no species is selected");
      return;
    }

    const selected = allPoints.find(
      (item) => item.slug === selectedSpeciesSlug,
    );
    if (!selected) {
      setSpeciesGeoJson(null);
      mapDebugWarn("selected species slug not found in allPoints", {
        selectedSpeciesSlug,
      });
      return;
    }

    const loadGeoJson = async () => {
      try {
        const geo = await fetchSpeciesGeoJson(selected.id, language);
        const normalizedGeo = normalizeGeoJsonToWGS84(geo);
        const geoWithoutPointFeatures =
          stripGeoJsonPointFeatures(normalizedGeo);
        const features =
          normalizedGeo?.features && Array.isArray(normalizedGeo.features)
            ? normalizedGeo.features
            : [];
        const renderFeatures =
          geoWithoutPointFeatures?.features &&
          Array.isArray(geoWithoutPointFeatures.features)
            ? geoWithoutPointFeatures.features
            : [];

        const geometryBreakdown = features.reduce(
          (acc: Record<string, number>, feature: any) => {
            const geomType = String(feature?.geometry?.type || "Unknown");
            acc[geomType] = (acc[geomType] || 0) + 1;
            return acc;
          },
          {},
        );

        const pointFeatures = summarizeGeoJsonPointFeatures(normalizedGeo);
        mapDebugLog("species geojson loaded", {
          speciesId: selected.id,
          selectedSpeciesSlug,
          selectedSpeciesName: selected.species,
          featureCount: features.length,
          renderFeatureCount: renderFeatures.length,
          geometryBreakdown,
          pointFeatureCount: pointFeatures.length,
          pointFeatures,
        });

        if (pointFeatures.length > 0) {
          mapDebugWarn(
            "GeoJSON Point features are ignored in layer rendering to avoid duplicate marker visualization.",
            {
              selectedSpeciesSlug,
              pointFeatureCount: pointFeatures.length,
            },
          );
        }

        setSpeciesGeoJson(
          renderFeatures.length > 0 ? geoWithoutPointFeatures : null,
        );
      } catch (error) {
        console.error("Cannot load species geojson", error);
        setSpeciesGeoJson(null);
      }
    };

    loadGeoJson();
  }, [selectedSpeciesSlug, allPoints, language]);

  useEffect(() => {
    const selectedId = selectedPoint?.id;
    setActiveImageIndex(0);

    if (!selectedId) {
      setSelectedImages([]);
      return;
    }

    let cancelled = false;
    const loadImages = async () => {
      try {
        const images = await fetchSpeciesImages(selectedId);
        if (!cancelled) {
          setSelectedImages(images);
        }
      } catch (error) {
        console.error("Cannot load species images", error);
        if (!cancelled) {
          setSelectedImages([]);
        }
      }
    };

    loadImages();

    return () => {
      cancelled = true;
    };
  }, [selectedPoint?.id]);

  useEffect(() => {
    if (!activeMarkerKey) return;

    const marker = markerRefs.current.get(activeMarkerKey);
    if (!marker) return;

    marker.openPopup();
  }, [activeMarkerKey, points]);

  useEffect(() => {
    if (!selectedSpeciesSlug) return;

    const markerSummary = summarizePointMarkers(points);
    const pointFeatures = summarizeGeoJsonPointFeatures(speciesGeoJson);
    const duplicateMarkerKeys = findDuplicateValues(
      markerSummary.map((item) => item.markerKey),
    );

    mapDebugLog("render summary", {
      selectedSpeciesSlug,
      selectedCategory,
      pointsLayerMarkerCount: markerSummary.length,
      geoJsonPointFeatureCount: pointFeatures.length,
      potentialVisiblePointCount: markerSummary.length + pointFeatures.length,
      duplicateMarkerKeys,
      pointsLayerMarkers: markerSummary,
      geoJsonPointFeatures: pointFeatures,
    });

    if (markerSummary.length > 0 && pointFeatures.length > 0) {
      mapDebugWarn(
        "Potential double-point rendering detected (points layer + GeoJSON Point features)",
        {
          selectedSpeciesSlug,
          pointsLayerMarkerCount: markerSummary.length,
          geoJsonPointFeatureCount: pointFeatures.length,
        },
      );
    }
  }, [points, selectedCategory, selectedSpeciesSlug, speciesGeoJson]);

  useEffect(() => {
    const loadGeo = async (path: string, setter: (value: any) => void) => {
      try {
        const res = await fetch(path);
        const geo = await res.json();
        setter(normalizeGeoJsonToWGS84(geo));
      } catch (error) {
        console.error(`Không thể tải layer ${path}`, error);
      }
    };

    loadGeo("/Thuc_vat.json", setThucVatGeoJson);
    loadGeo("/kenh.json", setKenhGeoJson);
    loadGeo("/kiemke_rung.json", setKiemkeGeoJson);
    loadGeo("/rung.json", setRungGeoJson);
  }, []);

  const handlePrevImage = () => {
    setActiveImageIndex((prev) => prev - 1);
  };

  const handleNextImage = () => {
    setActiveImageIndex((prev) => prev + 1);
  };

  const selectSpeciesFromMarker = (point: PointData, markerKey: string) => {
    markerRefs.current.forEach((marker, key) => {
      if (key !== markerKey) {
        marker.closePopup();
      }
    });

    const matched = allPoints.find((item) => item.slug === point.slug);
    mapDebugLog("marker clicked", {
      markerKey,
      slug: point.slug,
      speciesName: point.species,
      markerId: point.markerId,
      markerPosition: point.position,
      matchedCategory: matched?.category || null,
    });
    setSelectedSpeciesSlug(point.slug);
    setSelectedCategory(matched?.category || point.category || null);
    setActiveMarkerKey(markerKey);
  };

  if (loading) return <div>{t.loading}</div>;
  if (errorText) return <div>{t.loadError}</div>;

  const uminhBounds: L.LatLngBoundsExpression = [
    [8.9, 104.7],
    [9.74, 105.4],
  ];
  const markerLayerKey = `${selectedSpeciesSlug || "__none"}|${selectedCategory || "__none"}|${language}`;

  return (
    <div
      className="map-outer-container"
      style={{ position: "relative", width: "100%", height: "600px" }}
    >
      <SpeciesInfoPanel
        selectedPoint={selectedPoint}
        images={selectedImages}
        activeImageIndex={activeImageIndex}
        onPrevImage={handlePrevImage}
        onNextImage={handleNextImage}
        onSelectImage={setActiveImageIndex}
        language={language}
        isVisible={showSpeciesPanel}
        onToggleVisibility={() => setShowSpeciesPanel(!showSpeciesPanel)}
      />

      {!showSpeciesPanel && selectedPoint && (
        <button
          onClick={() => setShowSpeciesPanel(true)}
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            background: "#4CAF50",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "10px 15px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
            zIndex: 999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {t.infoButton}
        </button>
      )}

      {!showNavigatorPanel && (
        <button
          onClick={() => setShowNavigatorPanel(true)}
          style={{
            position: "absolute",
            top: "20px",
            right: "20px",
            background: "#2196F3",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "10px 15px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
            zIndex: 999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {t.filterButton}
        </button>
      )}

      <button
        type="button"
        onClick={() =>
          setTileLayer(tileLayer === "street" ? "satellite" : "street")
        }
        style={{ display: "none" }}
      />

      <MapContainer
        ref={mapRef}
        center={[9.25, 104.95]}
        zoom={13}
        minZoom={10}
        maxZoom={16}
        maxBounds={uminhBounds}
        maxBoundsViscosity={1}
        style={{ width: "100%", height: "100%" }}
      >
        {tileLayer === "street" ? (
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap contributors"
          />
        ) : (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
          />
        )}

        {showEnvironment && thucVatGeoJson && (
          <GeoJSON
            data={thucVatGeoJson}
            style={{ color: "#00c853", weight: 2, fillOpacity: 0.25 }}
          />
        )}
        {showKenh && kenhGeoJson && (
          <GeoJSON data={kenhGeoJson} style={{ color: "#1565c0", weight: 2 }} />
        )}
        {showKiemke && kiemkeGeoJson && (
          <GeoJSON
            data={kiemkeGeoJson}
            style={{ color: "#f57f17", weight: 2, fillOpacity: 0.3 }}
          />
        )}
        {showRung && rungGeoJson && (
          <GeoJSON
            data={rungGeoJson}
            style={{ color: "#2e7d32", weight: 2, fillOpacity: 0.4 }}
          />
        )}

        {speciesGeoJson && (
          <GeoJSON
            data={speciesGeoJson}
            style={{ color: "#ff1744", weight: 2.5, fillOpacity: 0.15 }}
          />
        )}

        <LayerGroup key={markerLayerKey}>
          {points.map((p, index) => {
            const markerKey = buildMarkerKey(p, index);

            return (
              <Marker
                key={markerKey}
                ref={(instance) => {
                  if (instance) {
                    markerRefs.current.set(markerKey, instance);
                  } else {
                    markerRefs.current.delete(markerKey);
                  }
                }}
                position={p.position}
                eventHandlers={{
                  click: () => {
                    selectSpeciesFromMarker(p, markerKey);
                  },
                  popupopen: (event) => {
                    const popup = (event.target as L.Marker).getPopup();
                    if (popup) {
                      setupPopupTouchScroll(popup);
                    }
                  },
                }}
              >
                <Popup autoClose={false} closeOnClick={false}>
                  <div className="species-marker-popup">
                    <b>{t.popupSpecies}:</b> {p.species}
                    <br />
                    <b>{t.popupGroup}:</b> {p.category}
                    <br />
                    <b>{t.popupCoordinates}:</b> {p.position[0].toFixed(6)},{" "}
                    {p.position[1].toFixed(6)}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </LayerGroup>

        <MapNavigator
          groupedSpecies={groupedSpecies}
          selectedCategory={selectedCategory}
          selectedSpeciesSlug={selectedSpeciesSlug}
          language={language}
          showEnvironment={showEnvironment}
          showKenh={showKenh}
          showKiemke={showKiemke}
          showRung={showRung}
          tileLayer={tileLayer}
          onToggleEnvironment={() => setShowEnvironment(!showEnvironment)}
          onToggleKenh={() => setShowKenh(!showKenh)}
          onToggleKiemke={() => setShowKiemke(!showKiemke)}
          onToggleRung={() => setShowRung(!showRung)}
          onToggleTileLayer={() =>
            setTileLayer(tileLayer === "street" ? "satellite" : "street")
          }
          onCategorySelect={(c) => {
            clearMarkerTransientState();
            setPoints([]);
            setSelectedCategory(c === "" ? null : c);
            setSelectedSpeciesSlug(null);
            setSpeciesGeoJson(null);
          }}
          onSpeciesSelect={(slug) => {
            mapDebugLog("species selected from navigator", {
              slug,
              currentlySelected: selectedSpeciesSlug,
            });

            if (slug === selectedSpeciesSlug) {
              mapDebugLog("same species clicked again -> keep current points");
              return;
            }

            clearMarkerTransientState();
            setPoints([]);
            setSelectedSpeciesSlug(slug);

            const matched = allPoints.find((item) => item.slug === slug);
            if (matched) {
              setSelectedCategory(matched.category);
            }
          }}
          isVisible={showNavigatorPanel}
          onToggleVisibility={() => setShowNavigatorPanel(!showNavigatorPanel)}
        />
      </MapContainer>
    </div>
  );
}
