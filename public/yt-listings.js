/* YouTube listings for Webflow: renders the latest videos into every [data-yt-listings] element. */
(function () {
  var script = document.currentScript;
  var endpoint = new URL('/videos', (script && script.src) || location.href).href;
  var PLACEHOLDERS = 3;

  // :where() keeps the button fallback at zero specificity so the site's own
  // .outlined-button styles win on Webflow; the fallback only shows elsewhere.
  var CSS = [
    '.yt-listings{display:flex;gap:24px;align-items:stretch;width:100%}',
    '.yt-listings__card{flex:1 1 0;min-width:0;display:flex;flex-direction:column;box-sizing:border-box;background:#000;border:2px solid #fff;color:#fff}',
    '.yt-listings__thumb{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1a1a1a}',
    '.yt-listings__body{display:flex;flex-direction:column;flex:1;gap:16px;padding:16px}',
    '.yt-listings__title{margin:0;min-height:78px;font:inherit;font-size:18px;line-height:26px;font-weight:400;text-align:center;text-transform:uppercase;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.yt-listings__watch{margin-top:auto;align-self:center}',
    ':where(.yt-listings) :where(.yt-listings__watch){display:inline-block;padding:4px 10px;border:3px solid #fcee21;background:transparent;color:#fcee21;font-weight:600;line-height:28px;text-align:center;text-transform:uppercase;text-decoration:none;transition:transform .2s}',
    ':where(.yt-listings) :where(.yt-listings__watch):hover{transform:scale(1.2)}',
    '.yt-listings__watch:focus-visible{outline:2px solid #fff;outline-offset:4px}',
    '.yt-listings__card--loading .yt-listings__watch{visibility:hidden}',
    '@media (max-width:767px){.yt-listings{flex-direction:column}}',
  ].join('\n');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function injectStyles() {
    if (document.getElementById('yt-listings-style')) return;
    var style = document.createElement('style');
    style.id = 'yt-listings-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Same box as a real card, so the layout doesn't shift when videos arrive.
  function placeholderCard() {
    var card = el('div', 'yt-listings__card yt-listings__card--loading');
    var body = el('div', 'yt-listings__body');
    body.append(el('p', 'yt-listings__title'), el('span', 'yt-listings__watch', 'Watch'));
    card.append(el('div', 'yt-listings__thumb'), body);
    card.setAttribute('aria-hidden', 'true');
    return card;
  }

  function videoCard(video) {
    var card = el('article', 'yt-listings__card');
    var thumb = el('img', 'yt-listings__thumb');
    thumb.src = video.thumbnail;
    thumb.alt = video.title;
    thumb.setAttribute('loading', 'lazy');

    var link = el('a', 'yt-listings__watch outlined-button w-button', 'Watch');
    link.href = video.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', 'Watch ' + video.title + ' on YouTube (opens in a new tab)');

    var body = el('div', 'yt-listings__body');
    body.append(el('h3', 'yt-listings__title', video.title), link);
    card.append(thumb, body);
    return card;
  }

  function init() {
    var containers = document.querySelectorAll('[data-yt-listings]');
    if (!containers.length) return;

    injectStyles();
    containers.forEach(function (container) {
      container.classList.add('yt-listings');
      var placeholders = [];
      for (var i = 0; i < PLACEHOLDERS; i++) placeholders.push(placeholderCard());
      container.replaceChildren.apply(container, placeholders);
    });

    fetch(endpoint)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data.videos || !data.videos.length) throw new Error('no videos');
        containers.forEach(function (container) {
          container.replaceChildren.apply(container, data.videos.map(videoCard));
        });
      })
      .catch(function (err) {
        console.warn('[yt-listings] Could not load videos:', err.message);
        containers.forEach(function (container) {
          container.replaceChildren();
        });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
