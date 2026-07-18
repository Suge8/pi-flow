<script>
import { i18n, setLang, t } from "./i18n.svelte.js";
</script>

<header class="nav">
	<a class="brand" href="#top">
		<img src="/assets/logo.webp" alt="" width="34" height="34">
		<span>Pi Flow</span>
	</a>
	<nav class="links">
		<a href="https://github.com/Suge8/pi-flow" target="_blank" rel="noopener">GitHub</a>
		<a href="https://www.npmjs.com/package/@surgee/pi-flow" target="_blank" rel="noopener">npm</a>
		<button class="lang" type="button" aria-label={t("nav.aria")} onclick={() => setLang(i18n.lang === "zh" ? "en" : "zh")}>
			{i18n.lang === "zh" ? "EN" : "中文"}
		</button>
	</nav>
</header>

<style>
	.nav {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.8rem clamp(1.2rem, 4vw, 3rem);
		background: oklch(96.5% 0.013 85 / 0.82);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-bottom: 1px solid oklch(88% 0.012 80 / 0.6);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		text-decoration: none;
		font-family: var(--display);
		font-weight: 800;
		font-size: 1.2rem;
		letter-spacing: -0.02em;
	}
	.brand img { mix-blend-mode: multiply; }
	.links { display: flex; align-items: center; gap: clamp(0.9rem, 2.5vw, 1.8rem); }
	.links a {
		text-decoration: none;
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--ink-soft);
		transition: color 0.2s;
	}
	.links a:hover { color: var(--ink); }
	.lang {
		border: 1.5px solid var(--ink);
		background: transparent;
		border-radius: 999px;
		padding: 0.28rem 0.9rem;
		font-weight: 700;
		font-size: 0.88rem;
		transition: background 0.2s, color 0.2s;
	}
	.lang:hover { background: var(--ink); color: var(--bg); }
</style>
