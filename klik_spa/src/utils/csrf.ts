const INVALID_CSRF_TOKENS = new Set(["", "None", "null", "undefined", "{{ csrf_token }}", "{{ frappe.session.csrf_token }}"]);

export function getCSRFToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = (window.csrf_token || "").trim();
  if (!token || INVALID_CSRF_TOKENS.has(token) || token.includes("{{")) return null;
  return token;
}
