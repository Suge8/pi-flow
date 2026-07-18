<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onMount } from "svelte";
import InstallPill from "./InstallPill.svelte";
import { t } from "./i18n.svelte.js";

gsap.registerPlugin(ScrollTrigger);

let root;
const finePointer = matchMedia("(pointer: fine)").matches;

onMount(() => {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const ctx = gsap.context(() => {
		gsap.from(".rocket", {
			y: 160,
			autoAlpha: 0,
			duration: 1.3,
			ease: "expo.out",
			scrollTrigger: { trigger: root, start: "top 75%" },
		});
		gsap.to(".rocket", {
			y: -30,
			duration: 2.6,
			ease: "sine.inOut",
			yoyo: true,
			repeat: -1,
			delay: 1.3,
		});
		gsap.from(".cta-title", {
			y: 60,
			autoAlpha: 0,
			duration: 1,
			ease: "expo.out",
			scrollTrigger: { trigger: root, start: "top 70%" },
		});
	}, root);
	return () => ctx.revert();
});
</script>

<section class="cta" bind:this={root}>
	<div class="blob blob-coral"></div>
	<img class="rocket" src="/assets/cta-launch.webp" alt="" width="1000" height="1500" loading="lazy" aria-hidden="true">
	<h2 class="cta-title">{t("cta.h2")}</h2>
	<InstallPill big magnet={finePointer} />
	<p class="note">{@html t("cta.note")}</p>
</section>

<style>
	.cta {
		text-align: center;
		padding: clamp(4rem, 9vh, 7rem) clamp(1.2rem, 4vw, 3rem) clamp(5rem, 11vh, 8rem);
		overflow: hidden;
	}
	.blob-coral { width: 42vw; height: 42vw; left: 50%; top: 8%; transform: translateX(-50%); }
	.rocket {
		width: clamp(200px, 30vw, 330px);
		margin: 0 auto;
		position: relative;
		z-index: 1;
		border-radius: 26px;
		-webkit-mask-image: radial-gradient(closest-side, #000 62%, transparent 97%);
		mask-image: radial-gradient(closest-side, #000 62%, transparent 97%);
		will-change: transform;
	}
	h2 {
		position: relative;
		z-index: 1;
		margin-top: -1.5rem;
		font-size: clamp(2.6rem, 7vw, 5.5rem);
		font-weight: 800;
		letter-spacing: -0.035em;
	}
	.cta :global(.install-pill) { margin-top: 2.4rem; position: relative; z-index: 1; }
	.note { margin-top: 1.5rem; color: var(--ink-soft); font-size: 0.95rem; position: relative; z-index: 1; }
	.note :global(code) { font-family: var(--mono); background: oklch(92% 0.013 85); border-radius: 6px; padding: 0.1em 0.4em; }
	@media (max-width: 640px) {
		.rocket { width: 170px; }
		h2 { margin-top: 0.5rem; }
	}
</style>
