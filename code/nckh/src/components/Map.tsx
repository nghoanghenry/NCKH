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

function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .toLowerCase();
}


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

// --- Panel hiển thị thông tin loài ---
const SpeciesInfoPanel = ({
  selectedSpecies,
  selectedCategory,
  speciesInfo,
}: {
  selectedSpecies: string | null;
  selectedCategory: string | null;
  speciesInfo: Record<string, any>;
}) => {
  if (!selectedSpecies) return null;

  console.log("Selected Species:", selectedSpecies);
  console.log("Normalized name:", normalizeName(selectedSpecies));
  console.log("Species Info:", speciesInfo);
  
  const info = speciesInfo[normalizeName(selectedSpecies)] || {
    name: selectedSpecies,
    category: selectedCategory,
    description: "Chưa có thông tin chi tiết về loài này.",
    image: "/images/default.jpg",
  };

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
      }}
    >
      <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px" }}>
        Thông tin loài
      </h3>
      <img
        src={info.image}
        alt={info.name}
        style={{
          width: "100%",
          height: "180px",
          objectFit: "cover",
          borderRadius: "8px",
          marginBottom: "10px",
        }}
      />
      <p><b>Tên thường gọi:</b> {info.name}</p>
      <p><b>Tên khoa học:</b> {info.scientific || "Không rõ"}</p>
      <p><b>Nhóm:</b> {info.category || selectedCategory}</p>
      <p><b>Môi trường sống:</b> {info.habitat || "Không rõ"}</p>
      <p><b>Thức ăn:</b> {info.diet || "Không rõ"}</p>
      <p><b>Mô tả:</b> {info.description}</p>
      {selectedSpecies === "Tê tê" && (
        <img
          src="/assets/tete.jpg"
          alt="Tê tê"
          style={{
            width: "100%",
            height: "180px",
            objectFit: "contain",
            borderRadius: "8px",
            marginTop: "10px",
          }}
        />
      )}
    </div>
  );
};

// --- Component menu chọn nhóm & loài ---
const MapNavigator = ({
  groupedSpecies,
  selectedCategory,
  selectedSpecies,
  showEnvironment,
  showKenh,
  showKiemke,
  showRung,
  onToggleEnvironment,
  onToggleKenh,
  onToggleKiemke,
  onToggleRung,
  onCategorySelect,
  onSpeciesSelect,
}: {
  groupedSpecies: Record<string, string[]>;
  selectedCategory: string | null;
  selectedSpecies: string | null;
  showEnvironment: boolean;
  showKenh: boolean;
  showKiemke: boolean;
  showRung: boolean;
  onToggleEnvironment: () => void;
  onToggleKenh: () => void;
  onToggleKiemke: () => void;
  onToggleRung: () => void;
  onCategorySelect: (c: string) => void;
  onSpeciesSelect: (s: string) => void;
}) => {
  const toggleSwitch = (checked: boolean) => ({
    width: "40px",
    height: "20px",
    WebkitAppearance: "none" as any,
    MozAppearance: "none" as any,
    backgroundColor: checked ? "#4CAF50" : "#999",
    borderRadius: "20px",
    position: "relative" as const,
    outline: "none",
    cursor: "pointer",
    transition: "background-color 0.2s",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        right: "20px",
        bottom: "20px",
        background: "#e9e7e7ff",
        color: "#000000ff",
        borderRadius: "12px",
        padding: "14px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        zIndex: 1000,
        width: "280px",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <h3 style={{ fontSize: "15px", fontWeight: "bold", marginBottom: "10px" }}>
        Bộ chọn hiển thị
      </h3>

      {[ 
        { label: "Môi trường (Thực vật)", checked: showEnvironment, onToggle: onToggleEnvironment },
        { label: "Kênh", checked: showKenh, onToggle: onToggleKenh },
        { label: "Kiểm kê rừng", checked: showKiemke, onToggle: onToggleKiemke },
        { label: "Rừng", checked: showRung, onToggle: onToggleRung },
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
                top: "2px",
                left: layer.checked ? "22px" : "2px",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
              }}
            ></span>
          </label>
        </div>
      ))}

      <h4 style={{ marginBottom: "6px", fontSize: "14px", color: "#000" }}>
        Chọn nhóm loài:
      </h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
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

      {selectedCategory && (
        <div
          style={{
            borderTop: "1px solid #ccc",
            marginTop: "8px",
            paddingTop: "8px",
          }}
        >
          <h4 style={{ margin: "10px 0 8px 0", fontSize: "14px", color: "#000" }}>
            Loài ({selectedCategory}):
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {groupedSpecies[selectedCategory].map((s, i) => (
              <button
                key={i}
                onClick={() => onSpeciesSelect(s)}
                style={{
                  background: selectedSpecies === s ? "#dcdcdc" : "#ffffff",
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
  const [kenhGeoJson, setKenhGeoJson] = useState<any>(null);
  const [kiemkeGeoJson, setKiemkeGeoJson] = useState<any>(null);
  const [rungGeoJson, setRungGeoJson] = useState<any>(null);
  const [speciesInfo, setSpeciesInfo] = useState<Record<string, any>>({});

  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [showKenh, setShowKenh] = useState(false);
  const [showKiemke, setShowKiemke] = useState(false);
  const [showRung, setShowRung] = useState(false);

  const mapRef = useRef<L.Map>(null!);

  // --- Load thông tin chi tiết các loài ---
  useEffect(() => {
    const loadSpeciesInfo = async () => {
      try {
        const response = await fetch("/species_info_normalized.json");
        const data = await response.json();
        setSpeciesInfo(data);
      } catch (error) {
        console.error("Lỗi khi tải thông tin loài:", error);
      }
    };
    loadSpeciesInfo();
  }, []);

  // --- Load dữ liệu Động vật ---
  useEffect(() => {
    const loadAll = async () => {
      const files = [
        { file: "Dong_Vat_chim.geojson", category: "Chim" },
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
            const latlng =
              Math.abs(coord[0]) > 180
                ? reprojectToWGS84(coord)
                : (coord.reverse() as [number, number]);

            return {
              category,
              species: f.properties.Species?.trim() || "Không rõ",
              position: latlng,
            };
          });

          allPoints.push(...converted);
        } catch (err) {
          console.warn(`❌ Không thể đọc file: ${file}`, err);
        }
      }

      setPoints(allPoints);
      setLoading(false);
    };

    loadAll();
  }, []);

  // --- Load các GeoJSON ---
  useEffect(() => {
    const loadGeo = async (path: string, setter: any) => {
      const res = await fetch(path);
      const geo = await res.json();
      const sample = geo.features[0]?.geometry?.coordinates?.[0]?.[0]?.[0];
      if (sample && Math.abs(sample[0]) > 180) {
        geo.features = geo.features.map((f: any) => {
          const geom = f.geometry;
          if (geom.type === "MultiPolygon") {
            geom.coordinates = geom.coordinates.map((poly: any) =>
              poly.map((ring: any) =>
                ring.map((coord: [number, number]) => reprojectToWGS84(coord))
              )
            );
          }
          return f;
        });
      }
      setter(geo);
    };

    loadGeo("/Thuc_vat.json", setThucVatGeoJson);
    loadGeo("/kenh.json", setKenhGeoJson);
    loadGeo("/kiemke_rung.json", setKiemkeGeoJson);
    loadGeo("/rung.json", setRungGeoJson);
  }, []);

  // --- Load thông tin loài ---
  useEffect(() => {
    fetch("/normalize_species.json")
      .then((res) => res.json())
      .then((data) => setSpeciesInfo(data))
      .catch((err) => console.error("Không thể tải species_info.json", err));
  }, []);

  if (loading) return <div>Đang tải dữ liệu...</div>;

  // Gom nhóm loài theo category
  const groupedSpecies: Record<string, string[]> = {};
  for (const p of points) {
    if (!groupedSpecies[p.category]) groupedSpecies[p.category] = [];
    if (!groupedSpecies[p.category].includes(p.species))
      groupedSpecies[p.category].push(p.species);
  }

  const displayedPoints =
    selectedSpecies
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
      <SpeciesInfoPanel
        selectedSpecies={selectedSpecies}
        selectedCategory={selectedCategory}
        speciesInfo={speciesInfo}
      />

      <MapContainer
        ref={mapRef}
        center={[9.25, 104.95]}
        zoom={13}
        minZoom={12}
        maxZoom={16}
        maxBounds={uminhBounds}
        maxBoundsViscosity={1.0}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />

        {showEnvironment && thucVatGeoJson && (
          <GeoJSON data={thucVatGeoJson} style={{ color: "#00c853", weight: 2, fillOpacity: 0.25 }} />
        )}
        {showKenh && kenhGeoJson && (
          <GeoJSON data={kenhGeoJson} style={{ color: "#1565c0", weight: 2 }} />
        )}
        {showKiemke && kiemkeGeoJson && (
          <GeoJSON data={kiemkeGeoJson} style={{ color: "#f57f17", weight: 2, fillOpacity: 0.3 }} />
        )}
        {showRung && rungGeoJson && (
          <GeoJSON data={rungGeoJson} style={{ color: "#2e7d32", weight: 2, fillOpacity: 0.4 }} />
        )}

        {displayedPoints.map((p, i) => (
          <Marker key={i} position={p.position}>
            <Popup>
              <b>Loài:</b> {p.species}
              <br />
              <b>Nhóm:</b> {p.category}
            </Popup>
          </Marker>
        ))}

        <MapNavigator
          groupedSpecies={groupedSpecies}
          selectedCategory={selectedCategory}
          selectedSpecies={selectedSpecies}
          showEnvironment={showEnvironment}
          showKenh={showKenh}
          showKiemke={showKiemke}
          showRung={showRung}
          onToggleEnvironment={() => setShowEnvironment(!showEnvironment)}
          onToggleKenh={() => setShowKenh(!showKenh)}
          onToggleKiemke={() => setShowKiemke(!showKiemke)}
          onToggleRung={() => setShowRung(!showRung)}
          onCategorySelect={(c) => setSelectedCategory(c === "" ? null : c)}
          onSpeciesSelect={(s) =>
            setSelectedSpecies(s === selectedSpecies ? null : s)
          }
        />
      </MapContainer>
    </div>
  );
}
