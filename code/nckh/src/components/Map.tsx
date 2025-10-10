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
  showEnvironment,
  onToggleEnvironment,
  onCategorySelect,
  onSpeciesSelect,
}: {
  groupedSpecies: Record<string, string[]>;
  selectedCategory: string | null;
  selectedSpecies: string | null;
  showEnvironment: boolean;
  onToggleEnvironment: () => void;
  onCategorySelect: (c: string) => void;
  onSpeciesSelect: (s: string) => void;
}) => {
  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        right: "20px",
        bottom: "20px",
        background: "#e9e7e7ff", // nền sáng tổng thể
        color: "#000000ff",
        borderRadius: "12px",
        padding: "14px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        zIndex: 1000,
        width: "280px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h3
        style={{
          fontSize: "15px",
          fontWeight: "bold",
          marginBottom: "10px",
          color: "#000",
        }}
      >
        Bộ chọn hiển thị
      </h3>

      {/* --- Toggle Môi trường --- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#555", // ✅ nền xám đậm hơn
          borderRadius: "8px",
          padding: "10px 12px", // ✅ padding lớn hơn xíu
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontSize: "14px",
            color: "#ffffff", // ✅ chữ trắng
            fontWeight: "500",
          }}
        >
          Môi trường (Thực vật)
        </span>
        <label style={{ position: "relative" }}>
          <input
            type="checkbox"
            checked={showEnvironment}
            onChange={onToggleEnvironment}
            style={{
              width: "40px",
              height: "20px",
              appearance: "none",
              backgroundColor: showEnvironment ? "#4CAF50" : "#999",
              borderRadius: "20px",
              position: "relative",
              outline: "none",
              cursor: "pointer",
              transition: "background-color 0.2s",
            }}
          />
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: showEnvironment ? "22px" : "2px",
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s",
            }}
          ></span>
        </label>
      </div>

      {/* --- Chọn nhóm loài --- */}
      <h4 style={{ marginBottom: "6px", fontSize: "14px", color: "#000" }}>Chọn nhóm loài:</h4>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          marginBottom: "10px",
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
                selectedCategory === cat ? "#dcdcdc" : "#ffffff",
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

      {/* --- Danh sách loài có thể cuộn --- */}
      {selectedCategory && (
        <div
          style={{
            flexGrow: 1,
            overflowY: "auto",
            paddingRight: "6px",
            borderTop: "1px solid #ccc",
            marginTop: "8px",
          }}
        >
          <h4
            style={{
              margin: "10px 0 8px 0",
              fontSize: "14px",
              color: "#000",
              position: "sticky",
              top: 0,
              background: "#e9e7e7ff",
              paddingBottom: "4px",
            }}
          >
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
                    selectedSpecies === s ? "#dcdcdc" : "#ffffff",
                  color: "#000",
                  border: "1px solid #aaa",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  cursor: "pointer",
                  fontSize: "12px",
                  flex: "1 1 45%",
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
  const [showEnvironment, setShowEnvironment] = useState<boolean>(false);
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

  const displayedPoints = selectedSpecies
    ? points.filter((p) => p.species === selectedSpecies)
    : selectedCategory
    ? points.filter((p) => p.category === selectedCategory)
    : [];

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
        {showEnvironment && thucVatGeoJson && (
          <GeoJSON
            data={thucVatGeoJson}
            style={() => ({
              color: "#00c853",
              weight: 2,
              fillOpacity: 0.25,
            })}
            onEachFeature={(feature, layer) => {
              const props = feature.properties || {};
              layer.bindPopup(
                `<b>Thực vật:</b> ${props.TVkethop || "Không rõ"}<br/>
                 <b>HST:</b> ${props.HST || "Không rõ"}<br/>
                 <b>DT (ha):</b> ${props.DT_ha || 0}`
              );
            }}
          />
        )}

        <MapNavigator
          groupedSpecies={groupedSpecies}
          selectedCategory={selectedCategory}
          selectedSpecies={selectedSpecies}
          showEnvironment={showEnvironment}
          onToggleEnvironment={() => setShowEnvironment(!showEnvironment)}
          onCategorySelect={(c) => setSelectedCategory(c === "" ? null : c)}
          onSpeciesSelect={(s) =>
            setSelectedSpecies(s === selectedSpecies ? null : s)
          }
        />
      </MapContainer>
    </div>
  );
}
