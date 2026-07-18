<footer class="footer">
	<div class="brand">
		<img src="/assets/logo.webp" alt="" width="26" height="26">
		<span>Pi Flow</span>
	</div>
	<nav>
		<a href="https://github.com/Suge8/pi-flow" target="_blank" rel="noopener">GitHub</a>
		<a href="https://www.npmjs.com/package/@surgee/pi-flow" target="_blank" rel="noopener">npm</a>
		<a href="https://github.com/Suge8/pi-flow/blob/main/LICENSE" target="_blank" rel="noopener">Apache-2.0</a>
	</nav>
</footer>

<style>
	.footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		max-width: 1280px;
		margin: 0 auto;
		padding: 2rem clamp(1.2rem, 4vw, 3rem) 2.5rem;
		border-top: 1px solid var(--line);
		font-size: 0.9rem;
		color: var(--ink-soft);
	}
	.brand { display: flex; align-items: center; gap: 0.5rem; font-family: var(--display); font-weight: 800; color: var(--ink); }
	.brand img { mix-blend-mode: multiply; }
	nav { display: flex; gap: 1.4rem; }
	a { text-decoration: none; font-weight: 600; }
	a:hover { color: var(--ink); }
</style>
