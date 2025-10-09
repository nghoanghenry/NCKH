import { useEffect, useState, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
} from "react-leaflet";
import L from "leaflet";
import proj4 from "proj4";
import "leaflet/dist/leaflet.css";

// --- Fix icon mặc định cho Marker ---
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// --- Hệ VN2000 (UTM Zone 48N) ---
const EPSG_32648 =
  "+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs";

// --- Chuyển sang WGS84 ---
const reprojectToWGS84 = (coord: [number, number]) =>
  proj4(EPSG_32648, "EPSG:4326", coord).reverse() as [number, number];

// --- Kiểu dữ liệu ---
interface PointData {
  position: [number, number];
  species: string;
  category: string;
}

// --- Component menu chọn nhóm & loài ---
const MapNavigator = ({
  groupedSpecies,
  selectedCategory,
  selectedSpecies,
  onCategorySelect,
  onSpeciesSelect,
}: {
  groupedSpecies: Record<string, string[]>;
  selectedCategory: string | null;
  selectedSpecies: string | null;
  onCategorySelect: (c: string) => void;
  onSpeciesSelect: (s: string) => void;
}) => {
  const colors = [
    "#4CAF50",
    "#2196F3",
    "#FF9800",
    "#9C27B0",
    "#E91E63",
    "#00BCD4",
    "#8BC34A",
    "#FF5722",
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        right: "20px",
        background: "white",
        borderRadius: "10px",
        padding: "10px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        zIndex: 1000,
        maxWidth: "260px",
      }}
    >
      <h4 style={{ marginBottom: "6px", fontSize: "14px" }}>Chọn nhóm loài:</h4>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
        }}
      >
        {Object.keys(groupedSpecies).map((cat, i) => (
          <button
            key={cat}
            onClick={() =>
              onCategorySelect(selectedCategory === cat ? "" : cat)
            }
            style={{
              background:
                selectedCategory === cat ? colors[i % colors.length] : "#ccc",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "5px 10px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {selectedCategory && (
        <div style={{ marginTop: "10px" }}>
          <h4 style={{ marginBottom: "6px", fontSize: "13px" }}>
            Loài ({selectedCategory}):
          </h4>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
          >
            {groupedSpecies[selectedCategory].map((s, i) => (
              <button
                key={i}
                onClick={() => onSpeciesSelect(s)}
                style={{
                  background:
                    selectedSpecies === s
                      ? colors[i % colors.length]
                      : "#ddd",
                  color: "black",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Component chính ---
export default function Map() {
  const [points, setPoints] = useState<PointData[]>([]);
  const [thucVatGeoJson, setThucVatGeoJson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);
  const mapRef = useRef<L.Map>(null!);

  // --- Load dữ liệu Động vật ---
  useEffect(() => {
    const loadAll = async () => {
      const files = [
        { file: "Dong_Vat_Chim.geojson", category: "Chim" },
        { file: "Dong_Vat_Chim_bosung.geojson", category: "Chim (bổ sung)" },
        { file: "Dong_Vat_Thu.geojson", category: "Thú" },
        { file: "Dong_Vat_Thu_bosung.geojson", category: "Thú (bổ sung)" },
        { file: "Dong_Vat_Bosat.geojson", category: "Bò sát" },
        { file: "Dong_Vat_Luongcu.geojson", category: "Lưỡng cư" },
        { file: "Dong_vat_ca.geojson", category: "Cá" },
      ];

      const allPoints: PointData[] = [];

      for (const { file, category } of files) {
        try {
          const response = await fetch(`/${file}`);
          const text = await response.text();
          if (text.startsWith("<")) continue;
          const data = JSON.parse(text);

          const converted = data.features.map((f: any) => {
            const coord = f.geometry.coordinates;
            let latlng: [number, number];
            // Nếu toạ độ quá lớn -> UTM (EPSG:32648)
            if (Math.abs(coord[0]) > 180) {
              latlng = reprojectToWGS84(coord);
            } else {
              latlng = coord.reverse() as [number, number];
            }

            return {
              category,
              species: f.properties.Species?.trim() || "Không rõ",
              position: latlng,
            };
          });

          allPoints.push(...converted);
        } catch (err) {
          console.warn("Không thể đọc file:", file, err);
        }
      }

      setPoints(allPoints);
      setLoading(false);
    };

    loadAll();
  }, []);

  // --- Load dữ liệu Thực vật ---
  useEffect(() => {
    fetch("/Thuc_vat.json")
      .then((r) => r.json())
      .then((geo) => {
        // Nếu dữ liệu có toạ độ dạng UTM thì convert
        const sample = geo.features[0]?.geometry?.coordinates?.[0]?.[0]?.[0];
        if (sample && Math.abs(sample[0]) > 180) {
          geo.features = geo.features.map((f: any) => {
            const geom = f.geometry;
            if (geom.type === "MultiPolygon") {
              geom.coordinates = geom.coordinates.map((poly: any) =>
                poly.map((ring: any) =>
                  ring.map((coord: [number, number]) =>
                    reprojectToWGS84(coord)
                  )
                )
              );
            }
            return f;
          });
        }
        setThucVatGeoJson(geo);
      });
  }, []);

  if (loading) return <div>Đang tải dữ liệu...</div>;

  // Gom nhóm loài theo category
  const groupedSpecies: Record<string, string[]> = {};
  for (const p of points) {
    if (!groupedSpecies[p.category]) groupedSpecies[p.category] = [];
    if (!groupedSpecies[p.category].includes(p.species))
      groupedSpecies[p.category].push(p.species);
  }

  // Lọc dữ liệu hiển thị
  const displayedPoints = selectedSpecies
    ? points.filter((p) => p.species === selectedSpecies)
    : selectedCategory
    ? points.filter((p) => p.category === selectedCategory)
    : points;

  const uminhBounds: L.LatLngBoundsExpression = [
    [8.9, 104.7],
    [9.5, 105.2],
  ];

  return (
    <div style={{ position: "relative", width: "100%", height: "600px" }}>
      <MapContainer
        ref={mapRef}
        center={[9.25, 104.95]}
        zoom={13}
        minZoom={12}
        maxZoom={16}
        maxBounds={uminhBounds}
        maxBoundsViscosity={1.0}
        worldCopyJump={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />

        {/* Các điểm động vật */}
        {displayedPoints.map((p, i) => (
          <Marker key={i} position={p.position}>
            <Popup>
              <b>Loài:</b> {p.species}
              <br />
              <b>Nhóm:</b> {p.category}
              <br />
              <b>Vĩ độ:</b> {p.position[0].toFixed(6)}
              <br />
              <b>Kinh độ:</b> {p.position[1].toFixed(6)}
            </Popup>
          </Marker>
        ))}

        {/* Layer Thực vật */}
        {thucVatGeoJson && (
          <GeoJSON
            data={thucVatGeoJson}
            style={() => ({
              color: "green",
              weight: 2,
              fillOpacity: 0.3,
            })}
            onEachFeature={(feature, layer) => {
              const props = feature.properties || {};
              layer.bindPopup(
                `<b>Thực vật:</b> ${
                  props.TVkethop || "Không rõ"
                }<br/><b>HST:</b> ${
                  props.HST || "Không rõ"
                }<br/><b>DT (ha):</b> ${props.DT_ha || 0}`
              );
            }}
          />
        )}

        <MapNavigator
          groupedSpecies={groupedSpecies}
          selectedCategory={selectedCategory}
          selectedSpecies={selectedSpecies}
          onCategorySelect={(c) =>
            setSelectedCategory(c === "" ? null : c)
          }
          onSpeciesSelect={(s) =>
            setSelectedSpecies(s === selectedSpecies ? null : s)
          }
        />
      </MapContainer>
    </div>
  );
}
