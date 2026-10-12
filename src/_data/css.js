// The one stylesheet pages load (/assets/css/style.css, rendered by src/css.njk):
// the vendored theme (assets/built/screen.css) + assets/css/site.css, in that cascade order.
// The theme's @font-face rules are dropped: they lack font-display, and site.css redeclares them.
// The output sits in /assets/css/, so the theme's ../images/ URLs still resolve.
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(`src/assets/${f}`, "utf8");

// ponytail: comment/whitespace squeeze, not a real minifier. Safe while no CSS string contains "/*" or space runs.
const squeeze = (css) =>
	css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\s*([{};,>])\s*/g, "$1")
		.replace(/;}/g, "}")
		.trim();

export default squeeze(read("built/screen.css").replace(/@font-face\s*\{[^}]*\}/g, "") + "\n" + read("css/site.css"));
