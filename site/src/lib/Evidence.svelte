<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onMount } from "svelte";
import { i18n, t } from "./i18n.svelte.js";

gsap.registerPlugin(ScrollTrigger);

let root;

onMount(() => {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const ctx = gsap.context(() => {
		gsap.fromTo(
			".shot",
			{ rotationX: 26, scale: 0.93, transformOrigin: "50% 0%" },
			{
				rotationX: 0,
				scale: 1,
				ease: "none",
				scrollTrigger: {
					trigger: ".tilt",
					start: "top 95%",
					end: "top 30%",
					scrub: 1,
				},
			},
		);
		gsap.from(".holo", {
			y: 90,
			autoAlpha: 0,
			rotation: -4,
			duration: 1.1,
			ease: "expo.out",
			scrollTrigger: { trigger: root, start: "top 60%" },
		});
		gsap.to(".holo", {
			yPercent: -16,
			ease: "none",
			scrollTrigger: {
				trigger: root,
				start: "top bottom",
				end: "bottom top",
				scrub: 1.2,
			},
		});
	}, root);
	return () => ctx.revert();
});
</script>

<section class="evidence" bind:this={root}>
	<div class="sec-head">
		<h2>{t("evidence.h2")}</h2>
		<p>{t("evidence.sub")}</p>
	</div>
	<div class="gallery">
		<img class="holo" src="/assets/report-holo.webp" alt="" width="900" height="1350" loading="lazy" aria-hidden="true">
		<div class="tilt">
			<img
				class="shot"
				src={i18n.lang === "zh" ? "/assets/report-zh.webp" : "/assets/report-en.webp"}
				alt="Pi Flow live HTML report"
				width="1240"
				height="2400"
				loading="lazy"
			>
		</div>
	</div>
	<ul class="badges">
		<li>{t("evidence.b1")}</li>
		<li>{t("evidence.b2")}</li>
		<li>{t("evidence.b3")}</li>
	</ul>
</section>

<style>
	.evidence { padding: clamp(6rem, 13vh, 10rem) clamp(1.2rem, 4vw, 3rem) clamp(4rem, 8vh, 6rem); overflow: hidden; }
	.gallery { position: relative; max-width: 880px; margin: clamp(2.5rem, 6vh, 4rem) auto 0; }
	.holo {
		position: absolute;
		width: clamp(140px, 22vw, 250px);
		right: clamp(-9rem, -10vw, -4rem);
		top: 22%;
		border-radius: 22px;
		box-shadow: 0 30px 70px -20px oklch(24% 0.012 50 / 0.35);
		z-index: 2;
		will-change: transform;
	}
	.tilt {
		perspective: 1400px;
		max-height: 72vh;
		overflow: hidden;
		border-radius: 18px;
		-webkit-mask-image: linear-gradient(#000 78%, transparent 100%);
		mask-image: linear-gradient(#000 78%, transparent 100%);
	}
	.shot {
		border-radius: 18px;
		border: 1px solid var(--line);
		box-shadow: 0 24px 70px -18px oklch(24% 0.012 50 / 0.25);
		will-change: transform;
	}
	.badges {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.8rem;
		margin: 2.2rem auto 0;
	}
	.badges li {
		font-family: var(--mono);
		font-size: 0.85rem;
		color: var(--mint-text);
		border: 1.5px solid oklch(50% 0.11 168 / 0.45);
		border-radius: 999px;
		padding: 0.35rem 1rem;
	}

	@media (max-width: 900px) {
		.holo { display: none; }
	}
</style>
