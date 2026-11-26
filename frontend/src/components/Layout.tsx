import { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { homeFor, useAuth } from "../auth";

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="CertChain, начало">
      <img src="/seal.svg" alt="" width={28} height={28} />
      <span>CertChain</span>
    </Link>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="public">
      <header className="public-bar">
        <Brand />
        <nav>
          <NavLink to="/verify" end>Проверка</NavLink>
          {user ? <Link to={homeFor(user.role)} className="btn btn-quiet">Моят профил</Link> : <Link to="/login" className="btn btn-quiet">Вход</Link>}
        </nav>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-foot">
        Дипломен проект. Сертификатите се проверяват спрямо записи в Ethereum-съвместима мрежа.
      </footer>
    </div>
  );
}

const ROLE_LABEL = { ADMIN: "Администратор", ISSUER: "Издател", HOLDER: "Притежател" } as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="shell">
      <aside className="side">
        <Brand />
        <nav className="side-nav">
          {user.role === "ISSUER" && (
            <>
              <NavLink to="/issuer" end>Издадени сертификати</NavLink>
              <NavLink to="/issuer/new">Нов сертификат</NavLink>
            </>
          )}
          {user.role === "HOLDER" && <NavLink to="/my">Моите сертификати</NavLink>}
          {user.role === "ADMIN" && <NavLink to="/admin">Табло</NavLink>}
          <NavLink to="/verify">Публична проверка</NavLink>
        </nav>
        <div className="side-user">
          <div className="side-name">{user.fullName}</div>
          <div className="side-meta">{ROLE_LABEL[user.role]}{user.organizationName ? `, ${user.organizationName}` : ""}</div>
          <button
            className="btn btn-quiet btn-small"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Изход
          </button>
        </div>
      </aside>
      <main className="shell-main">{children}</main>
    </div>
  );
}
