<script>
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { tick } from "svelte";
import Compare from "./lib/Compare.svelte";
import Cta from "./lib/Cta.svelte";
import Evidence from "./lib/Evidence.svelte";
import Footer from "./lib/Footer.svelte";
import Hero from "./lib/Hero.svelte";
import { i18n, setLang } from "./lib/i18n.svelte.js";
import Loop from "./lib/Loop.svelte";
import Marquee from "./lib/Marquee.svelte";
import Nav from "./lib/Nav.svelte";
import Problem from "./lib/Problem.svelte";
import Review from "./lib/Review.svelte";
import Roles from "./lib/Roles.svelte";

gsap.registerPlugin(ScrollTrigger);

// apply persisted/detected language on load
setLang(i18n.lang);

// layout depends on text length & webfont metrics — keep ScrollTrigger honest
$effect(() => {
	i18n.lang; // rerun on language switch
	tick().then(() => ScrollTrigger.refresh());
});
if (typeof document !== "undefined")
	document.fonts?.ready.then(() => ScrollTrigger.refresh());
</script>

<Nav />
<main>
	<Hero />
	<Marquee />
	<Problem />
	<Loop />
	<Roles />
	<Review />
	<Evidence />
	<Compare />
	<Cta />
</main>
<Footer />
