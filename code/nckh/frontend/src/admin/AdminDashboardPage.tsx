import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Layout,
  Menu,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import {
  createAdminCategory,
  createAdminSpecies,
  createAdminUser,
  deleteAdminCategory,
  deleteAdminSpecies,
  deleteAdminUser,
  deleteSpeciesImage,
  getAdminCategories,
  getAdminSpecies,
  getAdminUsers,
  getSpeciesImages,
  resolveAdminAssetUrl,
  setPrimarySpeciesImage,
  updateAdminCategory,
  updateAdminSpecies,
  uploadSpeciesGeoJson,
  uploadSpeciesImages,
} from "../lib/adminApi";
import type { AdminCategoryItem, AdminUserItem } from "../lib/adminApi";
import { clearAdminSession, getAdminUser } from "../lib/adminAuth";
import { useNavigate } from "react-router-dom";
import vn from "../i18n/vn";
import en from "../i18n/en";

type Language = "vn" | "en";

interface AdminDashboardPageProps {
  language: Language;
  onLanguageChange: (language: Language) => void;
}

type AdminSectionKey = "species" | "categories" | "accounts";

interface SpeciesRow {
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
  sourceGroup: string | null;
  imageCount: number;
  updatedAt: string;
}

interface SpeciesFormValues {
  slug?: string;
  commonNameVi: string;
  commonNameEn?: string;
  scientificName?: string;
  category: string;
  habitatVi?: string;
  habitatEn?: string;
  dietVi?: string;
  dietEn?: string;
  descriptionVi?: string;
  descriptionEn?: string;
  imageUrl?: string;
  conservationStatusVi?: string;
  conservationStatusEn?: string;
  distributionVi?: string;
  distributionEn?: string;
  sourceGroup?: string;
}

interface SpeciesImage {
  id: number;
  fileName: string;
  url: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
}

interface AccountFormValues {
  email: string;
  password: string;
  fullName?: string;
  role?: "ADMIN" | "CONTRIBUTOR" | "USER";
}

interface CategoryFormValues {
  nameVi?: string;
  nameEn?: string;
}

export default function AdminDashboardPage({
  language,
  onLanguageChange,
}: AdminDashboardPageProps) {
  const navigate = useNavigate();
  const adminUser = useMemo(() => getAdminUser(), []);
  const userRole = adminUser?.role ?? (adminUser?.isAdmin ? "ADMIN" : "USER");
  const isAdmin = userRole === "ADMIN";
  const isContributorOrAbove =
    userRole === "ADMIN" || userRole === "CONTRIBUTOR";

  const dict = useMemo(() => (language === "en" ? en : vn), [language]);
  const tAdmin = dict.admin;

  function resolveError(error: any, fallback?: string): string {
    const msg: string = error?.message || "";
    if (msg === "__FORBIDDEN__") return dict.adminLogin.forbidden;
    if (msg === "__INVALID_CREDENTIALS__") return dict.adminLogin.loginFailed;
    return msg || fallback || tAdmin.unknownError || "Error";
  }

  const [activeSection, setActiveSection] =
    useState<AdminSectionKey>("species");

  const [speciesLoading, setSpeciesLoading] = useState(false);
  const [speciesRows, setSpeciesRows] = useState<SpeciesRow[]>([]);
  const [speciesSearch, setSpeciesSearch] = useState("");

  const [speciesForm] = Form.useForm<SpeciesFormValues>();
  const [editingRow, setEditingRow] = useState<SpeciesRow | null>(null);
  const [speciesModalOpen, setSpeciesModalOpen] = useState(false);
  const [speciesModalSaving, setSpeciesModalSaving] = useState(false);
  const [geoJsonFiles, setGeoJsonFiles] = useState<UploadFile[]>([]);

  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageModalLoading, setImageModalLoading] = useState(false);
  const [imageOwner, setImageOwner] = useState<SpeciesRow | null>(null);
  const [images, setImages] = useState<SpeciesImage[]>([]);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);

  const [categoryRows, setCategoryRows] = useState<AdminCategoryItem[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [newCategoryNameVi, setNewCategoryNameVi] = useState("");
  const [newCategoryNameEn, setNewCategoryNameEn] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryModalSaving, setCategoryModalSaving] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<AdminCategoryItem | null>(null);
  const [categoryForm] = Form.useForm<CategoryFormValues>();

  const [accountRows, setAccountRows] = useState<AdminUserItem[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalSaving, setAccountModalSaving] = useState(false);
  const [accountForm] = Form.useForm<AccountFormValues>();

  const sectionTitleMap: Record<AdminSectionKey, string> = {
    species: tAdmin.sectionSpecies,
    categories: tAdmin.sectionCategories,
    accounts: tAdmin.sectionAccounts,
  };

  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of categoryRows) {
      const displayName =
        language === "en"
          ? item.nameEn || item.nameVi || item.name
          : item.nameVi || item.nameEn || item.name;
      if (displayName) names.add(displayName);
    }
    for (const row of speciesRows) {
      if (row.category) names.add(row.category);
    }

    return [...names].sort().map((name) => ({ label: name, value: name }));
  }, [categoryRows, language, speciesRows]);

  useEffect(() => {
    loadSpecies();
    loadCategories();
    loadAccounts();
  }, []);

  const speciesSearchFirstRef = useRef(true);
  useEffect(() => {
    if (speciesSearchFirstRef.current) {
      speciesSearchFirstRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      loadSpecies();
    }, 400);
    return () => clearTimeout(timer);
  }, [speciesSearch]);

  const accountSearchFirstRef = useRef(true);
  useEffect(() => {
    if (accountSearchFirstRef.current) {
      accountSearchFirstRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      loadAccounts();
    }, 400);
    return () => clearTimeout(timer);
  }, [accountSearch]);

  async function loadSpecies() {
    try {
      setSpeciesLoading(true);
      const payload = await getAdminSpecies({
        search: speciesSearch,
        limit: 200,
        offset: 0,
      });
      setSpeciesRows(payload.data || []);
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotLoadSpecies));
    } finally {
      setSpeciesLoading(false);
    }
  }

  async function loadCategories() {
    try {
      setCategoryLoading(true);
      const payload = await getAdminCategories();
      setCategoryRows(payload.data || []);
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotLoadCategories));
    } finally {
      setCategoryLoading(false);
    }
  }

  async function loadAccounts() {
    try {
      setAccountLoading(true);
      const payload = await getAdminUsers({ search: accountSearch });
      const rows: AdminUserItem[] = payload.data || [];
      // USER role only sees other USER-role accounts
      const filtered =
        userRole === "USER" ? rows.filter((r) => r.role === "USER") : rows;
      setAccountRows(filtered);
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotLoadAccounts));
    } finally {
      setAccountLoading(false);
    }
  }

  function logout() {
    clearAdminSession();
    navigate("/admin/login", { replace: true });
  }

  function openCreateModal() {
    setEditingRow(null);
    speciesForm.resetFields();
    setGeoJsonFiles([]);
    if (categoryOptions.length > 0) {
      speciesForm.setFieldValue("category", categoryOptions[0].value);
    }
    setSpeciesModalOpen(true);
  }

  function openEditModal(record: SpeciesRow) {
    setEditingRow(record);
    setGeoJsonFiles([]);
    speciesForm.setFieldsValue({
      slug: record.slug,
      commonNameVi: record.commonNameVi || record.commonName,
      commonNameEn: record.commonNameEn || "",
      scientificName: record.scientificName || "",
      category: record.category || undefined,
      habitatVi: record.habitatVi || record.habitat || "",
      habitatEn: record.habitatEn || "",
      dietVi: record.dietVi || record.diet || "",
      dietEn: record.dietEn || "",
      descriptionVi: record.descriptionVi || record.description || "",
      descriptionEn: record.descriptionEn || "",
      imageUrl: record.imageUrl || "",
      conservationStatusVi:
        record.conservationStatusVi || record.conservationStatus || "",
      conservationStatusEn: record.conservationStatusEn || "",
      distributionVi: record.distributionVi || record.distribution || "",
      distributionEn: record.distributionEn || "",
      sourceGroup: record.sourceGroup || "",
    });
    setSpeciesModalOpen(true);
  }

  async function parseSelectedGeoJsonFile() {
    if (geoJsonFiles.length === 0) return null;

    const file = geoJsonFiles[0].originFileObj;
    if (!file) {
      throw new Error(tAdmin.readGeoJsonFailed);
    }

    const text = await file.text();
    let parsed: any;

    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error(tAdmin.invalidGeoJson);
    }

    if (
      !parsed ||
      parsed.type !== "FeatureCollection" ||
      !Array.isArray(parsed.features)
    ) {
      throw new Error(tAdmin.geoJsonMustBeFeatureCollection);
    }

    return parsed;
  }

  async function submitSpecies(values: SpeciesFormValues) {
    try {
      setSpeciesModalSaving(true);
      const geoJsonPayload = await parseSelectedGeoJsonFile();

      let speciesId = editingRow?.id || null;
      if (editingRow) {
        await updateAdminSpecies(editingRow.id, {
          ...values,
          commonName: values.commonNameVi,
          habitat: values.habitatVi,
          diet: values.dietVi,
          description: values.descriptionVi,
          conservationStatus: values.conservationStatusVi,
          distribution: values.distributionVi,
        });
      } else {
        const created: any = await createAdminSpecies({
          ...values,
          commonName: values.commonNameVi,
          habitat: values.habitatVi,
          diet: values.dietVi,
          description: values.descriptionVi,
          conservationStatus: values.conservationStatusVi,
          distribution: values.distributionVi,
        });
        const createdId = Number(created?.id ?? created?.data?.id);
        if (!createdId) {
          throw new Error(tAdmin.cannotGetSpeciesId);
        }
        speciesId = createdId;
      }

      if (geoJsonPayload && speciesId) {
        await uploadSpeciesGeoJson(speciesId, geoJsonPayload, true);
      }

      message.success(
        editingRow ? tAdmin.speciesUpdated : tAdmin.speciesCreated,
      );
      setSpeciesModalOpen(false);
      setGeoJsonFiles([]);
      await Promise.all([loadSpecies(), loadCategories()]);
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotSaveSpecies));
    } finally {
      setSpeciesModalSaving(false);
    }
  }

  async function removeSpecies(record: SpeciesRow) {
    try {
      await deleteAdminSpecies(record.id);
      message.success(tAdmin.speciesDeleted);
      await loadSpecies();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotDeleteSpecies));
    }
  }

  function openSpeciesDetailPage(record: SpeciesRow) {
    navigate(`/admin/species/${record.id}`);
  }

  async function openImageModal(record: SpeciesRow) {
    try {
      setImageModalOpen(true);
      setImageOwner(record);
      setUploadFiles([]);
      setImageModalLoading(true);
      const payload = await getSpeciesImages(record.id);
      setImages(payload.data || []);
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotLoadImages));
    } finally {
      setImageModalLoading(false);
    }
  }

  async function handleUploadImages() {
    if (!imageOwner || uploadFiles.length === 0) return;

    try {
      setImageModalLoading(true);
      const realFiles = uploadFiles
        .map((f) => f.originFileObj)
        .filter(Boolean) as File[];
      const payload = await uploadSpeciesImages(imageOwner.id, realFiles);
      setImages(payload.data || []);
      setUploadFiles([]);
      message.success(tAdmin.imagesUploaded);
      await loadSpecies();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotUploadImages));
    } finally {
      setImageModalLoading(false);
    }
  }

  async function removeImage(imageId: number) {
    if (!imageOwner) return;

    try {
      setImageModalLoading(true);
      const payload = await deleteSpeciesImage(imageOwner.id, imageId);
      setImages(payload.data || []);
      message.success(tAdmin.imageDeleted);
      await loadSpecies();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotDeleteImage));
    } finally {
      setImageModalLoading(false);
    }
  }

  async function setPrimary(imageId: number) {
    if (!imageOwner) return;

    try {
      setImageModalLoading(true);
      await setPrimarySpeciesImage(imageOwner.id, imageId);
      const payload = await getSpeciesImages(imageOwner.id);
      setImages(payload.data || []);
      message.success(tAdmin.primaryImageSet);
      await loadSpecies();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotSetPrimaryImage));
    } finally {
      setImageModalLoading(false);
    }
  }

  async function createCategory() {
    const nameVi = newCategoryNameVi.trim();
    const nameEn = newCategoryNameEn.trim();
    if (!nameVi && !nameEn) {
      message.warning(tAdmin.enterCategoryName);
      return;
    }

    try {
      setCategorySaving(true);
      await createAdminCategory({
        nameVi: nameVi || undefined,
        nameEn: nameEn || undefined,
      });
      setNewCategoryNameVi("");
      setNewCategoryNameEn("");
      message.success(tAdmin.categoryCreated);
      await loadCategories();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotCreateCategory));
    } finally {
      setCategorySaving(false);
    }
  }

  function openEditCategoryModal(record: AdminCategoryItem) {
    setEditingCategory(record);
    categoryForm.setFieldsValue({
      nameVi: record.nameVi || record.name || "",
      nameEn: record.nameEn || "",
    });
    setCategoryModalOpen(true);
  }

  async function submitCategory(values: CategoryFormValues) {
    if (!editingCategory) return;

    const nameVi = String(values.nameVi || "").trim();
    const nameEn = String(values.nameEn || "").trim();
    if (!nameVi && !nameEn) {
      message.warning(tAdmin.enterCategoryName);
      return;
    }

    try {
      setCategoryModalSaving(true);
      await updateAdminCategory(editingCategory.id, {
        nameVi: nameVi || undefined,
        nameEn: nameEn || undefined,
      });
      message.success(tAdmin.categoryUpdated);
      setCategoryModalOpen(false);
      setEditingCategory(null);
      await Promise.all([loadCategories(), loadSpecies()]);
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotUpdateCategory));
    } finally {
      setCategoryModalSaving(false);
    }
  }

  async function removeCategory(record: AdminCategoryItem) {
    try {
      await deleteAdminCategory(record.id);
      message.success(tAdmin.categoryDeleted);
      await Promise.all([loadCategories(), loadSpecies()]);
    } catch (error: any) {
      const rawMessage = String(error?.message || "").toLowerCase();
      if (rawMessage.includes("still has species")) {
        message.error(tAdmin.cannotDeleteCategoryHasSpecies);
      } else {
        message.error(resolveError(error, tAdmin.cannotDeleteCategory));
      }
    }
  }

  function openCreateAccountModal() {
    accountForm.resetFields();
    accountForm.setFieldValue("role", "USER");
    setAccountModalOpen(true);
  }

  async function submitAccount(values: AccountFormValues) {
    try {
      setAccountModalSaving(true);
      await createAdminUser(values);
      message.success(tAdmin.accountCreated);
      setAccountModalOpen(false);
      await loadAccounts();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotCreateAccount));
    } finally {
      setAccountModalSaving(false);
    }
  }

  async function removeAccount(record: AdminUserItem) {
    try {
      await deleteAdminUser(record.id);
      message.success(tAdmin.accountDeleted);
      await loadAccounts();
    } catch (error: any) {
      message.error(resolveError(error, tAdmin.cannotDeleteAccount));
    }
  }

  const speciesColumns: ColumnsType<SpeciesRow> = [
    {
      title: tAdmin.tableId,
      dataIndex: "id",
      width: 70,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: tAdmin.tableSpecies,
      dataIndex: "commonName",
      sorter: (a, b) =>
        (a.commonNameVi || a.commonName).localeCompare(
          b.commonNameVi || b.commonName,
        ),
      render: (_value, record) => (
        <div>
          <Typography.Link strong onClick={() => openSpeciesDetailPage(record)}>
            {record.commonNameVi || record.commonName}
          </Typography.Link>
          {record.commonNameEn && (
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              {record.commonNameEn}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {record.scientificName || "-"}
          </div>
        </div>
      ),
    },
    {
      title: tAdmin.tableCategory,
      dataIndex: "category",
      width: 160,
      sorter: (a, b) => (a.category || "").localeCompare(b.category || ""),
      render: (value) => value || "-",
    },
    {
      title: tAdmin.tableImages,
      dataIndex: "imageCount",
      width: 90,
      sorter: (a, b) => a.imageCount - b.imageCount,
      render: (value) => (
        <Tag color={value >= 10 ? "red" : "blue"}>{value}/10</Tag>
      ),
    },
    {
      title: tAdmin.tableUpdatedAt,
      dataIndex: "updatedAt",
      width: 180,
      sorter: (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      render: (value) => (value ? new Date(value).toLocaleString() : "-"),
    },
    {
      title: tAdmin.tableActions,
      key: "action",
      width: 300,
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" onClick={() => openSpeciesDetailPage(record)}>
            {tAdmin.viewSpeciesDetail}
          </Button>
          {isContributorOrAbove && (
            <Button size="small" onClick={() => openEditModal(record)}>
              {tAdmin.tableEdit}
            </Button>
          )}
          {isContributorOrAbove && (
            <Button size="small" onClick={() => openImageModal(record)}>
              {tAdmin.manageImages}
            </Button>
          )}
          {isAdmin && (
            <Popconfirm
              title={tAdmin.confirmDeleteSpecies}
              onConfirm={() => removeSpecies(record)}
            >
              <Button size="small" danger>
                {tAdmin.tableDelete}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const categoryColumns: ColumnsType<AdminCategoryItem> = [
    {
      title: tAdmin.tableId,
      dataIndex: "id",
      width: 80,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: tAdmin.tableCategoryNameVi,
      key: "nameVi",
      sorter: (a, b) =>
        (a.nameVi || a.name || "").localeCompare(b.nameVi || b.name || ""),
      render: (_value, record) =>
        record.nameVi || record.name || record.nameEn || "-",
    },
    {
      title: tAdmin.tableCategoryNameEn,
      key: "nameEn",
      sorter: (a, b) => (a.nameEn || "").localeCompare(b.nameEn || ""),
      render: (_value, record) => record.nameEn || "-",
    },
    {
      title: tAdmin.tableSpeciesCount,
      dataIndex: "speciesCount",
      width: 120,
      sorter: (a, b) => a.speciesCount - b.speciesCount,
      render: (value) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: tAdmin.tableUpdatedAt,
      dataIndex: "updatedAt",
      width: 190,
      sorter: (a, b) =>
        new Date(a.updatedAt || 0).getTime() -
        new Date(b.updatedAt || 0).getTime(),
      render: (value) => (value ? new Date(value).toLocaleString() : "-"),
    },
    {
      title: tAdmin.tableActions,
      key: "action",
      width: 240,
      render: (_value, record) => (
        <Space>
          {isContributorOrAbove && (
            <Button size="small" onClick={() => openEditCategoryModal(record)}>
              {tAdmin.tableEdit}
            </Button>
          )}
          {isAdmin && (
            <Popconfirm
              title={tAdmin.confirmDeleteCategory}
              description={tAdmin.confirmDeleteCategoryDescription}
              onConfirm={() => removeCategory(record)}
            >
              <Button size="small" danger>
                {tAdmin.tableDelete}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const accountColumns: ColumnsType<AdminUserItem> = [
    {
      title: tAdmin.tableId,
      dataIndex: "id",
      width: 80,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: tAdmin.tableEmail,
      dataIndex: "email",
      sorter: (a, b) => a.email.localeCompare(b.email),
    },
    {
      title: tAdmin.tableFullName,
      dataIndex: "fullName",
      render: (value) => value || "-",
    },
    {
      title: tAdmin.tableRole,
      dataIndex: "role",
      width: 140,
      sorter: (a, b) => (a.role || "").localeCompare(b.role || ""),
      render: (value: string) => {
        if (value === "ADMIN") return <Tag color="red">{tAdmin.roleAdmin}</Tag>;
        if (value === "CONTRIBUTOR")
          return <Tag color="blue">{tAdmin.roleContributor}</Tag>;
        return <Tag>{tAdmin.roleUser}</Tag>;
      },
    },
    {
      title: tAdmin.tableCreatedAt,
      dataIndex: "createdAt",
      width: 190,
      sorter: (a, b) =>
        new Date(a.createdAt || 0).getTime() -
        new Date(b.createdAt || 0).getTime(),
      render: (value) => (value ? new Date(value).toLocaleString() : "-"),
    },
    {
      title: tAdmin.tableActions,
      key: "action",
      width: 180,
      render: (_value, record) =>
        isAdmin ? (
          <Popconfirm
            title={tAdmin.confirmDeleteAccount}
            onConfirm={() => removeAccount(record)}
          >
            <Button size="small" danger disabled={record.id === adminUser?.id}>
              {tAdmin.tableDelete}
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider
        width={240}
        theme="light"
        style={{ borderRight: "1px solid #e5e7eb" }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid #e5e7eb" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {tAdmin.consoleTitle}
          </Typography.Title>
          <Typography.Text type="secondary">
            {adminUser?.email || tAdmin.unknownUser}
          </Typography.Text>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[activeSection]}
          onClick={(event) => setActiveSection(event.key as AdminSectionKey)}
          items={[
            { key: "categories", label: tAdmin.menuCategories },
            { key: "species", label: tAdmin.menuSpecies },
            { key: "accounts", label: tAdmin.menuAccounts },
          ]}
          style={{ borderInlineEnd: "none" }}
        />
      </Layout.Sider>

      <Layout style={{ padding: 16, background: "#f3f4f6" }}>
        <Card style={{ marginBottom: 16 }}>
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {sectionTitleMap[activeSection]}
              </Typography.Title>
              <Typography.Text type="secondary">
                {tAdmin.loggedInPrefix}:{" "}
                {adminUser?.email || tAdmin.unknownUser}
              </Typography.Text>
            </div>
            <Space align="center" wrap>
              <span style={{ fontSize: 13, color: "#4b5563" }}>
                {tAdmin.languageLabel}:
              </span>
              <button
                type="button"
                onClick={() => onLanguageChange("vn")}
                style={{
                  border: "1px solid #9ca3af",
                  background: language === "vn" ? "#111827" : "#ffffff",
                  color: language === "vn" ? "#ffffff" : "#111827",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                VI
              </button>
              <button
                type="button"
                onClick={() => onLanguageChange("en")}
                style={{
                  border: "1px solid #9ca3af",
                  background: language === "en" ? "#111827" : "#ffffff",
                  color: language === "en" ? "#ffffff" : "#111827",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                EN
              </button>
              <Button danger onClick={logout}>
                {tAdmin.logout}
              </Button>
            </Space>
          </Space>
        </Card>

        {activeSection === "species" && (
          <>
            <Card style={{ marginBottom: 16 }}>
              <Space wrap>
                <Input.Search
                  placeholder={tAdmin.speciesSearchPlaceholder}
                  allowClear
                  value={speciesSearch}
                  onChange={(e) => setSpeciesSearch(e.target.value)}
                  onSearch={() => loadSpecies()}
                  style={{ width: 340 }}
                />
                {isAdmin && (
                  <Button type="primary" onClick={openCreateModal}>
                    {tAdmin.addSpecies}
                  </Button>
                )}
              </Space>
            </Card>

            <Card>
              <Table
                columns={speciesColumns}
                dataSource={speciesRows}
                rowKey="id"
                loading={speciesLoading}
                scroll={{ x: 1200 }}
                pagination={{ pageSize: 20 }}
              />
            </Card>
          </>
        )}

        {activeSection === "categories" && (
          <>
            {isAdmin && (
              <Card style={{ marginBottom: 16 }}>
                <Space wrap>
                  <Input
                    placeholder={tAdmin.categoryPlaceholderVi}
                    value={newCategoryNameVi}
                    onChange={(e) => setNewCategoryNameVi(e.target.value)}
                    style={{ width: 320 }}
                    onPressEnter={() => createCategory()}
                  />
                  <Input
                    placeholder={tAdmin.categoryPlaceholderEn}
                    value={newCategoryNameEn}
                    onChange={(e) => setNewCategoryNameEn(e.target.value)}
                    style={{ width: 320 }}
                    onPressEnter={() => createCategory()}
                  />
                  <Button
                    type="primary"
                    loading={categorySaving}
                    onClick={() => createCategory()}
                  >
                    {tAdmin.createCategory}
                  </Button>
                </Space>
              </Card>
            )}

            <Card>
              <Table
                columns={categoryColumns}
                dataSource={categoryRows}
                rowKey="id"
                loading={categoryLoading}
                pagination={{ pageSize: 20 }}
              />
            </Card>
          </>
        )}

        {activeSection === "accounts" && (
          <>
            <Card style={{ marginBottom: 16 }}>
              <Space wrap>
                <Input.Search
                  placeholder={tAdmin.accountSearchPlaceholder}
                  allowClear
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  onSearch={() => loadAccounts()}
                  style={{ width: 320 }}
                />
                {isAdmin && (
                  <Button type="primary" onClick={openCreateAccountModal}>
                    {tAdmin.createAccount}
                  </Button>
                )}
              </Space>
            </Card>

            <Card>
              <Table
                columns={accountColumns}
                dataSource={accountRows}
                rowKey="id"
                loading={accountLoading}
                pagination={{ pageSize: 20 }}
              />
            </Card>
          </>
        )}
      </Layout>

      <Modal
        title={
          editingRow
            ? `${tAdmin.modalEditSpeciesTitle} #${editingRow.id}`
            : tAdmin.modalCreateSpeciesTitle
        }
        open={speciesModalOpen}
        onCancel={() => {
          setSpeciesModalOpen(false);
          setGeoJsonFiles([]);
        }}
        onOk={() => speciesForm.submit()}
        okButtonProps={{ loading: speciesModalSaving }}
        width={900}
      >
        <Form form={speciesForm} layout="vertical" onFinish={submitSpecies}>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Form.Item
              name="commonNameVi"
              label={tAdmin.labelCommonNameVi}
              rules={[
                {
                  required: true,
                  message: tAdmin.validationCommonNameViRequired,
                },
              ]}
            >
              <Input />
            </Form.Item>

            <Form.Item name="commonNameEn" label={tAdmin.labelCommonNameEn}>
              <Input />
            </Form.Item>

            <Form.Item name="slug" label={tAdmin.labelSlug}>
              <Input placeholder={tAdmin.placeholderSlugAuto} />
            </Form.Item>

            <Form.Item name="scientificName" label={tAdmin.labelScientificName}>
              <Input />
            </Form.Item>

            <Form.Item
              name="category"
              label={tAdmin.labelCategory}
              rules={[
                { required: true, message: tAdmin.validationCategoryRequired },
              ]}
            >
              <Select
                showSearch
                placeholder={tAdmin.selectCategoryPlaceholder}
                options={categoryOptions}
                optionFilterProp="label"
              />
            </Form.Item>

            <Form.Item name="habitatVi" label={tAdmin.labelHabitatVi}>
              <Input />
            </Form.Item>

            <Form.Item name="habitatEn" label={tAdmin.labelHabitatEn}>
              <Input />
            </Form.Item>

            <Form.Item name="dietVi" label={tAdmin.labelDietVi}>
              <Input />
            </Form.Item>

            <Form.Item name="dietEn" label={tAdmin.labelDietEn}>
              <Input />
            </Form.Item>

            <Form.Item
              name="conservationStatusVi"
              label={tAdmin.labelConservationStatusVi}
            >
              <Input />
            </Form.Item>

            <Form.Item
              name="conservationStatusEn"
              label={tAdmin.labelConservationStatusEn}
            >
              <Input />
            </Form.Item>

            <Form.Item name="distributionVi" label={tAdmin.labelDistributionVi}>
              <Input />
            </Form.Item>

            <Form.Item name="distributionEn" label={tAdmin.labelDistributionEn}>
              <Input />
            </Form.Item>

            <Form.Item
              name="imageUrl"
              label={tAdmin.labelImageUrl}
              style={{ gridColumn: "1 / -1" }}
            >
              <Input />
            </Form.Item>

            <Form.Item
              name="sourceGroup"
              label={tAdmin.labelSourceGroup}
              style={{ gridColumn: "1 / -1" }}
            >
              <Input />
            </Form.Item>

            <Form.Item
              label={tAdmin.labelGeoJson}
              style={{ gridColumn: "1 / -1", marginBottom: 8 }}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                <Upload
                  beforeUpload={() => false}
                  maxCount={1}
                  accept=".geojson,.json,application/geo+json,application/json"
                  fileList={geoJsonFiles}
                  onChange={(info) => setGeoJsonFiles(info.fileList.slice(-1))}
                >
                  <Button>{tAdmin.chooseFile}</Button>
                </Upload>
                <Typography.Text type="secondary">
                  {tAdmin.geoJsonUploadHint}
                </Typography.Text>
              </Space>
            </Form.Item>

            <Form.Item
              name="descriptionVi"
              label={tAdmin.labelDescriptionVi}
              style={{ gridColumn: "1 / -1" }}
            >
              <Input.TextArea rows={4} />
            </Form.Item>

            <Form.Item
              name="descriptionEn"
              label={tAdmin.labelDescriptionEn}
              style={{ gridColumn: "1 / -1" }}
            >
              <Input.TextArea rows={4} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={`${tAdmin.modalImageTitlePrefix} - ${imageOwner?.commonNameVi || imageOwner?.commonName || ""}`}
        open={imageModalOpen}
        onCancel={() => {
          setImageModalOpen(false);
          setImageOwner(null);
          setUploadFiles([]);
          setImages([]);
        }}
        footer={null}
        width={960}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Typography.Text>
            {tAdmin.imageLimitHint.replace("{count}", String(images.length))}
          </Typography.Text>

          <Space align="start" wrap>
            <Upload
              multiple
              fileList={uploadFiles}
              beforeUpload={() => false}
              onChange={(info) => setUploadFiles(info.fileList)}
              disabled={images.length >= 10}
              accept="image/*"
            >
              <Button disabled={images.length >= 10}>
                {tAdmin.selectImages}
              </Button>
            </Upload>

            <Button
              type="primary"
              onClick={handleUploadImages}
              loading={imageModalLoading}
              disabled={uploadFiles.length === 0 || images.length >= 10}
            >
              {tAdmin.uploadImages}
            </Button>
          </Space>

          <Table
            rowKey="id"
            loading={imageModalLoading}
            dataSource={images}
            pagination={false}
            columns={[
              {
                title: tAdmin.tablePreview,
                key: "preview",
                width: 110,
                render: (_v, record) => (
                  <img
                    src={resolveAdminAssetUrl(record.url)}
                    alt={record.fileName}
                    style={{
                      width: 72,
                      height: 54,
                      objectFit: "cover",
                      borderRadius: 6,
                    }}
                  />
                ),
              },
              {
                title: tAdmin.tableFileName,
                dataIndex: "fileName",
              },
              {
                title: tAdmin.tableUrl,
                dataIndex: "url",
                render: (value) => (
                  <a
                    href={resolveAdminAssetUrl(value)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {resolveAdminAssetUrl(value)}
                  </a>
                ),
              },
              {
                title: tAdmin.tableActions,
                key: "action",
                width: 220,
                render: (_v, record) => (
                  <Space>
                    <Button size="small" onClick={() => setPrimary(record.id)}>
                      {tAdmin.setPrimaryImage}
                    </Button>
                    <Popconfirm
                      title={tAdmin.confirmDeleteImage}
                      onConfirm={() => removeImage(record.id)}
                    >
                      <Button size="small" danger>
                        {tAdmin.tableDelete}
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        title={
          editingCategory
            ? `${tAdmin.modalEditCategoryTitle} #${editingCategory.id}`
            : tAdmin.modalEditCategoryTitle
        }
        open={categoryModalOpen}
        onCancel={() => {
          setCategoryModalOpen(false);
          setEditingCategory(null);
          categoryForm.resetFields();
        }}
        onOk={() => categoryForm.submit()}
        okButtonProps={{ loading: categoryModalSaving }}
      >
        <Form form={categoryForm} layout="vertical" onFinish={submitCategory}>
          <Form.Item name="nameVi" label={tAdmin.labelCategoryNameVi}>
            <Input />
          </Form.Item>

          <Form.Item name="nameEn" label={tAdmin.labelCategoryNameEn}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={tAdmin.modalCreateAccountTitle}
        open={accountModalOpen}
        onCancel={() => setAccountModalOpen(false)}
        onOk={() => accountForm.submit()}
        okButtonProps={{ loading: accountModalSaving }}
      >
        <Form form={accountForm} layout="vertical" onFinish={submitAccount}>
          <Form.Item
            name="email"
            label={tAdmin.labelEmail}
            rules={[
              { required: true, message: tAdmin.validationEmailRequired },
              { type: "email", message: tAdmin.validationEmailInvalid },
            ]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="password"
            label={tAdmin.labelPassword}
            rules={[
              { required: true, message: tAdmin.validationPasswordRequired },
              { min: 6, message: tAdmin.validationPasswordMin },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item name="fullName" label={tAdmin.labelFullName}>
            <Input />
          </Form.Item>

          <Form.Item
            name="isAdmin"
            valuePropName="checked"
            style={{ display: "none" }}
          >
            <input type="hidden" />
          </Form.Item>
          <Form.Item
            name="role"
            label={tAdmin.labelRole}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "ADMIN", label: tAdmin.roleAdmin },
                { value: "CONTRIBUTOR", label: tAdmin.roleContributor },
                { value: "USER", label: tAdmin.roleUser },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
