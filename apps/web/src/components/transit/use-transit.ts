"use client";
import { useEffect, useState } from "react";

export function useTransit<T>(url: string | null, interval = 15_000) {
	const [revision, setRevision] = useState(0);
	const [state, setState] = useState<{
		url: string | null;
		data?: T;
		error?: string;
	}>({ url: null });
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit manual refresh trigger.
	useEffect(() => {
		if (!url) return;
		let cancelled = false;
		let inFlight = false;
		let timer: ReturnType<typeof setTimeout>;
		const controller = new AbortController();
		async function load() {
			if (cancelled || inFlight) return;
			if (document.hidden) {
				timer = setTimeout(load, interval);
				return;
			}
			inFlight = true;
			let nextInterval = interval;
			try {
				const response = await fetch(url as string, {
					signal: controller.signal,
				});
				if (!response.ok)
					throw new Error("Transit data is temporarily unavailable.");
				const data = (await response.json()) as T;
				if (!cancelled) setState({ url, data });
			} catch (error) {
				nextInterval = Math.min(interval, 15_000);
				if (!cancelled)
					setState((old) => ({
						url,
						data: old.url === url ? old.data : undefined,
						error:
							error instanceof Error
								? error.message
								: "Unable to load transit data.",
					}));
			} finally {
				inFlight = false;
				if (!cancelled) timer = setTimeout(load, nextInterval);
			}
		}

		const resume = () => {
			if (!document.hidden) {
				clearTimeout(timer);
				void load();
			}
		};
		document.addEventListener("visibilitychange", resume);
		void load();
		return () => {
			document.removeEventListener("visibilitychange", resume);
			cancelled = true;
			controller.abort();
			clearTimeout(timer);
		};
	}, [url, interval, revision]);
	return {
		data: state.url === url ? state.data : undefined,
		error: state.url === url ? state.error : undefined,
		retry: () => setRevision((v) => v + 1),
	};
}
