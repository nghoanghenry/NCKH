export interface AdminUser {
  id: number;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  role?: "ADMIN" | "CONTRIBUTOR" | "USER";
}

const TOKEN_KEY = "nckh_admin_token";
const USER_KEY = "nckh_admin_user";

export function saveAdminSession(token: string, user: AdminUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAdminSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminUser(): AdminUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AdminUser;
  } catch (_error) {
    return null;
  }
}

export function isAdminLoggedIn() {
  const user = getAdminUser();
  const token = getAdminToken();
  return !!token && !!user;
}
