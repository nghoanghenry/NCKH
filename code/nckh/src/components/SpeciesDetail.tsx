import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { createSpeciesData, loadSpeciesData, featuredSpecies } from '../data/speciesData';
import type { SpeciesData } from '../data/speciesData';
import './SpeciesDetail.css';

export default function SpeciesDetail() {
  const { speciesId } = useParams<{ speciesId: string }>();
  const navigate = useNavigate();
  const [species, setSpecies] = useState<SpeciesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSpeciesData() {
      if (!speciesId) {
        setLoading(false);
        return;
      }

      // Kiểm tra xem có phải loài đặc biệt không
      if (featuredSpecies[speciesId]) {
        setSpecies(featuredSpecies[speciesId]);
        setLoading(false);
        return;
      }

      // Load từ database chung
      try {
        const allSpecies = await loadSpeciesData();
        if (allSpecies[speciesId]) {
          const speciesData = createSpeciesData({
            id: speciesId,
            ...allSpecies[speciesId]
          });
          setSpecies(speciesData);
        }
      } catch (error) {
        console.error('Error loading species:', error);
      }
      
      setLoading(false);
    }

    fetchSpeciesData();
  }, [speciesId]);

  if (loading) {
    return (
      <div className="species-detail-container">
        <div className="species-detail-loading">
          <h2>Đang tải thông tin loài...</h2>
        </div>
      </div>
    );
  }

  if (!species) {
    return (
      <div className="species-detail-container">
        <div className="species-detail-error">
          <h2>Không tìm thấy thông tin loài</h2>
          <button onClick={() => navigate('/')} className="back-button">
            ← Quay lại bản đồ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="species-detail-container">
      <div className="species-detail-header">
        <button onClick={() => navigate('/')} className="back-button">
          ← Quay lại bản đồ
        </button>
        <h1>{species.name}</h1>
        <p className="scientific-name">{species.scientificName}</p>
      </div>

      <div className="species-detail-content">
        <div className="species-image-container">
          <img src={species.image} alt={species.name} className="species-main-image" />
          {species.conservationStatus && (
            <div className="conservation-badge" data-status={species.conservationStatus.split(' ')[0]}>
              {species.conservationStatus}
            </div>
          )}
        </div>

        <div className="species-info-grid">
          <div className="info-card">
            <h3>📚 Phân loại</h3>
            <p><strong>Nhóm:</strong> {species.category}</p>
          </div>

          <div className="info-card">
            <h3>🏞️ Môi trường sống</h3>
            <p>{species.habitat}</p>
          </div>

          <div className="info-card">
            <h3>🍽️ Thức ăn</h3>
            <p>{species.diet}</p>
          </div>

          {species.distribution && (
            <div className="info-card">
              <h3>🌍 Phân bố</h3>
              <p>{species.distribution}</p>
            </div>
          )}
        </div>

        <div className="info-section">
          <h3>📖 Mô tả</h3>
          <p className="description">{species.description}</p>
        </div>

        {species.characteristics && species.characteristics.length > 0 && (
          <div className="info-section">
            <h3>✨ Đặc điểm nổi bật</h3>
            <ul className="characteristics-list">
              {species.characteristics.map((char, index) => (
                <li key={index}>{char}</li>
              ))}
            </ul>
          </div>
        )}

        {species.threats && species.threats.length > 0 && (
          <div className="info-section threats-section">
            <h3>⚠️ Các mối đe dọa</h3>
            <ul className="threats-list">
              {species.threats.map((threat, index) => (
                <li key={index}>{threat}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="info-section conservation-message">
          <h3>💚 Bảo tồn</h3>
          <p>
            {species.name} {species.conservationStatus && `được xếp vào danh sách ${species.conservationStatus}.`}
            {' '}Việc bảo vệ môi trường sống tự nhiên và chống săn bắt trái phép là rất quan trọng 
            để đảm bảo sự tồn tại của loài này cho các thế hệ tương lai.
          </p>
        </div>
      </div>
    </div>
  );
}
