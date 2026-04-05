import { Navigate, Outlet, useLocation } from "react-router-dom";
import { isAdminLoggedIn } from "../lib/adminAuth";

export default function RequireAdminRoute() {
  const location = useLocation();

  if (!isAdminLoggedIn()) {
    return (
      <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
    );
  }

  return <Outlet />;
}
