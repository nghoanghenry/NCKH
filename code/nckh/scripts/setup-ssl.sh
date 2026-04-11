#!/usr/bin/env bash
# =============================================================================
# setup-ssl.sh — Thiết lập SSL/HTTPS tự động với Let's Encrypt
# =============================================================================
# Sử dụng: ./scripts/setup-ssl.sh <domain> <email>
# Ví dụ:   ./scripts/setup-ssl.sh example.com admin@example.com
#
# Script này sẽ:
#   1. Dừng nginx (giải phóng cổng 80)
#   2. Xin certificate từ Let's Encrypt (certbot standalone)
#   3. Tạo file cấu hình Nginx SSL (infra/nginx/ssl.conf)
#   4. Cập nhật .env để trỏ vào SSL config
#   5. Khởi động lại nginx với HTTPS
#
# Gia hạn tự động: Thêm cron job sau khi chạy script này (xem cuối output).
# =============================================================================

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Sử dụng: $0 <domain> <email>"
  echo "Ví dụ:   $0 example.com admin@example.com"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "======================================================"
echo "  NCKH — Thiết lập SSL/HTTPS với Let's Encrypt"
echo "  Domain  : $DOMAIN"
echo "  Email   : $EMAIL"
echo "  Thư mục : $PROJECT_ROOT"
echo "======================================================"
echo ""

# ── Kiểm tra prerequisites ─────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[LỖI] Không tìm thấy file .env"
  echo "      Hãy tạo .env từ backend/.env.example trước:"
  echo "      cp backend/.env.example .env && nano .env"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "[LỖI] Docker chưa được cài đặt."
  exit 1
fi

# ── 1. Tạo thư mục certbot ─────────────────────────────────
echo "[1/5] Tạo thư mục certbot..."
mkdir -p ./infra/certbot/conf ./infra/certbot/www

# ── 2. Dừng nginx để giải phóng cổng 80 ───────────────────
echo "[2/5] Dừng nginx (giải phóng cổng 80)..."
docker compose stop nginx 2>/dev/null || true
sleep 2

# ── 3. Xin certificate từ Let's Encrypt ───────────────────
echo "[3/5] Xin certificate từ Let's Encrypt (standalone mode)..."
echo "      Yêu cầu: domain ${DOMAIN} phải đã trỏ về IP của VPS này."
echo ""

docker run --rm \
  -p 80:80 \
  -v "$(pwd)/infra/certbot/conf:/etc/letsencrypt" \
  certbot/certbot certonly \
    --standalone \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    -d "$DOMAIN"

echo ""
echo "      Certificate được cấp thành công!"

# ── 4. Tạo cấu hình Nginx SSL ──────────────────────────────
echo "[4/5] Tạo cấu hình Nginx SSL (infra/nginx/ssl.conf)..."

cat > ./infra/nginx/ssl.conf << NGINX_CONF
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  '' close;
}

limit_req_zone \$binary_remote_addr zone=auth_limit:10m rate=10r/m;

# ── HTTP: ACME challenge + redirect sang HTTPS ─────────────
server {
  listen 80;
  server_name ${DOMAIN};

  server_tokens off;

  # Let's Encrypt renewal webroot challenge
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
  }

  # Redirect tất cả traffic HTTP sang HTTPS
  location / {
    return 301 https://\$host\$request_uri;
  }
}

# ── HTTPS ──────────────────────────────────────────────────
server {
  listen 443 ssl;
  server_name ${DOMAIN};

  server_tokens off;
  client_max_body_size 20m;

  # Chứng chỉ SSL do Certbot quản lý
  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

  # TLS hiện đại — chỉ TLS 1.2 và 1.3
  ssl_protocols             TLSv1.2 TLSv1.3;
  ssl_ciphers               ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
  ssl_prefer_server_ciphers off;
  ssl_session_cache         shared:SSL:10m;
  ssl_session_timeout       1d;
  ssl_session_tickets       off;

  # HSTS — bỏ comment sau khi xác nhận SSL ổn định (không thể hoàn tác dễ dàng)
  # add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

  # Security headers
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

  # Chặn các path tấn công phổ biến
  location ~* ^/(cgi-bin|vendor|phpunit|wp-admin|wp-login\\.php|xmlrpc\\.php|\\.env|\\.git|\\.svn|\\.DS_Store|boaform|HNAP1|actuator|manager/html) {
    return 404;
  }

  # Rate limit cho login endpoint
  location = /api/auth/login {
    limit_req zone=auth_limit burst=10 nodelay;
    proxy_pass http://backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /api/ {
    proxy_pass http://backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /uploads/ {
    proxy_pass http://backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    proxy_pass http://frontend:4173;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
  }
}
NGINX_CONF

echo "      Đã tạo: infra/nginx/ssl.conf"

# ── 5. Cập nhật .env ───────────────────────────────────────
echo "[5/5] Cập nhật .env..."

update_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

update_env "NGINX_CONF"   "./infra/nginx/ssl.conf"
update_env "NGINX_DOMAIN" "$DOMAIN"

# Thêm https domain vào CORS_ORIGIN nếu chưa có
if grep -q "^CORS_ORIGIN=" .env; then
  CURRENT_CORS=$(grep "^CORS_ORIGIN=" .env | cut -d= -f2-)
  if ! echo "$CURRENT_CORS" | grep -q "https://${DOMAIN}"; then
    update_env "CORS_ORIGIN" "https://${DOMAIN},${CURRENT_CORS}"
  fi
fi

echo "      .env đã được cập nhật."

# ── Khởi động lại nginx với SSL ────────────────────────────
echo ""
echo "Khởi động Nginx với cấu hình SSL..."
docker compose up -d nginx

# Chờ nginx khởi động
sleep 3

echo ""
echo "======================================================"
echo "  SSL Setup Hoàn Tất!"
echo ""
echo "  Website : https://${DOMAIN}"
echo "  Admin   : https://${DOMAIN}/admin/login"
echo ""
echo "  Chứng chỉ lưu tại:"
echo "    ./infra/certbot/conf/live/${DOMAIN}/"
echo ""
echo "  ── Gia hạn tự động ────────────────────────────────"
echo "  Thêm cron job sau (crontab -e):"
echo ""
echo "  # Gia hạn chứng chỉ SSL mỗi thứ 2 lúc 3h sáng"
echo "  0 3 * * 1 cd ${PROJECT_ROOT} && docker compose run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker compose exec nginx nginx -s reload >> /var/log/certbot-renew.log 2>&1"
echo ""
echo "  ── Kiểm tra cấu hình SSL ──────────────────────────"
echo "  https://www.ssllabs.com/ssltest/analyze.html?d=${DOMAIN}"
echo ""
echo "  ── Kích hoạt HSTS (sau khi SSL ổn định) ───────────"
echo "  Bỏ comment dòng Strict-Transport-Security trong:"
echo "  infra/nginx/ssl.conf, sau đó: docker compose exec nginx nginx -s reload"
echo "======================================================"
