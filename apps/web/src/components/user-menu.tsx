"use client";

import { api } from "@MoveSmart/backend/convex/_generated/api";
import { Button } from "@MoveSmart/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@MoveSmart/ui/components/dropdown-menu";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/react";

export default function UserMenu() {
	const t = useT();

	const router = useRouter();
	const user = useQuery(api.auth.getCurrentUser);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" />}>
				{t(user?.name)}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{t("My Account")}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem>{t(user?.email)}</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={() => {
							authClient.signOut({
								fetchOptions: {
									onSuccess: () => {
										router.push("/dashboard");
									},
								},
							});
						}}
					>
						{t("Sign Out")}
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
