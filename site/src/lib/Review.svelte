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
		gsap.from(".scene", {
			clipPath: "inset(12% 12% 12% 12% round 40px)",
			scale: 0.94,
			duration: 1.2,
			ease: "power2.out",
			scrollTrigger: {
				trigger: root,
				start: "top 70%",
				end: "top 30%",
				scrub: 1,
			},
		});
		gsap.from(".check-chip", {
			y: 30,
			autoAlpha: 0,
			duration: 0.7,
			stagger: 0.12,
			ease: "power3.out",
			scrollTrigger: { trigger: ".chips", start: "top 85%" },
		});
	}, root);
	return () => ctx.revert();
});
</script>

<section class="review" bind:this={root}>
	<div class="sec-head">
		<h2>{t("review.h2")}</h2>
		<p>{t("review.sub")}</p>
	</div>
	<div class="frame">
		<img class="scene" src="/assets/review-scene.webp" alt="" width="1200" height="800" loading="lazy">
	</div>
	<ul class="chips">
		<li class="check-chip">{t("review.c1")}</li>
		<li class="check-chip">{t("review.c2")}</li>
		<li class="check-chip">{t("review.c3")}</li>
	</ul>
</section>

<style>
	.review {
		background: var(--surface);
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		padding: clamp(6rem, 13vh, 10rem) clamp(1.2rem, 4vw, 3rem);
	}
	.frame {
		max-width: 980px;
		margin: clamp(2.5rem, 6vh, 4rem) auto 0;
		perspective: 1200px;
	}
	.scene {
		border-radius: 26px;
		box-shadow: 0 40px 90px -30px oklch(24% 0.012 50 / 0.3);
		will-change: transform, clip-path;
	}
	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.8rem;
		margin: 2.2rem auto 0;
		max-width: 1000px;
	}
	.check-chip {
		font-family: var(--mono);
		font-size: 0.85rem;
		color: var(--mint-text);
		border: 1.5px solid oklch(50% 0.11 168 / 0.45);
		border-radius: 999px;
		padding: 0.4rem 1rem;
		background: oklch(99% 0.004 90 / 0.7);
	}
</style>
