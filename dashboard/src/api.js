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

export function fetchSetupStatus() {
  return request("/api/setup-status");
}

export function createFirstAccount(username, password) {
  return request("/api/setup", { method: "POST", body: JSON.stringify({ username, password }) });
}

function mapClient(c) {
  return {
    id: c.id,
    fileNo: c.file_no,
    company: c.company,
    roc: c.roc || "",
    yearEnd: c.year_end || "",
    dateInc: c.date_inc || "",
    registeredAddress: c.registered_address || "",
    directors: c.directors || "",
    lastAgmDate: c.last_agm_date || "",
    contact: c.contact || "",
    contactPhone: c.contact_phone || "",
    contactEmail: c.contact_email || "",
    fax: c.fax || "",
    status: c.status,
    // Report-page working fields — not auto-fetched (see the Report tab),
    // just notes staff keep updated.
    acraStatus: c.acra_status || "Not checked",
    taxNotes: c.tax_notes || "",
    pendingWork: c.pending_work || "",
    // The client company's own annual revenue — a manual KYC/portfolio data
    // point, not Jardeen's own billing/fee income.
    annualRevenue: c.annual_revenue !== null && c.annual_revenue !== undefined ? Number(c.annual_revenue) : null,
  };
}

function mapDocument(d) {
  return {
    // "document" unless the scan-lookup fell back to a client folder label
    // (its QR encodes the client's file number, not a document code) —
    // the scan tab uses this to know which fields/actions make sense.
    resultType: d.result_type || "document",
    id: d.id,
    code: d.code,
    clientId: d.client_id,
    client: d.client_name,
    clientFileNo: d.client_file_no,
    clientStatus: d.client_status,
    category: d.category,
    serviceDetail: d.service_detail || "",
    location: d.location,
    dateReceived: d.date_received,
    loggedBy: d.logged_by,
    status: d.status,
    isBatch: !!d.is_batch,
    batchCount: d.batch_count || null,
    // Present only on the scan-lookup response — the company snapshot a
    // handheld scanner needs, since it's usually used away from the register UI.
    clientRoc: d.client_roc || "",
    clientRegisteredAddress: d.client_registered_address || "",
    clientDirectors: d.client_directors || "",
    clientLastAgmDate: d.client_last_agm_date || "",
    clientContactName: d.client_contact_name || "",
    clientContactPhone: d.client_contact_phone || "",
    clientContactEmail: d.client_contact_email || "",
    clientFax: d.client_fax || "",
  };
}

function mapEditLogEntry(l) {
  return {
    id: l.id,
    field: l.field,
    oldValue: l.old_value,
    newValue: l.new_value,
    changedBy: l.changed_by,
    changedAt: (l.changed_at || "").replace("T", " ").slice(0, 16),
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

export async function createClient({
  fileNo,
  company,
  roc,
  yearEnd,
  dateInc,
  registeredAddress,
  directors,
  contact,
  contactPhone,
  contactEmail,
  fax,
  status,
}) {
  const row = await request("/api/clients", {
    method: "POST",
    body: JSON.stringify({ fileNo, company, roc, yearEnd, dateInc, registeredAddress, directors, contact, contactPhone, contactEmail, fax, status }),
  });
  return mapClient(row);
}

export async function updateClient(id, patch) {
  const row = await request(`/api/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return mapClient(row);
}

export async function updateClientReportFields(id, patch) {
  const row = await request(`/api/clients/${id}/report-fields`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return mapClient(row);
}

function mapSchedule(s) {
  return {
    id: s.id,
    clientId: s.client_id,
    client: s.client_name,
    clientFileNo: s.client_file_no,
    clientStatus: s.client_status,
    taskName: s.task_name,
    frequency: s.frequency,
    dueDay: s.due_day,
    dueMonth: s.due_month,
    lastCompletedDate: s.last_completed_date,
  };
}

export async function fetchAllSchedules() {
  const rows = await request("/api/schedules");
  return rows.map(mapSchedule);
}

export async function fetchClientSchedules(clientId) {
  const rows = await request(`/api/clients/${clientId}/schedules`);
  return rows.map(mapSchedule);
}

export async function createSchedule(clientId, { taskName, frequency, dueDay, dueMonth }) {
  const row = await request(`/api/clients/${clientId}/schedules`, {
    method: "POST",
    body: JSON.stringify({ taskName, frequency, dueDay, dueMonth }),
  });
  return mapSchedule(row);
}

export async function updateSchedule(id, patch) {
  const row = await request(`/api/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return mapSchedule(row);
}

export function deleteSchedule(id) {
  return request(`/api/schedules/${id}`, { method: "DELETE" });
}

export async function fetchClientEditLog(id) {
  const rows = await request(`/api/clients/${id}/edit-log`);
  return rows.map(mapEditLogEntry);
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

export async function createDocument({ clientId, category, serviceDetail, location, dateReceived, loggedBy, isAgmFiling, isBatch, batchCount }) {
  const row = await request("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      category,
      serviceDetail,
      location,
      dateReceived,
      loggedBy,
      isAgmFiling,
      isBatch,
      batchCount,
    }),
  });
  return mapDocument(row);
}

export async function createBatchIntake({ clientId, location, dateReceived, loggedBy, batchCount, items, isAgmFiling }) {
  const rows = await request("/api/documents/batch-intake", {
    method: "POST",
    body: JSON.stringify({ clientId, location, dateReceived, loggedBy, batchCount, items, isAgmFiling }),
  });
  return rows.map(mapDocument);
}

export async function toggleCheckout(documentId) {
  const row = await request(`/api/documents/${documentId}/toggle-checkout`, { method: "POST" });
  return mapDocument(row);
}

export function printDocumentLabel(documentId) {
  return request(`/api/documents/${documentId}/print`, { method: "POST" });
}

export function printClientFolderLabel(clientId) {
  return request(`/api/clients/${clientId}/print-folder-label`, { method: "POST" });
}

function mapDocumentFile(f) {
  return {
    id: f.id,
    documentId: f.document_id,
    filename: f.filename,
    mimeType: f.mime_type,
    sizeBytes: f.size_bytes,
    uploadedBy: f.uploaded_by,
    uploadedAt: (f.uploaded_at || "").replace("T", " ").slice(0, 16),
  };
}

export async function fetchDocumentFiles(documentId) {
  const rows = await request(`/api/documents/${documentId}/files`);
  return rows.map(mapDocumentFile);
}

// Multipart upload — can't go through the shared `request()` helper since
// that always sends JSON; FormData needs the browser to set its own
// Content-Type (with the multipart boundary) instead.
export async function uploadDocumentFile(documentId, file) {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", file);
  let res;
  try {
    res = await fetch(`${API_URL}/api/documents/${documentId}/files`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
  } catch {
    throw new ApiError("Can't reach the server — is it running on " + API_URL + "?", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, res.status);
  return mapDocumentFile(data);
}

export function deleteDocumentFile(fileId) {
  return request(`/api/files/${fileId}`, { method: "DELETE" });
}

// Fetches the file as a blob (carrying the auth header a plain <a href>
// can't send) and opens it in a new tab — works for PDFs/images inline,
// and downloads for types the browser can't render.
export async function openDocumentFile(fileId, filename) {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/files/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(`Could not open ${filename || "file"} (${res.status})`, res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function fetchAccessLog() {
  const rows = await request("/api/access-log");
  return rows.map(mapLogEntry);
}

export { ApiError };
