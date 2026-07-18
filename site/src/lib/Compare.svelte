<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onMount } from "svelte";
import { t } from "./i18n.svelte.js";

gsap.registerPlugin(ScrollTrigger);

let root;

const rows = [
	["cmp.r1", "cmp.r1a", "cmp.no1", "cmp.no1"],
	["cmp.r2", "cmp.r2a", null, null],
	["cmp.r3", "cmp.r3a", null, null],
	["cmp.r4", "cmp.r4a", "cmp.no2", "cmp.no3"],
	["cmp.r5", "cmp.r5a", "cmp.no2", "cmp.no4"],
	["cmp.r6", "cmp.r6a", null, null],
];

onMount(() => {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const ctx = gsap.context(() => {
		gsap.from("tbody tr", {
			autoAlpha: 0,
			y: 26,
			duration: 0.6,
			stagger: 0.08,
			ease: "power3.out",
			scrollTrigger: { trigger: ".table-wrap", start: "top 80%" },
		});
	}, root);
	return () => ctx.revert();
});
</script>

<section class="compare" bind:this={root}>
	<div class="sec-head">
		<h2>{t("compare.h2")}</h2>
	</div>
	<div class="table-wrap">
		<table>
			<thead>
				<tr><th></th><th class="pi">Pi Flow</th><th>Codex</th><th>Claude</th></tr>
			</thead>
			<tbody>
				{#each rows as [label, pi, codex, claude] (label)}
					<tr>
						<th>{t(label)}</th>
						<td class="pi">{t(pi)}</td>
						<td class:neg={!!codex}>{codex ? t(codex) : "—"}</td>
						<td class:neg={!!claude}>{claude ? t(claude) : "—"}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.compare { padding: clamp(6rem, 13vh, 10rem) clamp(1.2rem, 4vw, 3rem); }
	.table-wrap { max-width: 1000px; margin: clamp(2.2rem, 5vh, 3.5rem) auto 0; overflow-x: auto; }
	table { width: 100%; min-width: 640px; border-collapse: separate; border-spacing: 0; }
	th, td {
		padding: 0.95rem 1.1rem;
		text-align: left;
		font-size: 0.95rem;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}
	thead th {
		font-family: var(--display);
		font-weight: 800;
		font-size: 1.05rem;
		border-bottom: 2px solid var(--ink);
	}
	tbody th { font-weight: 700; color: var(--ink-soft); white-space: nowrap; }
	td { color: var(--ink-soft); }
	td.pi { color: var(--ink); font-weight: 600; }
	.pi { background: oklch(70% 0.13 35 / 0.09); }
	thead .pi { color: var(--coral-text); border-bottom-color: var(--coral-text); }
	td.neg::before { content: "✕ "; color: var(--coral-text); font-weight: 700; }
</style>
