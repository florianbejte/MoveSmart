import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { ENV } from "../env";

export function getAuthServer() {
	const convexUrl = ENV.NEXT_PUBLIC_CONVEX_URL;
	const convexSiteUrl = ENV.NEXT_PUBLIC_CONVEX_SITE_URL;
	if (
		!convexUrl ||
		!convexSiteUrl ||
		/https?:\/\/example\.convex\./.test(convexUrl) ||
		/https?:\/\/example\.convex\./.test(convexSiteUrl)
	)
		return null;
	return convexBetterAuthNextJs({ convexUrl, convexSiteUrl });
}
