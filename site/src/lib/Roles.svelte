<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onMount } from "svelte";
import { t } from "./i18n.svelte.js";

gsap.registerPlugin(ScrollTrigger);

let root;

onMount(() => {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const ctx = gsap.context(() => {
		gsap.from(".trio", {
			y: 120,
			rotation: 3,
			autoAlpha: 0,
			duration: 1.2,
			ease: "expo.out",
			scrollTrigger: { trigger: root, start: "top 65%" },
		});
		gsap.to(".trio", {
			yPercent: -9,
			ease: "none",
			scrollTrigger: {
				trigger: root,
				start: "top bottom",
				end: "bottom top",
				scrub: 1,
			},
		});
		gsap.from(".role", {
			x: -40,
			autoAlpha: 0,
			duration: 0.8,
			stagger: 0.14,
			ease: "power3.out",
			scrollTrigger: { trigger: ".roles-list", start: "top 80%" },
		});
	}, root);
	return () => ctx.revert();
});
</script>

<section class="roles" bind:this={root}>
	<div class="blob blob-mint"></div>
	<div class="wrap">
		<div class="copy">
			<h2>{@html t("roles.h2")}</h2>
			<p class="sub">{@html t("roles.sub")}</p>
			<ul class="roles-list">
				<li class="role"><i class="chip coral"></i><div><h3>{t("roles.r1t")}</h3><p>{t("roles.r1d")}</p></div></li>
				<li class="role"><i class="chip ink"></i><div><h3>{t("roles.r2t")}</h3><p>{t("roles.r2d")}</p></div></li>
				<li class="role"><i class="chip mint"></i><div><h3>{t("roles.r3t")}</h3><p>{t("roles.r3d")}</p></div></li>
			</ul>
		</div>
		<div class="stage" aria-hidden="true">
			<img class="trio" src="/assets/roles-trio.webp" alt="" width="1200" height="800" loading="lazy">
		</div>
	</div>
</section>

<style>
	.roles { padding: clamp(6rem, 13vh, 10rem) clamp(1.2rem, 4vw, 3rem); overflow: hidden; }
	.blob-mint { width: 36vw; height: 36vw; right: -6vw; bottom: 0; }
	.wrap {
		max-width: 1180px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		gap: clamp(2rem, 5vw, 5rem);
	}
	h2 { font-size: clamp(2.1rem, 4.4vw, 3.6rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.08; }
	.sub { margin-top: 1.1rem; color: var(--ink-soft); max-width: 30rem; }
	.sub :global(code) { font-family: var(--mono); background: oklch(92% 0.013 85); border-radius: 6px; padding: 0.1em 0.4em; font-size: 0.92em; }
	.roles-list { list-style: none; margin-top: 2.2rem; display: grid; gap: 1.3rem; }
	.role { display: flex; gap: 1rem; align-items: flex-start; }
	.chip { width: 14px; height: 14px; border-radius: 50%; margin-top: 0.45rem; flex: none; }
	.chip.coral { background: var(--coral); }
	.chip.ink { background: var(--ink); }
	.chip.mint { background: oklch(72% 0.11 168); }
	.role h3 { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.01em; }
	.role p { margin-top: 0.2rem; color: var(--ink-soft); font-size: 0.98rem; }
	.stage { perspective: 1200px; }
	.trio {
		border-radius: 26px;
		box-shadow: 0 40px 90px -30px oklch(24% 0.012 50 / 0.35);
		will-change: transform;
	}

	@media (max-width: 900px) {
		.wrap { grid-template-columns: 1fr; }
		.stage { order: -1; }
		.blob-mint { width: 70vw; height: 70vw; right: -25vw; }
	}
</style>
