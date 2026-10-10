"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
	getLanguage,
	getServerLanguage,
	LANGUAGE_KEY,
	type Language,
	restoreLanguage,
	setLanguage,
	subscribeLanguage,
	translate,
} from "./core";
export function useLanguage() {
	return useSyncExternalStore(
		subscribeLanguage,
		getLanguage,
		getServerLanguage,
	);
}
export function useT() {
	const language = useLanguage();
	return useCallback(
		<T,>(value: T): T => translate(value, language),
		[language],
	);
}
export function LanguageSetup() {
	const language = useLanguage();
	useEffect(() => {
		restoreLanguage();
		const sync = (event: StorageEvent) => {
			if (event.key === LANGUAGE_KEY)
				setLanguage(event.newValue === "en" ? "en" : "lt");
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	return null;
}
export function LanguageSwitch() {
	const language = useLanguage();
	return (
		<label className="language-switch">
			<span className="sr-only">
				{language === "lt" ? "Kalba" : "Language"}
			</span>
			<select
				aria-label={language === "lt" ? "Kalba" : "Language"}
				value={language}
				onChange={(e) => setLanguage(e.target.value as Language)}
			>
				<option value="lt">LT</option>
				<option value="en">EN</option>
			</select>
		</label>
	);
}
