"use client";

import { BusFront } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n/react";
export default function AccountUnavailable() {
	const t = useT();
	return (
		<main className="account-page">
			<section className="account-panel">
				<span className="account-symbol">
					<BusFront size={30} />
				</span>
				<h1>{t("Accounts aren’t available yet")}</h1>
				<p>{t("You can explore live transport without an account.")}</p>
				<Link className="account-link" href="/">
					{t("Back to the live map")}
				</Link>
			</section>
		</main>
	);
}
