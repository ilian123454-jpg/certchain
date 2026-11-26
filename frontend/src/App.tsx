import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Role } from "./api";
import { useAuth } from "./auth";
import { AppShell, PublicShell } from "./components/Layout";
import VerifyPage from "./pages/VerifyPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import IssuerPage from "./pages/IssuerPage";
import IssueFormPage from "./pages/IssueFormPage";
import CertificatePage from "./pages/CertificatePage";
import HolderPage from "./pages/HolderPage";
import AdminPage from "./pages/AdminPage";

function Protected({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Зареждане…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicShell><VerifyPage /></PublicShell>} />
      <Route path="/verify" element={<PublicShell><VerifyPage /></PublicShell>} />
      <Route path="/verify/:id" element={<PublicShell><VerifyPage /></PublicShell>} />
      <Route path="/login" element={<PublicShell><LoginPage /></PublicShell>} />
      <Route path="/register" element={<PublicShell><RegisterPage /></PublicShell>} />
      <Route path="/issuer" element={<Protected roles={["ISSUER"]}><IssuerPage /></Protected>} />
      <Route path="/issuer/new" element={<Protected roles={["ISSUER"]}><IssueFormPage /></Protected>} />
      <Route path="/my" element={<Protected roles={["HOLDER"]}><HolderPage /></Protected>} />
      <Route path="/certificates/:id" element={<Protected roles={["ISSUER", "HOLDER", "ADMIN"]}><CertificatePage /></Protected>} />
      <Route path="/admin" element={<Protected roles={["ADMIN"]}><AdminPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
