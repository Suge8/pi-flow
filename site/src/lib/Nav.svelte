<script>
import { i18n, setLang, t } from "./i18n.svelte.js";
</script>

<header class="nav">
	<a class="brand" href="#top">
		<img src="/assets/logo.webp" alt="" width="34" height="34">
		<span>Pi Flow</span>
	</a>
	<nav class="links">
		<a class="ext" href="https://github.com/Suge8/pi-flow" target="_blank" rel="noopener" aria-label="Pi Flow on GitHub">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
			<span>GitHub</span>
		</a>
		<a class="ext" href="https://www.npmjs.com/package/@surgee/pi-flow" target="_blank" rel="noopener" aria-label="@surgee/pi-flow on npm">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></svg>
			<span>npm</span>
		</a>
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
	.links { display: flex; align-items: center; gap: clamp(0.5rem, 1.5vw, 0.9rem); }
	.ext {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		text-decoration: none;
		font-weight: 700;
		font-size: 0.88rem;
		color: var(--ink);
		border: 1.5px solid var(--ink);
		border-radius: 999px;
		padding: 0.26rem 0.85rem;
		transition:
			background 0.2s,
			color 0.2s,
			transform 0.25s var(--ease-out),
			box-shadow 0.25s var(--ease-out);
	}
	.ext svg { width: 1.02rem; height: 1.02rem; fill: currentColor; display: block; }
	.ext:hover {
		background: var(--ink);
		color: var(--bg);
		transform: translateY(-1px);
		box-shadow: 0 6px 16px oklch(24% 0.012 50 / 0.22);
	}
	.ext:active { transform: translateY(0); box-shadow: none; }
	@media (max-width: 560px) {
		.ext span { display: none; }
		.ext { padding: 0.26rem 0.5rem; }
	}
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
