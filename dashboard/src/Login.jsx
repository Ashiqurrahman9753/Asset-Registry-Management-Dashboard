import { useState } from "react";
import { Lock } from "lucide-react";
import { login, saveSession } from "./api.js";

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
        background: "#EDEAE2",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "#FBFAF6",
          border: "1px solid #C9C4B6",
          padding: "32px 28px",
          width: 340,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Lock size={18} color="#9C7A3C" />
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 700, color: "#1C2430" }}>
            Financial Asset Register
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
            background: "#1C2430",
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

const inputStyle = {
  border: "1px solid #C9C4B6",
  background: "#fff",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "'Inter', sans-serif",
  color: "#1C2430",
};
