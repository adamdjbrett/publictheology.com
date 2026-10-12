// All page CSS, inlined into <head> by partials/head.njk so nothing render-blocks.
// The vendored theme CSS (assets/built/screen.css) is used untouched except that its @font-face
// rules are dropped (fonts.css redeclares them with font-display) and its ../ URLs are made
// absolute, because the rules now live in the HTML. Order = cascade order.
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(`src/assets/${f}`, "utf8");

const theme = read("built/screen.css")
	.replace(/@font-face\s*\{[^}]*\}/g, "")
	.replace(/url\(\s*(["']?)\.\.\//g, "url($1/assets/");

// ponytail: comment/whitespace squeeze only, not a real minifier. Safe here: no CSS strings contain "/*" or significant runs of spaces.
const squeeze = (css) =>
	css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\s*([{};,>])\s*/g, "$1")
		.replace(/;}/g, "}")
		.trim();

export default squeeze([theme, read("css/fonts.css"), read("css/site.css"), read("css/darkmode.css")].join("\n"));
