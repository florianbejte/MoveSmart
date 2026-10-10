"use client";
import { MapPin, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
	const pathname = usePathname();
	return (
		<header className="app-header">
			<Link href="/" className="app-brand" aria-label="MoveSmart home">
				<span className="brand-mark" aria-hidden="true">
					<svg
						aria-hidden="true"
						width="28"
						height="28"
						viewBox="0 0 28 28"
						fill="none"
					>
						<path
							d="M5 21V7h5l4 8 4-8h5v14"
							stroke="currentColor"
							strokeWidth="3.5"
							strokeLinejoin="round"
						/>
						<circle cx="23" cy="22" r="3" fill="#f3ce49" />
					</svg>
				</span>
				<span>movesmart</span>
			</Link>
			<nav aria-label="Main navigation">
				<Link
					href="/"
					className={pathname === "/" ? "current" : ""}
					aria-current={pathname === "/" ? "page" : undefined}
				>
					Live map
				</Link>
				<Link
					href="/dashboard"
					aria-label="Account"
					className={pathname === "/dashboard" ? "current" : ""}
					aria-current={pathname === "/dashboard" ? "page" : undefined}
				>
					<UserRound size={16} />
					<span>Account</span>
				</Link>
			</nav>
			<span className="header-city">
				<MapPin size={14} />
				<span>Vilnius</span>
				<span className="city-country">LT</span>
			</span>
		</header>
	);
}
