import { getAuthServer } from "@/lib/auth-server";

export async function GET(request: Request) {
	const auth = getAuthServer();
	return auth
		? auth.handler.GET(request)
		: Response.json({ error: "Accounts are not configured." }, { status: 503 });
}
export async function POST(request: Request) {
	const auth = getAuthServer();
	return auth
		? auth.handler.POST(request)
		: Response.json({ error: "Accounts are not configured." }, { status: 503 });
}
