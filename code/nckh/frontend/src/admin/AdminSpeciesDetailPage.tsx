import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useParams } from "react-router-dom";
import {
  createAdminSpeciesCoordinate,
  createAdminSpeciesFeature,
  deleteAdminSpeciesCoordinate,
  deleteAdminSpeciesFeature,
  getAdminSpeciesDetail,
  getAdminSpeciesGeoJson,
  getAdminSpeciesPositions,
  updateAdminSpeciesCoordinate,
  updateAdminSpeciesFeature,
  type AdminSpeciesCoordinateItem,
  type AdminSpeciesCoordinatePayload,
  type AdminSpeciesFeaturePayload,
  type AdminSpeciesFeatureSummaryItem,
} from "../lib/adminApi";
import vn from "../i18n/vn";
import en from "../i18n/en";

type Language = "vn" | "en";

interface AdminSpeciesDetailPageProps {
  language: Language;
  onLanguageChange: (language: Language) => void;
}

interface SpeciesDetailData {
  id: number;
  slug: string;
  commonName: string;
  commonNameVi?: string | null;
  commonNameEn?: string | null;
  scientificName: string | null;
  category: string | null;
  imageCount?: number;
  updatedAt?: string;
}

interface FeatureFormValues {
  geomType: string;
  propertiesText?: string;
}

interface CoordinateFormValues {
  featureId: number;
  partIndex: number;
  ringIndex: number;
  pointOrder: number;
  lon: number;
  lat: number;
}

const GEOM_TYPE_OPTIONS = [
  "Point",
  "LineString",
  "Polygon",
  "MultiLineString",
  "MultiPolygon",
];

function formatCoordinate(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toFixed(6);
}

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0;
}

export default function AdminSpeciesDetailPage({
  language,
  onLanguageChange,
}: AdminSpeciesDetailPageProps) {
  const navigate = useNavigate();
  const { speciesId } = useParams<{ speciesId: string }>();
  const numericSpeciesId = Number(speciesId);

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [species, setSpecies] = useState<SpeciesDetailData | null>(null);
  const [featureSummary, setFeatureSummary] = useState<
    AdminSpeciesFeatureSummaryItem[]
  >([]);
  const [coordinates, setCoordinates] = useState<AdminSpeciesCoordinateItem[]>(
    [],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  const [coordinateTotal, setCoordinateTotal] = useState(0);
  const [refreshSeq, setRefreshSeq] = useState(0);

  const [featureModalOpen, setFeatureModalOpen] = useState(false);
  const [featureModalSaving, setFeatureModalSaving] = useState(false);
  const [editingFeature, setEditingFeature] =
    useState<AdminSpeciesFeatureSummaryItem | null>(null);
  const [featureForm] = Form.useForm<FeatureFormValues>();

  const [coordinateModalOpen, setCoordinateModalOpen] = useState(false);
  const [coordinateModalSaving, setCoordinateModalSaving] = useState(false);
  const [editingCoordinate, setEditingCoordinate] =
    useState<AdminSpeciesCoordinateItem | null>(null);
  const [coordinateForm] = Form.useForm<CoordinateFormValues>();

  const dict = useMemo(() => (language === "en" ? en : vn), [language]);
  const tAdmin = dict.admin;

  useEffect(() => {
    if (Number.isNaN(numericSpeciesId)) return;

    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        const [detailPayload, positionsPayload] = await Promise.all([
          getAdminSpeciesDetail(numericSpeciesId, language),
          getAdminSpeciesPositions(numericSpeciesId, language, {
            limit: pageSize,
            offset: (page - 1) * pageSize,
          }),
        ]);

        if (cancelled) return;
        setSpecies(detailPayload?.data || null);
        setFeatureSummary(positionsPayload?.data?.featureSummary || []);
        setCoordinates(positionsPayload?.data?.coordinates || []);
        setCoordinateTotal(Number(positionsPayload?.meta?.total || 0));
      } catch (error: any) {
        if (!cancelled) {
          message.error(error.message || tAdmin.cannotLoadSpeciesDetail);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    language,
    numericSpeciesId,
    page,
    pageSize,
    refreshSeq,
    tAdmin.cannotLoadSpeciesDetail,
  ]);

  const featureOptions = useMemo(
    () =>
      featureSummary.map((item) => ({
        label: `#${item.featureId} (${item.geomType})`,
        value: item.featureId,
      })),
    [featureSummary],
  );

  function parsePropertiesText(rawText?: string): Record<string, unknown> {
    const text = String(rawText || "").trim();
    if (!text) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error(tAdmin.invalidPropertiesJson);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(tAdmin.invalidPropertiesJson);
    }

    return parsed as Record<string, unknown>;
  }

  function hasDuplicateCoordinateTuple(
    payload: AdminSpeciesCoordinatePayload,
    excludedCoordinateId?: number,
  ) {
    return coordinates.some((item) => {
      if (
        excludedCoordinateId !== undefined &&
        item.coordinateId === excludedCoordinateId
      ) {
        return false;
      }

      return (
        item.featureId === payload.featureId &&
        item.partIndex === payload.partIndex &&
        item.ringIndex === payload.ringIndex &&
        item.pointOrder === payload.pointOrder
      );
    });
  }

  function openCreateFeatureModal() {
    setEditingFeature(null);
    featureForm.setFieldsValue({
      geomType: "Point",
      propertiesText: "{}",
    });
    setFeatureModalOpen(true);
  }

  function openEditFeatureModal(record: AdminSpeciesFeatureSummaryItem) {
    setEditingFeature(record);
    featureForm.setFieldsValue({
      geomType: record.geomType,
      propertiesText: JSON.stringify(record.properties || {}, null, 2),
    });
    setFeatureModalOpen(true);
  }

  async function submitFeature(values: FeatureFormValues) {
    if (Number.isNaN(numericSpeciesId)) return;

    try {
      setFeatureModalSaving(true);

      const payload: AdminSpeciesFeaturePayload = {
        geomType: values.geomType,
        properties: parsePropertiesText(values.propertiesText),
      };

      if (editingFeature) {
        await updateAdminSpeciesFeature(
          numericSpeciesId,
          editingFeature.featureId,
          payload,
        );
        message.success(tAdmin.featureUpdated);
      } else {
        await createAdminSpeciesFeature(numericSpeciesId, payload);
        message.success(tAdmin.featureCreated);
      }

      setFeatureModalOpen(false);
      setEditingFeature(null);
      setRefreshSeq((v) => v + 1);
    } catch (error: any) {
      message.error(error.message || tAdmin.cannotSaveFeature);
    } finally {
      setFeatureModalSaving(false);
    }
  }

  async function removeFeature(record: AdminSpeciesFeatureSummaryItem) {
    if (Number.isNaN(numericSpeciesId)) return;

    try {
      await deleteAdminSpeciesFeature(numericSpeciesId, record.featureId);
      message.success(tAdmin.featureDeleted);
      setRefreshSeq((v) => v + 1);
    } catch (error: any) {
      message.error(error.message || tAdmin.cannotDeleteFeature);
    }
  }

  function openCreateCoordinateModal() {
    if (featureSummary.length === 0) {
      message.warning(tAdmin.createFeatureFirst);
      return;
    }

    setEditingCoordinate(null);
    coordinateForm.setFieldsValue({
      featureId: featureSummary[0].featureId,
      partIndex: 0,
      ringIndex: 0,
      pointOrder: 0,
      lon: 0,
      lat: 0,
    });
    setCoordinateModalOpen(true);
  }

  function openEditCoordinateModal(record: AdminSpeciesCoordinateItem) {
    setEditingCoordinate(record);
    coordinateForm.setFieldsValue({
      featureId: record.featureId,
      partIndex: record.partIndex,
      ringIndex: record.ringIndex,
      pointOrder: record.pointOrder,
      lon: record.lon,
      lat: record.lat,
    });
    setCoordinateModalOpen(true);
  }

  async function submitCoordinate(values: CoordinateFormValues) {
    if (Number.isNaN(numericSpeciesId)) return;

    const payload: AdminSpeciesCoordinatePayload = {
      featureId: Number(values.featureId),
      partIndex: Number(values.partIndex),
      ringIndex: Number(values.ringIndex),
      pointOrder: Number(values.pointOrder),
      lon: Number(values.lon),
      lat: Number(values.lat),
    };

    if (
      Number.isNaN(payload.featureId) ||
      Number.isNaN(payload.partIndex || 0) ||
      Number.isNaN(payload.ringIndex || 0) ||
      Number.isNaN(payload.pointOrder) ||
      Number.isNaN(payload.lon) ||
      Number.isNaN(payload.lat)
    ) {
      message.error(tAdmin.invalidCoordinatePayload);
      return;
    }

    if (
      !isNonNegativeInteger(payload.partIndex || 0) ||
      !isNonNegativeInteger(payload.ringIndex || 0) ||
      !isNonNegativeInteger(payload.pointOrder)
    ) {
      message.error(tAdmin.validationCoordinateIndexNonNegative);
      return;
    }

    if (payload.lon < -180 || payload.lon > 180) {
      message.error(tAdmin.validationLongitudeRange);
      return;
    }

    if (payload.lat < -90 || payload.lat > 90) {
      message.error(tAdmin.validationLatitudeRange);
      return;
    }

    if (hasDuplicateCoordinateTuple(payload, editingCoordinate?.coordinateId)) {
      message.warning(tAdmin.validationCoordinateDuplicate);
      return;
    }

    try {
      setCoordinateModalSaving(true);

      if (editingCoordinate) {
        await updateAdminSpeciesCoordinate(
          numericSpeciesId,
          editingCoordinate.coordinateId,
          payload,
        );
        message.success(tAdmin.coordinateUpdated);
      } else {
        await createAdminSpeciesCoordinate(numericSpeciesId, payload);
        message.success(tAdmin.coordinateCreated);
      }

      setCoordinateModalOpen(false);
      setEditingCoordinate(null);
      setRefreshSeq((v) => v + 1);
    } catch (error: any) {
      message.error(error.message || tAdmin.cannotSaveCoordinate);
    } finally {
      setCoordinateModalSaving(false);
    }
  }

  async function removeCoordinate(record: AdminSpeciesCoordinateItem) {
    if (Number.isNaN(numericSpeciesId)) return;

    try {
      await deleteAdminSpeciesCoordinate(numericSpeciesId, record.coordinateId);
      message.success(tAdmin.coordinateDeleted);

      if (coordinates.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        setRefreshSeq((v) => v + 1);
      }
    } catch (error: any) {
      message.error(error.message || tAdmin.cannotDeleteCoordinate);
    }
  }

  const featureColumns: ColumnsType<AdminSpeciesFeatureSummaryItem> = [
    {
      title: tAdmin.tableFeatureId,
      dataIndex: "featureId",
      width: 110,
    },
    {
      title: tAdmin.tableGeomType,
      dataIndex: "geomType",
      width: 150,
    },
    {
      title: tAdmin.tablePointCount,
      dataIndex: "pointCount",
      width: 140,
    },
    {
      title: tAdmin.tableCentroid,
      key: "centroid",
      width: 240,
      render: (_value, record) =>
        `${formatCoordinate(record.centroidLat)}, ${formatCoordinate(record.centroidLon)}`,
    },
    {
      title: tAdmin.tableProperties,
      dataIndex: "properties",
      render: (value) => {
        const text = JSON.stringify(value || {});
        return (
          <Typography.Text
            ellipsis={{ tooltip: text }}
            style={{ maxWidth: 420, display: "inline-block" }}
          >
            {text}
          </Typography.Text>
        );
      },
    },
    {
      title: tAdmin.tableActions,
      key: "action",
      width: 200,
      render: (_value, record) => (
        <Space>
          <Button size="small" onClick={() => openEditFeatureModal(record)}>
            {tAdmin.tableEdit}
          </Button>
          <Popconfirm
            title={tAdmin.confirmDeleteFeature}
            onConfirm={() => removeFeature(record)}
          >
            <Button size="small" danger>
              {tAdmin.tableDelete}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const coordinateColumns: ColumnsType<AdminSpeciesCoordinateItem> = [
    {
      title: tAdmin.tableId,
      dataIndex: "coordinateId",
      width: 100,
    },
    {
      title: tAdmin.tableFeatureId,
      dataIndex: "featureId",
      width: 110,
    },
    {
      title: tAdmin.tableGeomType,
      dataIndex: "geomType",
      width: 140,
    },
    {
      title: tAdmin.tablePartIndex,
      dataIndex: "partIndex",
      width: 110,
    },
    {
      title: tAdmin.tableRingIndex,
      dataIndex: "ringIndex",
      width: 110,
    },
    {
      title: tAdmin.tablePointOrder,
      dataIndex: "pointOrder",
      width: 120,
    },
    {
      title: tAdmin.tableLatitude,
      dataIndex: "lat",
      width: 150,
      render: (value) => formatCoordinate(value),
    },
    {
      title: tAdmin.tableLongitude,
      dataIndex: "lon",
      width: 150,
      render: (value) => formatCoordinate(value),
    },
    {
      title: tAdmin.tableActions,
      key: "action",
      width: 200,
      render: (_value, record) => (
        <Space>
          <Button size="small" onClick={() => openEditCoordinateModal(record)}>
            {tAdmin.tableEdit}
          </Button>
          <Popconfirm
            title={tAdmin.confirmDeleteCoordinate}
            onConfirm={() => removeCoordinate(record)}
          >
            <Button size="small" danger>
              {tAdmin.tableDelete}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  async function handleDownloadGeoJson() {
    if (Number.isNaN(numericSpeciesId)) return;

    try {
      setDownloading(true);
      const geojson = await getAdminSpeciesGeoJson(numericSpeciesId, language);
      const blob = new Blob([JSON.stringify(geojson, null, 2)], {
        type: "application/geo+json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${species?.slug || `species-${numericSpeciesId}`}.geojson`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message.success(tAdmin.geoJsonDownloaded);
    } catch (error: any) {
      message.error(error.message || tAdmin.cannotDownloadGeoJson);
    } finally {
      setDownloading(false);
    }
  }

  if (Number.isNaN(numericSpeciesId)) {
    return (
      <Layout
        style={{ minHeight: "100vh", padding: 16, background: "#f3f4f6" }}
      >
        <Card>
          <Typography.Title level={4}>
            {tAdmin.invalidSpeciesId}
          </Typography.Title>
          <Button onClick={() => navigate("/admin")}>
            {tAdmin.backToAdmin}
          </Button>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh", padding: 16, background: "#f3f4f6" }}>
      <Card style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {tAdmin.speciesDetailPageTitle}
            </Typography.Title>
            <Typography.Text type="secondary">
              {species?.commonNameVi ||
                species?.commonName ||
                `#${numericSpeciesId}`}
              {species?.commonNameEn ? ` / ${species.commonNameEn}` : ""}
            </Typography.Text>
          </div>

          <Space wrap>
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
            <Button onClick={() => navigate("/admin")}>
              {tAdmin.backToAdmin}
            </Button>
            <Button
              type="primary"
              loading={downloading}
              onClick={handleDownloadGeoJson}
            >
              {tAdmin.downloadGeoJson}
            </Button>
          </Space>
        </Space>
      </Card>

      <Card style={{ marginBottom: 16 }} loading={loading}>
        <Descriptions title={tAdmin.speciesDetailCardTitle} bordered column={2}>
          <Descriptions.Item label={tAdmin.tableId}>
            {species?.id || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={tAdmin.labelSlug}>
            {species?.slug || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={tAdmin.labelCommonNameVi}>
            {species?.commonNameVi || species?.commonName || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={tAdmin.labelCommonNameEn}>
            {species?.commonNameEn || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={tAdmin.labelScientificName}>
            {species?.scientificName || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={tAdmin.labelCategory}>
            {species?.category || "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title={tAdmin.featureSummaryTitle}
        style={{ marginBottom: 16 }}
        extra={
          <Button onClick={openCreateFeatureModal}>{tAdmin.addFeature}</Button>
        }
      >
        <Table
          columns={featureColumns}
          dataSource={featureSummary}
          rowKey={(record) => String(record.featureId)}
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Card
        title={tAdmin.positionsTableTitle}
        extra={
          <Button type="primary" onClick={openCreateCoordinateModal}>
            {tAdmin.addCoordinate}
          </Button>
        }
      >
        <Table
          columns={coordinateColumns}
          dataSource={coordinates}
          rowKey={(record) => String(record.coordinateId)}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total: coordinateTotal,
            showSizeChanger: true,
            pageSizeOptions: ["100", "200", "500", "1000"],
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
                return;
              }
              setPage(nextPage);
            },
          }}
          scroll={{ x: 1400, y: 460 }}
        />
      </Card>

      <Modal
        title={editingFeature ? tAdmin.editFeature : tAdmin.addFeature}
        open={featureModalOpen}
        onCancel={() => {
          setFeatureModalOpen(false);
          setEditingFeature(null);
        }}
        onOk={() => featureForm.submit()}
        okButtonProps={{ loading: featureModalSaving }}
      >
        <Form form={featureForm} layout="vertical" onFinish={submitFeature}>
          <Form.Item
            name="geomType"
            label={tAdmin.labelGeomType}
            rules={[
              { required: true, message: tAdmin.validationGeomTypeRequired },
            ]}
          >
            <Select
              options={GEOM_TYPE_OPTIONS.map((value) => ({
                label: value,
                value,
              }))}
            />
          </Form.Item>

          <Form.Item name="propertiesText" label={tAdmin.labelPropertiesJson}>
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingCoordinate ? tAdmin.editCoordinate : tAdmin.addCoordinate}
        open={coordinateModalOpen}
        onCancel={() => {
          setCoordinateModalOpen(false);
          setEditingCoordinate(null);
        }}
        onOk={() => coordinateForm.submit()}
        okButtonProps={{ loading: coordinateModalSaving }}
      >
        <Form
          form={coordinateForm}
          layout="vertical"
          onFinish={submitCoordinate}
        >
          <Form.Item
            name="featureId"
            label={tAdmin.labelFeatureId}
            rules={[
              { required: true, message: tAdmin.validationFeatureIdRequired },
            ]}
          >
            <Select options={featureOptions} />
          </Form.Item>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Form.Item
              name="partIndex"
              label={tAdmin.tablePartIndex}
              rules={[
                { required: true, message: tAdmin.validationPartIndexRequired },
                {
                  validator: (_rule, value) => {
                    if (value === undefined || value === null) {
                      return Promise.resolve();
                    }
                    if (isNonNegativeInteger(Number(value))) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(tAdmin.validationCoordinateIndexNonNegative),
                    );
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                step={1}
                precision={0}
              />
            </Form.Item>

            <Form.Item
              name="ringIndex"
              label={tAdmin.tableRingIndex}
              rules={[
                { required: true, message: tAdmin.validationRingIndexRequired },
                {
                  validator: (_rule, value) => {
                    if (value === undefined || value === null) {
                      return Promise.resolve();
                    }
                    if (isNonNegativeInteger(Number(value))) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(tAdmin.validationCoordinateIndexNonNegative),
                    );
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                step={1}
                precision={0}
              />
            </Form.Item>

            <Form.Item
              name="pointOrder"
              label={tAdmin.tablePointOrder}
              rules={[
                {
                  required: true,
                  message: tAdmin.validationPointOrderRequired,
                },
                {
                  validator: (_rule, value) => {
                    if (value === undefined || value === null) {
                      return Promise.resolve();
                    }
                    if (isNonNegativeInteger(Number(value))) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(tAdmin.validationCoordinateIndexNonNegative),
                    );
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                step={1}
                precision={0}
              />
            </Form.Item>

            <Form.Item
              name="lon"
              label={tAdmin.tableLongitude}
              rules={[
                { required: true, message: tAdmin.validationLongitudeRequired },
                {
                  validator: (_rule, value) => {
                    if (value === undefined || value === null) {
                      return Promise.resolve();
                    }
                    const lon = Number(value);
                    if (lon >= -180 && lon <= 180) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(tAdmin.validationLongitudeRange),
                    );
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                step={0.000001}
                min={-180}
                max={180}
              />
            </Form.Item>

            <Form.Item
              name="lat"
              label={tAdmin.tableLatitude}
              rules={[
                { required: true, message: tAdmin.validationLatitudeRequired },
                {
                  validator: (_rule, value) => {
                    if (value === undefined || value === null) {
                      return Promise.resolve();
                    }
                    const lat = Number(value);
                    if (lat >= -90 && lat <= 90) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(tAdmin.validationLatitudeRange),
                    );
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                step={0.000001}
                min={-90}
                max={90}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </Layout>
  );
}
