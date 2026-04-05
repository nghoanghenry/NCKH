import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchSpeciesBySlug, resolveAssetUrl } from "../lib/api";
import vn from "../i18n/vn";
import en from "../i18n/en";
import "./SpeciesDetail.css";

type Language = "vn" | "en";

interface SpeciesDetailProps {
  language: Language;
  onLanguageChange: (language: Language) => void;
}

interface SpeciesImageModel {
  id: number;
  fileName: string;
  url: string;
}

interface SpeciesDetailModel {
  id: number;
  slug: string;
  commonName: string;
  scientificName: string | null;
  category: string | null;
  habitat: string | null;
  diet: string | null;
  description: string | null;
  imageUrl: string | null;
  conservationStatus: string | null;
  distribution: string | null;
  images: SpeciesImageModel[];
  characteristics: string[];
  threats: string[];
}

function mapApiToViewModel(input: any): SpeciesDetailModel {
  return {
    id: input.id,
    slug: input.slug,
    commonName: input.commonName,
    scientificName: input.scientificName,
    category: input.category,
    habitat: input.habitat,
    diet: input.diet,
    description: input.description,
    imageUrl: input.imageUrl,
    conservationStatus: input.conservationStatus,
    distribution: input.distribution,
    images: Array.isArray(input.images)
      ? input.images.map((img: any) => ({
          id: Number(img.id),
          fileName: String(img.fileName || ""),
          url: String(img.url || ""),
        }))
      : [],
    characteristics: Array.isArray(input.characteristics)
      ? input.characteristics
      : [],
    threats: Array.isArray(input.threats) ? input.threats : [],
  };
}

export default function SpeciesDetail({
  language,
  onLanguageChange,
}: SpeciesDetailProps) {
  const { speciesId } = useParams<{ speciesId: string }>();
  const navigate = useNavigate();
  const [species, setSpecies] = useState<SpeciesDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const dict = language === "en" ? en : vn;
  const t = dict.speciesDetail;

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      if (!speciesId) {
        setLoading(false);
        return;
      }

      try {
        const data = await fetchSpeciesBySlug(speciesId, language);
        setSpecies(data ? mapApiToViewModel(data) : null);
        setActiveImageIndex(0);
      } catch (error) {
        console.error("Cannot load species detail", error);
        setSpecies(null);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [speciesId, language]);

  if (loading) {
    return (
      <div className="species-detail-container">
        <div className="species-detail-loading">
          <h2>{t.loading}</h2>
        </div>
      </div>
    );
  }

  if (!species) {
    return (
      <div className="species-detail-container">
        <div className="species-detail-error">
          <h2>{t.notFound}</h2>
          <button onClick={() => navigate("/")} className="back-button">
            {t.backToMap}
          </button>
        </div>
      </div>
    );
  }

  const galleryUrls =
    species.images.length > 0
      ? species.images
          .map((img) => resolveAssetUrl(img.url))
          .filter((url) => !!url)
      : [resolveAssetUrl(species.imageUrl) || "/images/default.jpg"];

  const safeIndex =
    galleryUrls.length > 0
      ? ((activeImageIndex % galleryUrls.length) + galleryUrls.length) %
        galleryUrls.length
      : 0;
  const currentImage = galleryUrls[safeIndex] || "/images/default.jpg";

  return (
    <div className="species-detail-container">
      <div className="species-detail-header">
        <button onClick={() => navigate("/")} className="back-button">
          {t.backToMap}
        </button>
        <div className="detail-language-switch">
          <span>{t.languageLabel}:</span>
          <button
            type="button"
            className={language === "vn" ? "active" : ""}
            onClick={() => onLanguageChange("vn")}
          >
            VI
          </button>
          <button
            type="button"
            className={language === "en" ? "active" : ""}
            onClick={() => onLanguageChange("en")}
          >
            EN
          </button>
        </div>
        <h1>{species.commonName}</h1>
        <p className="scientific-name">
          {species.scientificName || t.unknownScientific}
        </p>
      </div>

      <div className="species-detail-content">
        <div className="species-image-container">
          <img
            src={currentImage}
            alt={species.commonName}
            className="species-main-image"
          />
          {species.conservationStatus && (
            <div
              className="conservation-badge"
              data-status={species.conservationStatus.split(" ")[0]}
            >
              {species.conservationStatus}
            </div>
          )}

          {galleryUrls.length > 1 && (
            <div className="detail-image-controls">
              <button
                type="button"
                className="detail-image-nav"
                onClick={() => setActiveImageIndex((v) => v - 1)}
              >
                ◀ {t.previousImage}
              </button>
              <span>
                {t.imageCounter
                  .replace("{current}", String(safeIndex + 1))
                  .replace("{total}", String(galleryUrls.length))}
              </span>
              <button
                type="button"
                className="detail-image-nav"
                onClick={() => setActiveImageIndex((v) => v + 1)}
              >
                {t.nextImage} ▶
              </button>
            </div>
          )}

          <div className="species-thumbnail-grid">
            {galleryUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                className={`species-thumb-button ${index === safeIndex ? "active" : ""}`}
                onClick={() => setActiveImageIndex(index)}
              >
                <img src={url} alt={`${species.commonName}-${index + 1}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="info-section">
          <h3>{t.galleryTitle}</h3>
          <p>
            {t.imageCounter
              .replace("{current}", String(safeIndex + 1))
              .replace("{total}", String(galleryUrls.length))}
          </p>
        </div>

        <div className="species-info-grid">
          <div className="info-card">
            <h3>{t.classification}</h3>
            <p>
              <strong>{t.groupLabel}:</strong>{" "}
              {species.category || t.unclassified}
            </p>
          </div>

          <div className="info-card">
            <h3>{t.habitatTitle}</h3>
            <p>{species.habitat || t.noInfo}</p>
          </div>

          <div className="info-card">
            <h3>{t.dietTitle}</h3>
            <p>{species.diet || t.noInfo}</p>
          </div>

          <div className="info-card">
            <h3>{t.distributionTitle}</h3>
            <p>{species.distribution || t.noInfo}</p>
          </div>
        </div>

        <div className="info-section">
          <h3>{t.descriptionTitle}</h3>
          <p className="description">
            {species.description || t.noDescription}
          </p>
        </div>

        {species.characteristics.length > 0 && (
          <div className="info-section">
            <h3>{t.characteristicsTitle}</h3>
            <ul className="characteristics-list">
              {species.characteristics.map((char, index) => (
                <li key={index}>{char}</li>
              ))}
            </ul>
          </div>
        )}

        {species.threats.length > 0 && (
          <div className="info-section threats-section">
            <h3>{t.threatsTitle}</h3>
            <ul className="threats-list">
              {species.threats.map((threat, index) => (
                <li key={index}>{threat}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
