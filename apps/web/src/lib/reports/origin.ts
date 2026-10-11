/** Check the browser origin against the original Host preserved by the proxy.
 * Next's request URL can use the internal HTTP listener behind TLS termination.
 * Do not trust arbitrary X-Forwarded-Host values supplied by clients.
 */
export function reportOrigin(request: Request): URL | null {
	const value = request.headers.get("origin");
	if (!value) return null;
	try {
		const origin = new URL(value);
		if (
			origin.origin !== value ||
			!["http:", "https:"].includes(origin.protocol)
		)
			return null;
		const internal = new URL(request.url);
		const host = request.headers.get("host") || internal.host;
		if (origin.host !== host) return null;
		// Never accept a downgrade from a direct HTTPS request.
		if (internal.protocol === "https:" && origin.protocol !== "https:")
			return null;
		return origin;
	} catch {
		return null;
	}
}
