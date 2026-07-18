<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onMount } from "svelte";
import { t } from "./i18n.svelte.js";

gsap.registerPlugin(ScrollTrigger);

let root;
const deaths = ["problem.p1", "problem.p2", "problem.p3", "problem.p4"];

onMount(() => {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const ctx = gsap.context(() => {
		// ghost word drifts sideways as you scroll through the section
		gsap.fromTo(
			".ghost",
			{ xPercent: 6 },
			{
				xPercent: -10,
				ease: "none",
				scrollTrigger: {
					trigger: root,
					start: "top bottom",
					end: "bottom top",
					scrub: true,
				},
			},
		);

		const tl = gsap.timeline({
			scrollTrigger: {
				trigger: root,
				start: "top 70%",
				end: "bottom 78%",
				scrub: 1,
			},
		});
		tl.from(".death", {
			xPercent: (i) => (i % 2 ? 18 : -18),
			autoAlpha: 0,
			duration: 1,
			stagger: 0.32,
			ease: "power3.out",
		})
			.from(
				".death .n",
				{ color: "transparent", duration: 1, stagger: 0.32 },
				0.12,
			)
			// verdict: strike every failure out, then stamp the closing line
			.to(
				".strike",
				{ scaleX: 1, duration: 0.45, stagger: 0.18, ease: "power2.inOut" },
				">-0.1",
			)
			.to(".death p", { opacity: 0.45, duration: 0.45, stagger: 0.18 }, "<")
			.from(
				".out",
				{ y: 40, autoAlpha: 0, duration: 0.8, ease: "back.out(1.6)" },
				">-0.2",
			)
			.from(
				".out-bar",
				{ scaleX: 0, duration: 0.7, ease: "power3.inOut" },
				">-0.35",
			);
	}, root);
	return () => ctx.revert();
});
</script>

<section class="problem" bind:this={root}>
	<div class="ghost" aria-hidden="true">{t("problem.ghost")}</div>
	<div class="inner">
		<h2>{@html t("problem.h2")}</h2>
		<ol>
			{#each deaths as key, i (key)}
				<li class="death">
					<span class="n" aria-hidden="true">{i + 1}</span>
					<p>{t(key)}<i class="strike" aria-hidden="true"></i></p>
				</li>
			{/each}
		</ol>
		<p class="out">{t("problem.out")}<span class="out-bar" aria-hidden="true"></span></p>
	</div>
</section>

<style>
	.problem {
		position: relative;
		background: var(--dark);
		color: var(--cream-on-dark);
		padding: clamp(6rem, 13vh, 10rem) clamp(1.2rem, 4vw, 3rem);
		overflow: hidden;
	}
	.ghost {
		position: absolute;
		top: clamp(1rem, 4vh, 3rem);
		left: 0;
		width: 100%;
		font-family: var(--display);
		font-weight: 800;
		font-size: clamp(7rem, 22vw, 19rem);
		line-height: 1;
		letter-spacing: -0.02em;
		white-space: nowrap;
		color: transparent;
		-webkit-text-stroke: 1.5px oklch(96% 0.013 85 / 0.1);
		pointer-events: none;
		user-select: none;
	}
	.inner { position: relative; max-width: 1100px; margin: 0 auto; }
	h2 {
		font-size: clamp(2.3rem, 5.2vw, 4.4rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.05;
	}
	ol { list-style: none; margin-top: clamp(2.5rem, 6vh, 4.5rem); }
	.death {
		display: flex;
		align-items: center;
		gap: clamp(1.2rem, 3.5vw, 2.6rem);
		padding: clamp(1rem, 2.2vh, 1.5rem) 0;
		border-bottom: 1px solid oklch(96% 0.013 85 / 0.14);
		will-change: transform;
	}
	.n {
		font-family: var(--display);
		font-weight: 800;
		font-size: clamp(3.4rem, 7vw, 6rem);
		line-height: 1;
		color: var(--coral);
		-webkit-text-stroke: 2px var(--coral);
		min-width: 1.1em;
		text-align: center;
	}
	.death p {
		position: relative;
		font-family: var(--display);
		font-weight: 700;
		font-size: clamp(1.4rem, 3.2vw, 2.5rem);
		letter-spacing: -0.015em;
		line-height: 1.2;
		color: oklch(96% 0.013 85 / 0.92);
	}
	.strike {
		position: absolute;
		left: -0.2em;
		right: -0.2em;
		top: 0.56em; /* first-line midline — stays put when copy wraps */
		height: clamp(3px, 0.14em, 6px);
		border-radius: 999px;
		background: var(--coral);
		transform: scaleX(0);
		transform-origin: left center;
	}
	.out {
		display: inline-block;
		position: relative;
		margin-top: clamp(2.6rem, 6vh, 4rem);
		font-family: var(--display);
		font-weight: 800;
		font-size: clamp(2rem, 4.6vw, 3.8rem);
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.out-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -0.28em;
		height: 0.16em;
		border-radius: 999px;
		background: var(--coral);
		transform-origin: left center;
	}
</style>
