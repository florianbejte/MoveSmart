"use client";
import { ArrowUpRight, MoveUpRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
	const pathname = usePathname();
	return (
		<header className="app-header">
			<Link href="/" className="app-brand">
				<span className="brand-mark">
					<MoveUpRight size={22} strokeWidth={3} />
				</span>
				move<span>smart</span>
				<span className="brand-dot">.</span>
			</Link>
			<nav aria-label="Main navigation">
				<Link href="/" className={pathname === "/" ? "current" : ""}>
					Live map
				</Link>
				<Link
					href="/dashboard"
					className={pathname === "/dashboard" ? "current" : ""}
				>
					Account
					<ArrowUpRight size={14} />
				</Link>
			</nav>
			<span className="header-city">
				<span />
				Made for moving in Vilnius
			</span>
		</header>
	);
}
