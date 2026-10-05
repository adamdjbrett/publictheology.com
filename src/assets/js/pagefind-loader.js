/* ---------------------------------------------------------------------------
   Lazy-load the Pagefind Component UI on first search intent.

   The <head> no longer loads /pagefind/pagefind-component-ui.{css,js}.
   Instead, this tiny deferred script waits for the first sign of search
   intent — a click on the header search trigger, or Cmd/Ctrl-K — then:

     1. injects the Component UI stylesheet + module script (once),
     2. waits for customElements.whenDefined("pagefind-modal"),
     3. opens the modal for the intent that triggered the load.

   After that first load the native component takes over: the upgraded
   <pagefind-modal-trigger> handles clicks and the component binds its own
   Cmd/Ctrl-K, so this script removes its listeners and steps aside.
--------------------------------------------------------------------------- */
(function () {
	"use strict";

	var CSS_HREF = "/pagefind/pagefind-component-ui.css";
	var JS_SRC = "/pagefind/pagefind-component-ui.js";
	var state = "idle"; // "idle" -> "loading" -> "ready"

	function injectAssets() {
		if (!document.querySelector('link[href="' + CSS_HREF + '"]')) {
			var link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = CSS_HREF;
			document.head.appendChild(link);
		}
		if (!document.querySelector('script[src="' + JS_SRC + '"]')) {
			var script = document.createElement("script");
			script.type = "module";
			script.src = JS_SRC;
			script.onerror = function () {
				state = "idle"; // allow a retry on the next intent
			};
			document.head.appendChild(script);
		}
	}

	function openModal() {
		var modal = document.querySelector("pagefind-modal");
		if (modal && typeof modal.open === "function") {
			modal.open();
		}
	}

	function teardown() {
		document.removeEventListener("click", onClick, true);
		document.removeEventListener("keydown", onKeydown, true);
	}

	function loadAndOpen() {
		if (state !== "idle") {
			return; // loading (open fires when ready) or ready (component owns it)
		}
		state = "loading";
		injectAssets();
		customElements.whenDefined("pagefind-modal").then(function () {
			state = "ready";
			teardown();
			// Open once for the intent that triggered the load; every open
			// after this is handled by the component itself.
			requestAnimationFrame(openModal);
		});
	}

	function onClick(event) {
		if (state === "ready") {
			return; // upgraded <pagefind-modal-trigger> handles it
		}
		var trigger = event.target.closest("pagefind-modal-trigger");
		if (trigger) {
			loadAndOpen();
		}
	}

	function onKeydown(event) {
		if (state === "ready") {
			return; // the component's own Cmd/Ctrl-K binding handles it
		}
		if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
			event.preventDefault();
			loadAndOpen();
		}
	}

	document.addEventListener("click", onClick, true);
	document.addEventListener("keydown", onKeydown, true);
})();
