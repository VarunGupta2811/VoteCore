const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");

export async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const body = options.body;

  if (body !== undefined && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && path !== "/api/auth/logout") {
    const csrfToken = localStorage.getItem("votingCsrfToken");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const separator = path.includes("?") ? "&" : "?";
  const url = `${API_URL}${path}${method === "GET" ? `${separator}_t=${Date.now()}` : ""}`;
  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "include",
    body: body !== undefined && typeof body !== "string" && !(body instanceof FormData)
      ? JSON.stringify(body)
      : body
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }
  return { data, response };
}

export async function downloadFile(path, filename) {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const data = contentType.includes("application/json") ? await response.json() : null;
    throw new Error(data?.error || `Download failed (${response.status}).`);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function saveUser(user, csrfToken) {
  if (csrfToken) localStorage.setItem("votingCsrfToken", csrfToken);
  if (user) localStorage.setItem("votingUser", JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem("votingUser");
  localStorage.removeItem("votingCsrfToken");
}
