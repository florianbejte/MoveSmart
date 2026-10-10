import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SharedTripView } from "@/components/shared-trip/shared-trip-view";
import { ENV } from "@/env";

export const metadata: Metadata = {
	title: "Live trip · MoveSmart",
	description: "Follow a friend’s trip across Vilnius live.",
};

function Unavailable({ title, text }: { title: string; text: string }) {
	return (
		<main className="account-page">
			<section className="account-panel">
				<h1>{title}</h1>
				<p>{text}</p>
				<Link className="account-link" href="/">
					Open MoveSmart
				</Link>
			</section>
		</main>
	);
}

export default async function SharedTripPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	if (!ENV.NEXT_PUBLIC_CONVEX_URL)
		return (
			<Unavailable
				title="Live trips aren’t set up here"
				text="This server isn’t connected to the MoveSmart backend, so shared trips can’t be shown."
			/>
		);
	// Chat apps often add a full stop, a space or change the case of a link: keep just the id.
	const clean = decodeURIComponent(id)
		.toLowerCase()
		.match(/[a-f0-9]{24}/)?.[0];
	if (!clean)
		return (
			<Unavailable
				title="This link looks incomplete"
				text="The trip link may have been cut off. Ask your friend to send it again."
			/>
		);
	if (clean !== id) redirect(`/trip/${clean}`);
	return <SharedTripView shareId={clean} />;
}
