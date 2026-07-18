<script>
import { gsap } from "gsap";
import { onMount } from "svelte";
import InstallPill from "./InstallPill.svelte";
import { t } from "./i18n.svelte.js";
import { loopPlayback } from "./video.js";

let root;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function chars(text) {
	return [...text];
}

// EN wraps between words (space-separated); CJK may wrap between any two chars.
// atomic keeps the whole segment on one line (quoted em phrase — CJK 标点禁则).
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
function wordsOf(text, atomic) {
	if (atomic) return [text];
	if (text.includes(" ")) return text.split(" ");
	return CJK.test(text) ? [...text] : [text];
}

onMount(() => {
	if (reduced()) return;
	const ctx = gsap.context(() => {
		// entrance choreography
		const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
		tl.from(".ch", { yPercent: 118, duration: 1.1, stagger: 0.028 })
			.from(".sub", { y: 26, autoAlpha: 0, duration: 0.8 }, "-=0.7")
			.from(".cta-row", { y: 26, autoAlpha: 0, duration: 0.8 }, "-=0.6")
			.from(".note", { autoAlpha: 0, duration: 0.6 }, "-=0.5")
			.from(
				".pod-wrap",
				{ scale: 0.82, autoAlpha: 0, duration: 1.3, ease: "expo.out" },
				0.15,
			);

		// cursor parallax layers (fine pointers only)
		if (matchMedia("(pointer: fine)").matches) {
			const podX = gsap.quickTo(".pod-wrap", "x", {
				duration: 0.9,
				ease: "power3",
			});
			const podY = gsap.quickTo(".pod-wrap", "y", {
				duration: 0.9,
				ease: "power3",
			});
			const blobX = gsap.quickTo(".blob-coral", "x", {
				duration: 1.4,
				ease: "power3",
			});
			const blobY = gsap.quickTo(".blob-coral", "y", {
				duration: 1.4,
				ease: "power3",
			});
			root.addEventListener("pointermove", (e) => {
				const r = root.getBoundingClientRect();
				const dx = (e.clientX - r.left) / r.width - 0.5;
				const dy = (e.clientY - r.top) / r.height - 0.5;
				podX(dx * 20);
				podY(dy * 14);
				blobX(dx * 70);
				blobY(dy * 46);
			});
		}
	}, root);
	return () => ctx.revert();
});
</script>

{#snippet maskLine(text, em = false)}
	{#each wordsOf(text, em) as w, wi (wi)}<span class="word">{#each chars(w) as c, ci (ci)}<span class="ch-mask"><span class="ch" class:em>{c}</span></span>{/each}</span>{#if text.includes(" ") && !em}{" "}{/if}{/each}
{/snippet}

<section class="hero" id="top" bind:this={root}>
	<div class="blob blob-coral"></div>
	<div class="copy">
		<h1>
			<span class="line">{@render maskLine(t("hero.l1a"))}{@render maskLine(t("hero.l1em"), true)}</span>
			<span class="line">{@render maskLine(t("hero.l2"))}</span>
		</h1>
		<p class="sub">{t("hero.sub")}</p>
		<div class="cta-row">
			<InstallPill />
			<a class="btn-ghost" href="https://github.com/Suge8/pi-flow" target="_blank" rel="noopener">{t("hero.gh")}</a>
		</div>
		<p class="note">{t("hero.note")}</p>
	</div>
	<div class="stage" aria-hidden="true">
		<div class="pod-wrap">
			<svg class="ring ring-outer" viewBox="0 0 520 520" aria-hidden="true">
				<circle cx="260" cy="260" r="248" pathLength="100" />
				<circle class="dot" cx="260" cy="12" r="7" />
			</svg>
			<video
				class="pod"
				poster="/assets/hero-poster.webp"
				width="640"
				height="640"
				muted
				loop
				playsinline
				preload="metadata"
				use:loopPlayback
			>
				<source src="/assets/hero-loop.webm" type="video/webm">
				<source src="/assets/hero-loop.mp4" type="video/mp4">
			</video>
		</div>
	</div>
</section>

<style>
	.hero {
		display: grid;
		grid-template-columns: 1.08fr 0.92fr;
		align-items: center;
		gap: clamp(1rem, 4vw, 4rem);
		max-width: 1280px;
		margin: 0 auto;
		padding: clamp(7rem, 14vh, 10rem) clamp(1.2rem, 4vw, 3rem) clamp(3rem, 8vh, 5rem);
		min-height: 92svh;
		overflow: hidden;
	}
	.blob-coral {
		width: 44vw;
		height: 44vw;
		right: -8vw;
		top: 4vh;
		animation: drift 11s ease-in-out infinite alternate;
	}
	@keyframes drift {
		from { transform: translate(0, 0) scale(1); }
		to { transform: translate(-6vw, 5vh) scale(1.12); }
	}
	h1 {
		font-size: clamp(2.6rem, 5.8vw, 5.2rem);
		font-weight: 800;
		line-height: 1.04;
		letter-spacing: -0.03em;
	}
	.line { display: block; }
	.word { display: inline-block; white-space: nowrap; }
	.ch-mask { display: inline-block; overflow: hidden; vertical-align: bottom; }
	.ch { display: inline-block; will-change: transform; }
	.em { font-style: normal; color: var(--coral-text); }
	.sub {
		margin-top: 1.6rem;
		max-width: 34rem;
		font-size: clamp(1.05rem, 1.4vw, 1.2rem);
		color: var(--ink-soft);
	}
	.cta-row {
		margin-top: 2.2rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
	}
	.note { margin-top: 1.4rem; font-size: 0.88rem; color: oklch(60% 0.02 60); }

	.stage { display: grid; place-items: center; }
	.pod-wrap {
		position: relative;
		width: min(100%, 30rem);
		aspect-ratio: 1;
		will-change: transform;
	}
	.pod {
		width: 88%;
		height: auto;
		margin: 6%;
		-webkit-mask-image: radial-gradient(closest-side, #000 64%, transparent 97%);
		mask-image: radial-gradient(closest-side, #000 64%, transparent 97%);
		animation: bob 5.2s ease-in-out infinite;
	}
	@keyframes bob {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-12px); }
	}
	.ring { position: absolute; inset: 0; width: 100%; height: 100%; }
	.ring-outer { animation: spin 26s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.ring circle:not(.dot) {
		fill: none;
		stroke: var(--coral);
		stroke-width: 2.5;
		stroke-dasharray: 0.6 2.4;
		stroke-linecap: round;
		opacity: 0.85;
	}
	.dot { fill: var(--coral); }

	@media (max-width: 900px) {
		.hero { grid-template-columns: 1fr; min-height: auto; text-align: center; }
		.sub { margin-inline: auto; }
		.cta-row { justify-content: center; }
		.stage { order: -1; margin-top: 1rem; }
		.pod-wrap { width: min(62vw, 20rem); }
		.blob-coral { width: 80vw; height: 80vw; right: -30vw; }
	}
</style>
