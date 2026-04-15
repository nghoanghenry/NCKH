import "./App.css";
import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import Map from "./components/Map";
import SpeciesDetail from "./components/SpeciesDetail";
import RequireAdminRoute from "./admin/RequireAdminRoute";
import AdminLoginPage from "./admin/AdminLoginPage";
import AdminDashboardPage from "./admin/AdminDashboardPage";
import AdminSpeciesDetailPage from "./admin/AdminSpeciesDetailPage";
import vn from "./i18n/vn";
import en from "./i18n/en";

type Language = "vn" | "en";

function loadInitialLanguage(): Language {
  const saved = localStorage.getItem("nckh_language");
  if (saved === "en" || saved === "vn") return saved;
  return "vn";
}

function App() {
  const [language, setLanguage] = useState<Language>(loadInitialLanguage);
  const navigate = useNavigate();
  const t = useMemo(() => (language === "en" ? en : vn), [language]);

  useEffect(() => {
    localStorage.setItem("nckh_language", language);
  }, [language]);

  useEffect(() => {
    document.title = t.app.title;
  }, [t.app.title]);

  return (
    <div className="App" style={{ maxWidth: "100vw", margin: 0, padding: 0 }}>
      <Routes>
        <Route
          path="/admin/login"
          element={
            <AdminLoginPage
              language={language}
              onLanguageChange={setLanguage}
            />
          }
        />
        <Route element={<RequireAdminRoute />}>
          <Route
            path="/admin"
            element={
              <AdminDashboardPage
                language={language}
                onLanguageChange={setLanguage}
              />
            }
          />
          <Route
            path="/admin/species/:speciesId"
            element={
              <AdminSpeciesDetailPage
                language={language}
                onLanguageChange={setLanguage}
              />
            }
          />
        </Route>
        <Route
          path="/"
          element={
            <>
              <header className="main-app-header">
                <h1 className="main-app-title">{t.app.title}</h1>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => navigate("/admin/login")}
                    style={{
                      border: "1px solid #9ca3af",
                      background: "#1d4ed8",
                      color: "#ffffff",
                      borderRadius: "8px",
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "13px",
                    }}
                  >
                    Admin
                  </button>
                  <span style={{ fontSize: "14px", color: "#4b5563" }}>
                    {t.app.languageLabel}:
                  </span>
                  <button
                    type="button"
                    onClick={() => setLanguage("vn")}
                    style={{
                      border: "1px solid #9ca3af",
                      background: language === "vn" ? "#111827" : "#ffffff",
                      color: language === "vn" ? "#ffffff" : "#111827",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    VI
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage("en")}
                    style={{
                      border: "1px solid #9ca3af",
                      background: language === "en" ? "#111827" : "#ffffff",
                      color: language === "en" ? "#ffffff" : "#111827",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    EN
                  </button>
                </div>
              </header>
              <main style={{ padding: "1rem" }}>
                <Map language={language} />
              </main>
            </>
          }
        />
        <Route
          path="/species/:speciesId"
          element={
            <SpeciesDetail language={language} onLanguageChange={setLanguage} />
          }
        />
      </Routes>
    </div>
  );
}

export default App;
