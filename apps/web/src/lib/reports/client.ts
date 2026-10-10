export async function submitCommunity(body: unknown) {
	const response = await fetch("/api/reports", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15000),
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error || "Could not save report.");
	return result;
}
