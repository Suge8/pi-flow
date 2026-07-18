<script>
import { t } from "./i18n.svelte.js";

let { big = false, magnet = false } = $props();
let copied = $state(false);
let el;

async function copy() {
	try {
		await navigator.clipboard.writeText("pi install npm:@surgee/pi-flow");
	} catch {
		return;
	}
	copied = true;
	setTimeout(() => (copied = false), 1600);
}

function onMove(e) {
	if (!magnet) return;
	const r = el.getBoundingClientRect();
	const dx = e.clientX - (r.left + r.width / 2);
	const dy = e.clientY - (r.top + r.height / 2);
	el.style.transform = `translate(${dx * 0.12}px, ${dy * 0.22}px)`;
}
function onLeave() {
	if (magnet) el.style.transform = "";
}
</script>

<button
	bind:this={el}
	class="install-pill"
	class:big
	type="button"
	onclick={copy}
	onpointermove={onMove}
	onpointerleave={onLeave}
>
	<code>pi install npm:@surgee/pi-flow</code>
	<span class="copy-tag">{copied ? t("copied") : t("copy")}</span>
</button>

<style>
	.big { padding: 1.1rem 1.4rem 1.1rem 1.7rem; border-radius: 18px; }
	.big code { font-size: clamp(0.95rem, 2.4vw, 1.15rem); }
	@media (max-width: 430px) {
		.big code { font-size: 0.82rem; }
	}
</style>
