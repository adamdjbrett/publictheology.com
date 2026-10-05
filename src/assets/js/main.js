(function () {
    pagination(true);
})();

(function () {
    if (!document.body.classList.contains('post-template')) return;

    const cover = document.querySelector('.gh-cover');
    if (!cover) return;

    // Reveal the cover once its image has loaded. We intentionally do NOT
    // resize --cover-height to the image's aspect ratio here: doing so on
    // `load` collapses the 100vh hero and shifts the whole article up,
    // producing a large Cumulative Layout Shift. The cover keeps its
    // reserved height, so there is zero layout shift.
    window.addEventListener('load', function () {
        cover.classList.remove('loading');
    });
})();
