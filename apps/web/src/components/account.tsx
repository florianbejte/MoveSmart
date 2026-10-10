"use client";

import { api } from "@MoveSmart/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { createContext, useContext, useEffect, useState } from "react";
import {
	loadProfile,
	type Profile,
	saveProfile as saveLocal,
} from "@/lib/plan/profile";

export type Place = { name: string; lat: number; lon: number };
export type Account = {
	/** Accounts are configured (Convex reachable); otherwise everyone is a guest. */
	enabled: boolean;
	status: "loading" | "guest" | "signed-in";
	name?: string;
	/** undefined while loading, null when onboarding hasn't been done. */
	profile: Profile | null | undefined;
	saveProfile: (profile: Profile) => Promise<void>;
	places: Place[];
	rememberPlace: (place: Place) => void;
	/** CO₂ the rider avoided by choosing green trips. */
	impact: Impact;
	logGreenTrip: (mode: string, co2Saved: number) => void;
};
export type Impact = { grams: number; trips: number };

const AccountContext = createContext<Account | null>(null);
export function useAccount() {
	const account = useContext(AccountContext);
	if (!account) throw new Error("useAccount needs an account provider");
	return account;
}

/** Guests keep their CO₂ savings in this browser; a repeat within 10 minutes counts once. */
function useLocalImpact() {
	const [impact, setImpact] = useState<Impact & { last?: number }>({
		grams: 0,
		trips: 0,
	});
	useEffect(() => {
		try {
			const raw = localStorage.getItem("movesmart-impact");
			if (raw) setImpact(JSON.parse(raw));
		} catch {}
	}, []);
	return {
		impact,
		log: (_mode: string, co2Saved: number) =>
			setImpact((old) => {
				const now = Date.now();
				const repeat = old.last && now - old.last < 10 * 60_000;
				const next = {
					grams: old.grams + (repeat ? 0 : Math.max(0, co2Saved)),
					trips: old.trips + (repeat ? 0 : 1),
					last: now,
				};
				try {
					localStorage.setItem("movesmart-impact", JSON.stringify(next));
				} catch {}
				return next;
			}),
	};
}

/** Guests keep their profile in this browser. */
function useLocalProfile() {
	const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
	useEffect(() => setProfile(loadProfile()), []);
	return {
		profile,
		save: async (p: Profile) => {
			saveLocal(p);
			setProfile(p);
		},
	};
}

export function LocalAccountProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const local = useLocalProfile();
	const impact = useLocalImpact();
	return (
		<AccountContext.Provider
			value={{
				impact: impact.impact,
				logGreenTrip: impact.log,
				enabled: false,
				status: "guest",
				profile: local.profile,
				saveProfile: local.save,
				places: [],
				rememberPlace: () => {},
			}}
		>
			{children}
		</AccountContext.Provider>
	);
}

/** Signed-in users keep their travel profile and recent places in Convex. */
export function ConvexAccountProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const auth = useConvexAuth();
	const signedIn = auth.isAuthenticated;
	const user = useQuery(api.auth.getCurrentUser, signedIn ? {} : "skip");
	const remote = useQuery(api.travel.profile, signedIn ? {} : "skip");
	const places = useQuery(api.travel.recentPlaces, signedIn ? {} : "skip");
	const save = useMutation(api.travel.saveProfile);
	const remember = useMutation(api.travel.rememberPlace);
	const local = useLocalProfile();
	const localImpact = useLocalImpact();
	const remoteImpact = useQuery(api.travel.impact, signedIn ? {} : "skip");
	const logRemote = useMutation(api.travel.logGreenTrip);
	const status = auth.isLoading ? "loading" : signedIn ? "signed-in" : "guest";
	return (
		<AccountContext.Provider
			value={{
				enabled: true,
				status,
				name: user?.name,
				profile:
					status === "signed-in"
						? remote
						: status === "guest"
							? local.profile
							: undefined,
				saveProfile: async (profile) => {
					// Also keep a local copy so the same browser is personalised after sign-out.
					await local.save(profile);
					if (signedIn) await save({ profile });
				},
				places: places ?? [],
				rememberPlace: (place) => {
					if (signedIn) void remember(place);
				},
				impact: signedIn
					? (remoteImpact ?? { grams: 0, trips: 0 })
					: localImpact.impact,
				logGreenTrip: (mode, co2Saved) => {
					if (signedIn) void logRemote({ mode, co2Saved });
					else localImpact.log(mode, co2Saved);
				},
			}}
		>
			{children}
		</AccountContext.Provider>
	);
}
