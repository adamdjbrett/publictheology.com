/* Light/dark theme toggle. Pairs with the inline no-flash script in the <head>
   (which sets data-theme before paint). This handles the click + storage. */
(function () {
	const KEY = "headline-color-scheme";
	const root = document.documentElement;

	function current() {
		return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
	}

	function apply(scheme) {
		root.setAttribute("data-theme", scheme);
		try {
			localStorage.setItem(KEY, scheme);
		} catch (e) {
			/* storage unavailable — ignore */
		}
		document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
			btn.setAttribute("aria-pressed", String(scheme === "dark"));
		});
	}

	document.addEventListener("click", function (event) {
		const btn = event.target.closest("[data-theme-toggle]");
		if (!btn) return;
		apply(current() === "dark" ? "light" : "dark");
	});

	// Follow the OS if the visitor hasn't made an explicit choice.
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	media.addEventListener("change", function (e) {
		let stored = null;
		try {
			stored = localStorage.getItem(KEY);
		} catch (err) {
			/* ignore */
		}
		if (!stored) apply(e.matches ? "dark" : "light");
	});
})();
