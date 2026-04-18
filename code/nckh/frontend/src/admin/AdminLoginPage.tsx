import { useMemo, useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { adminLogin } from "../lib/adminApi";
import vn from "../i18n/vn";
import en from "../i18n/en";

type Language = "vn" | "en";

interface AdminLoginPageProps {
  language: Language;
  onLanguageChange: (language: Language) => void;
}

export default function AdminLoginPage({
  language,
  onLanguageChange,
}: AdminLoginPageProps) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();
  const dict = useMemo(() => (language === "en" ? en : vn), [language]);
  const t = dict.adminLogin;

  const from = (location.state as any)?.from || "/admin";

  async function onFinish(values: { email: string; password: string }) {
    try {
      setLoading(true);
      await adminLogin(values.email, values.password);
      message.success(t.loginSuccess);
      navigate(from, { replace: true });
    } catch (error: any) {
      const msg = error.message;
      if (msg === "__INVALID_CREDENTIALS__" || msg === "Invalid credentials") {
        message.error(t.loginFailed);
      } else if (msg === "__FORBIDDEN__") {
        message.error(t.forbidden);
      } else {
        message.error(msg || t.loginFailed);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #edf2f7 0%, #e2e8f0 100%)",
        padding: 16,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 420, borderRadius: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 13, color: "#4b5563" }}>
            {dict.admin.languageLabel}:
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
        </div>
        <Typography.Title level={3} style={{ marginBottom: 8 }}>
          {t.title}
        </Typography.Title>
        <Typography.Text type="secondary">{t.subtitle}</Typography.Text>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          style={{ marginTop: 24 }}
          initialValues={{
            email: "admin@nckh.local",
            password: "",
          }}
        >
          <Form.Item
            name="email"
            label={t.email}
            rules={[{ required: true, type: "email" }]}
          >
            <Input placeholder="admin@nckh.local" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t.password}
            rules={[{ required: true, min: 6 }]}
          >
            <Input.Password placeholder={t.passwordPlaceholder} />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={loading} block>
            {t.submit}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
