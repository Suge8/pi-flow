// Svelte action: play a muted looping video only while in viewport.
// No autoplay attribute — reduced-motion and no-JS users get the poster frame.
export function loopPlayback(node) {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	node.muted = true;
	const io = new IntersectionObserver(
		([entry]) => {
			if (entry.isIntersecting) node.play().catch(() => {});
			else node.pause();
		},
		{ rootMargin: "120px" },
	);
	io.observe(node);
	return { destroy: () => io.disconnect() };
}
