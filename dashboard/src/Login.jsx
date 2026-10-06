import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { login, saveSession, createFirstAccount } from "./api.js";
import { Wallpaper, glassPanel, BRAND_GREEN, BRAND_GREEN_DEEP } from "./theme.jsx";

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await login(username.trim(), password);
      saveSession(res.token, { username: res.username, role: res.role });
      onLoggedIn({ username: res.username, role: res.role });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <Wallpaper />
      <form
        onSubmit={submit}
        style={{
          ...glassPanel(0.68, 22),
          padding: "36px 32px",
          width: 360,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 6 }}>
          <img
            src="/jardeen-logo.png"
            alt=""
            style={{ width: 56, height: 56, objectFit: "contain", marginBottom: 10 }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700, color: "#1C2430", letterSpacing: 0.3 }}>
            JARDEEN MANAGEMENT
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Lock size={12} color={BRAND_GREEN} />
            <div style={{ fontSize: 12, color: "#6B6656", letterSpacing: 0.4 }}>Financial Asset Register</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#6B6656", marginBottom: 6 }}>Log in to continue.</div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {error && (
          <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 6,
            background: BRAND_GREEN_DEEP,
            color: "#EDEAE2",
            border: "none",
            padding: "10px 16px",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}

// Shown once, only when this install's database has zero user accounts —
// a fresh desktop install has no terminal access for the client to run a
// setup script, so this is the only way they ever get a first login.
export function FirstRunSetup({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    if (!username.trim() || !password) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await createFirstAccount(username.trim(), password);
      saveSession(res.token, { username: res.username, role: res.role });
      onLoggedIn({ username: res.username, role: res.role });
    } catch (err) {
      setError(err.message || "Couldn't create the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <Wallpaper />
      <form
        onSubmit={submit}
        style={{
          ...glassPanel(0.68, 22),
          padding: "36px 32px",
          width: 380,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 6 }}>
          <img
            src="/jardeen-logo.png"
            alt=""
            style={{ width: 56, height: 56, objectFit: "contain", marginBottom: 10 }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700, color: "#1C2430", letterSpacing: 0.3 }}>
            JARDEEN MANAGEMENT
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <ShieldCheck size={12} color={BRAND_GREEN} />
            <div style={{ fontSize: 12, color: "#6B6656", letterSpacing: 0.4 }}>Financial Asset Register</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#6B6656", marginBottom: 6 }}>
          This is a brand-new install — create the first admin account to get started. You can add more staff logins later from the Users tab.
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {error && (
          <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 6,
            background: BRAND_GREEN_DEEP,
            color: "#EDEAE2",
            border: "none",
            padding: "10px 16px",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Creating account…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}

const inputStyle = {
  border: "1px solid #C9C4B6",
  background: "#fff",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "'Inter', sans-serif",
  color: "#1C2430",
};
