const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const TOKEN_KEY = "fams_token";
const USER_KEY = "fams_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError("Can't reach the server — is it running on " + API_URL + "?", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data;
}

export function login(username, password) {
  return request("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

function mapClient(c) {
  return {
    id: c.id,
    fileNo: c.file_no,
    company: c.company,
    roc: c.roc || "",
    yearEnd: c.year_end || "",
    dateInc: c.date_inc || "",
    contact: c.contact || "",
    status: c.status,
  };
}

function mapDocument(d) {
  return {
    id: d.id,
    code: d.code,
    clientId: d.client_id,
    client: d.client_name,
    clientFileNo: d.client_file_no,
    category: d.category,
    serviceDetail: d.service_detail || "",
    location: d.location,
    dateReceived: d.date_received,
    loggedBy: d.logged_by,
    status: d.status,
  };
}

function mapLogEntry(l) {
  return {
    id: l.id,
    code: l.code,
    client: l.client_name,
    action: l.action,
    user: l.staff,
    time: (l.logged_at || "").replace("T", " ").slice(0, 16),
  };
}

export async function fetchClients() {
  const rows = await request("/api/clients");
  return rows.map(mapClient);
}

export async function fetchDocuments(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString();
  const rows = await request(`/api/documents${qs ? `?${qs}` : ""}`);
  return rows.map(mapDocument);
}

export async function lookupDocument(code) {
  const row = await request(`/api/documents/lookup/${encodeURIComponent(code)}`);
  return mapDocument(row);
}

export async function createDocument({ clientId, category, serviceDetail, location, dateReceived, loggedBy }) {
  const row = await request("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      category,
      serviceDetail,
      location,
      dateReceived,
      loggedBy,
    }),
  });
  return mapDocument(row);
}

export async function toggleCheckout(documentId) {
  const row = await request(`/api/documents/${documentId}/toggle-checkout`, { method: "POST" });
  return mapDocument(row);
}

export async function fetchAccessLog() {
  const rows = await request("/api/access-log");
  return rows.map(mapLogEntry);
}

export { ApiError };
