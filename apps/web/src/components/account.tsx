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
};

const AccountContext = createContext<Account | null>(null);
export function useAccount() {
	const account = useContext(AccountContext);
	if (!account) throw new Error("useAccount needs an account provider");
	return account;
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
	return (
		<AccountContext.Provider
			value={{
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
			}}
		>
			{children}
		</AccountContext.Provider>
	);
}
