<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onMount } from "svelte";
import { t } from "./i18n.svelte.js";
import { loopPlayback } from "./video.js";

gsap.registerPlugin(ScrollTrigger);

let root, dialFill, dialNum;
let flat = $state(false);
const C = 2 * Math.PI * 132; // dial ring circumference, r=132

const stages = [
	["loop.s1", "loop.s1d"],
	["loop.s2", "loop.s2d"],
	["loop.s3", "loop.s3d"],
	["loop.s4", "loop.s4d"],
	["loop.s5", "loop.s5d"],
	["loop.s6", "loop.s6d"],
];

onMount(() => {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
		flat = true;
		return;
	}
	const els = root.querySelectorAll(".stage");
	const ctx = gsap.context(() => {
		const tl = gsap.timeline({
			scrollTrigger: {
				trigger: root,
				start: "top top",
				end: "+=3800",
				pin: true,
				scrub: 1,
				onUpdate: (self) => {
					const p = self.progress;
					dialFill.style.strokeDasharray = `${p * C} ${C}`;
					dialNum.textContent = String(
						Math.min(5, Math.floor(p * 6)) + 1,
					).padStart(2, "0");
				},
			},
		});
		els.forEach((el, i) => {
			tl.fromTo(
				el,
				{ autoAlpha: 0, y: 70 },
				{ autoAlpha: 1, y: 0, duration: 0.34, ease: "power3.out" },
				i,
			);
			if (i < els.length - 1)
				tl.to(
					el,
					{ autoAlpha: 0, y: -70, duration: 0.3, ease: "power3.in" },
					i + 0.68,
				);
		});
		tl.to({}, { duration: els.length - tl.duration() }); // hold last stage; keeps counter (progress × 6) in sync
	}, root);
	return () => ctx.revert();
});
</script>

<section class="loop" class:flat bind:this={root}>
	<div class="inner">
		<h2>{t("loop.h2")}</h2>
		<div class="body">
			<div class="dial" aria-hidden="true">
				<video
					class="dial-video"
					poster="/assets/dial-poster.webp"
					width="560"
					height="560"
					muted
					loop
					playsinline
					preload="metadata"
					use:loopPlayback
				>
					<source src="/assets/dial-loop.webm" type="video/webm">
					<source src="/assets/dial-loop.mp4" type="video/mp4">
				</video>
				<svg viewBox="0 0 300 300" aria-hidden="true">
					<circle class="track" cx="150" cy="150" r="132" />
					<circle class="fill" cx="150" cy="150" r="132" bind:this={dialFill} />
				</svg>
				<div class="num" bind:this={dialNum}>01</div>
			</div>
			<div class="stages">
				{#each stages as [titleKey, descKey], i (titleKey)}
					<div class="stage" class:flat>
						<span class="ghost-n" aria-hidden="true">0{i + 1}</span>
						<h3>{t(titleKey)}</h3>
						<p>{t(descKey)}</p>
					</div>
				{/each}
			</div>
		</div>
		<p class="back" aria-hidden="true"><span>{t("loop.back")}</span> <b>↺</b></p>
	</div>
</section>

<style>
	.loop { background: var(--coral-drench); color: var(--cream-on-dark); overflow: hidden; }
	.inner {
		height: 100svh;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: clamp(1.5rem, 4vh, 3rem);
		padding: clamp(4.5rem, 9vh, 6rem) clamp(1.2rem, 4vw, 3rem) clamp(2rem, 5vh, 3rem);
	}
	h2 {
		max-width: 1100px;
		margin: 0 auto;
		width: 100%;
		font-size: clamp(1.6rem, 3vw, 2.4rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		opacity: 0.92;
	}
	.body {
		max-width: 1100px;
		margin: 0 auto;
		width: 100%;
		display: grid;
		grid-template-columns: minmax(200px, 300px) 1fr;
		align-items: center;
		gap: clamp(1.5rem, 5vw, 5rem);
	}
	.dial { position: relative; width: 100%; max-width: 300px; }
	.dial-video {
		position: absolute;
		inset: 7.5%;
		width: 85%;
		height: 85%;
		border-radius: 50%;
		object-fit: cover;
		background: oklch(88% 0.02 75);
	}
	.dial svg { position: relative; width: 100%; transform: rotate(-90deg); }
	.track { fill: none; stroke: oklch(30% 0.09 35 / 0.5); stroke-width: 7; }
	.fill {
		fill: none;
		stroke: var(--cream-on-dark);
		stroke-width: 7;
		stroke-linecap: round;
		stroke-dasharray: 0 829.4;
	}
	.num {
		position: absolute;
		right: 2%;
		bottom: 2%;
		width: 3.4rem;
		height: 3.4rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--dark);
		color: var(--cream-on-dark);
		font-family: var(--display);
		font-weight: 800;
		font-size: 1.3rem;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		box-shadow: 0 6px 18px oklch(20% 0.05 35 / 0.35);
	}
	.stages { position: relative; min-height: 17rem; }
	.stage {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		opacity: 0;
		pointer-events: none;
	}
	.ghost-n {
		position: absolute;
		right: -0.05em;
		top: 50%;
		transform: translateY(-54%);
		font-family: var(--display);
		font-weight: 800;
		font-size: clamp(9rem, 20vw, 17rem);
		line-height: 1;
		color: transparent;
		-webkit-text-stroke: 2px oklch(96% 0.013 85 / 0.18);
		user-select: none;
	}
	.stage.flat { position: static; opacity: 1; margin-bottom: 3rem; pointer-events: auto; }
	.stage h3 {
		font-size: clamp(3rem, 8vw, 6rem);
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 1;
	}
	.stage p {
		margin-top: 1.2rem;
		max-width: 30rem;
		font-size: clamp(1.05rem, 1.6vw, 1.25rem);
		line-height: 1.65;
		color: oklch(97% 0.01 85 / 0.92);
	}
	.back {
		max-width: 1100px;
		margin: 0 auto;
		width: 100%;
		font-family: var(--mono);
		font-size: 0.9rem;
		letter-spacing: 0.02em;
		color: oklch(96% 0.013 85 / 0.75);
	}
	.back b { font-size: 1.2rem; display: inline-block; animation: spin 3s linear infinite reverse; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.loop.flat { height: auto; }
	.loop.flat .inner { height: auto; }
	.loop.flat .dial { display: none; }

	@media (max-width: 900px) {
		.body { grid-template-columns: 1fr; gap: 1.5rem; }
		.dial { max-width: 168px; }
		.num { width: 2.4rem; height: 2.4rem; font-size: 1rem; }
		.stages { min-height: 15rem; }
		.stage h3 { font-size: clamp(2.4rem, 11vw, 3.6rem); }
		.ghost-n { font-size: clamp(7rem, 30vw, 10rem); -webkit-text-stroke-width: 1.5px; }
	}
</style>
