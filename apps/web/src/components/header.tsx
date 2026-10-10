"use client";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
	const pathname = usePathname();
	return (
		<header className="app-header">
			<Link href="/" className="app-brand" aria-label="MoveSmart home">
				{/* Speech-bubble wordmark in the Go Vilnius style: boxed first word, red second word. */}
				<span className="brand-bubble">MOVE</span>
				<span className="brand-word">SMART</span>
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
				<Crenellation />
				<span>Vilnius</span>
				<span className="city-country">LT</span>
			</span>
		</header>
	);
}

/** Gediminas Tower crenellation, the Vilnius brand's graphic element. */
function Crenellation() {
	return (
		<svg
			className="crenellation"
			aria-hidden="true"
			width="22"
			height="14"
			viewBox="0 0 40 21"
		>
			<path
				d="M1 21 3 4l9-3 1 6 4-1V0h6v6l4 1 1-6 9 3 2 17h-6l-1-10-7-2v3h-10V8l-7 2-1 11z"
				fill="currentColor"
			/>
		</svg>
	);
}
