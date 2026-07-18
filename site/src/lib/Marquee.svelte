<script>
const stages = ["Align", "Plan", "Execute", "Check", "Advise", "Ship ✓"];
const seq = [...stages, ...stages, ...stages];
</script>

<div class="ribbons" aria-hidden="true">
	<div class="ribbon coral">
		<div class="track">
			{#each seq as s, i (i)}<span>{s}</span><i>→</i>{/each}
			<span>↺</span><i>→</i>{#each seq as s, i (i)}<span>{s}</span><i>→</i>{/each}<span>↺</span><i>→</i>
		</div>
	</div>
	<div class="ribbon ink">
		<div class="track rev">
			{#each seq as s, i (i)}<span>{s}</span><i>→</i>{/each}
			<span>↺</span><i>→</i>{#each seq as s, i (i)}<span>{s}</span><i>→</i>{/each}<span>↺</span><i>→</i>
		</div>
	</div>
</div>

<style>
	.ribbons { position: relative; z-index: 2; margin: -1.2rem 0; }
	.ribbon {
		overflow: hidden;
		padding: 0.7rem 0;
		font-family: var(--display);
		font-weight: 700;
		font-size: clamp(1rem, 1.8vw, 1.3rem);
		user-select: none;
	}
	.coral {
		background: var(--coral-drench);
		color: var(--cream-on-dark);
		transform: rotate(-1.1deg) scale(1.02);
	}
	.ink {
		background: var(--ink);
		color: var(--coral);
		transform: rotate(0.9deg) scale(1.02);
		margin-top: -0.6rem;
	}
	.track {
		display: flex;
		gap: 1.6rem;
		width: max-content;
		animation: slide 26s linear infinite;
	}
	.track.rev { animation-direction: reverse; animation-duration: 32s; }
	.track i { font-style: normal; opacity: 0.5; }
	@keyframes slide { to { transform: translateX(-50%); } }
</style>
