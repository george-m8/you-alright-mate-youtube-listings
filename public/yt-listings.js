/* YouTube listings for Webflow: renders the latest videos or Shorts into every [data-yt-listings] element.
 *
 * Options (data attributes on the container, see README):
 *   data-yt-source="videos|shorts"   data-yt-limit="1-30"   data-yt-layout="grid|list"
 *   data-yt-thumb="left|right|alternate"   data-yt-description   data-yt-links
 */
(function () {
  var script = document.currentScript;
  var endpoint = new URL('/videos', (script && script.src) || location.href).href;
  var MAX_ITEMS = 30;

  // :where() keeps the button fallback at zero specificity so the site's own
  // .outlined-button styles win on Webflow; the fallback only shows elsewhere.
  var CSS = [
    '.yt-listings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;width:100%}',
    '.yt-listings--shorts{grid-template-columns:repeat(4,minmax(0,1fr))}',
    '.yt-listings--list{grid-template-columns:minmax(0,1fr)}',
    '.yt-listings__card{min-width:0;display:flex;flex-direction:column;box-sizing:border-box;background:#000;border:2px solid #fff;color:#fff}',
    '.yt-listings__media{position:relative}',
    '.yt-listings__thumb{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1a1a1a}',
    '.yt-listings--shorts .yt-listings__thumb{aspect-ratio:9/16}',
    '.yt-listings__body{display:flex;flex-direction:column;flex:1;gap:16px;padding:16px}',
    '.yt-listings__title{margin:0;min-height:78px;font:inherit;font-size:18px;line-height:26px;font-weight:400;text-align:center;text-transform:uppercase;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.yt-listings--shorts .yt-listings__title{min-height:40px;font-size:14px;line-height:20px;-webkit-line-clamp:2}',
    '.yt-listings__description{margin:0;font-size:14px;line-height:22px;text-align:center;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.yt-listings__links{margin:0;font-size:14px;line-height:22px;text-align:center}',
    '.yt-listings__links a{color:inherit;text-decoration:underline}',
    '.yt-listings__watch{margin-top:auto;align-self:center}',
    ':where(.yt-listings) :where(.yt-listings__watch){display:inline-block;padding:4px 10px;border:3px solid #fcee21;background:transparent;color:#fcee21;font-weight:600;line-height:28px;text-align:center;text-transform:uppercase;text-decoration:none;transition:transform .2s}',
    ':where(.yt-listings) :where(.yt-listings__watch):hover{transform:scale(1.2)}',
    '.yt-listings__watch:focus-visible{outline:2px solid #fff;outline-offset:4px}',
    '.yt-listings__card--loading .yt-listings__watch{visibility:hidden}',
    '.yt-listings__card--loading .yt-listings__description{min-height:66px}',
    // List layout: the thumbnail fills one side at full height and fades into the text.
    '.yt-listings--list .yt-listings__card{flex-direction:row}',
    '.yt-listings--list .yt-listings__card--flip{flex-direction:row-reverse}',
    '.yt-listings--list .yt-listings__media{flex:0 0 55%;aspect-ratio:16/9}',
    '.yt-listings--list .yt-listings__media::after{content:"";position:absolute;inset:0;background:linear-gradient(to right,transparent 45%,#000)}',
    '.yt-listings--list .yt-listings__card--flip .yt-listings__media::after{background:linear-gradient(to left,transparent 45%,#000)}',
    '.yt-listings--list .yt-listings__thumb{position:absolute;inset:0;height:100%;aspect-ratio:auto}',
    '.yt-listings--list .yt-listings__body{justify-content:center;padding:24px 32px}',
    '.yt-listings--list .yt-listings__title{min-height:0;font-size:22px;line-height:30px;text-align:left;-webkit-line-clamp:2}',
    '.yt-listings--list .yt-listings__description{text-align:left;-webkit-line-clamp:4}',
    '.yt-listings--list .yt-listings__links{text-align:left}',
    '.yt-listings--list .yt-listings__watch{margin-top:8px;align-self:flex-start}',
    '@media (max-width:767px){' +
      '.yt-listings{grid-template-columns:minmax(0,1fr)}' +
      '.yt-listings--shorts{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.yt-listings--list .yt-listings__card,.yt-listings--list .yt-listings__card--flip{flex-direction:column}' +
      '.yt-listings--list .yt-listings__media{flex:none}' +
      '.yt-listings--list .yt-listings__media::after,.yt-listings--list .yt-listings__card--flip .yt-listings__media::after{background:linear-gradient(to bottom,transparent 55%,#000)}' +
      '.yt-listings--list .yt-listings__body{padding:16px}' +
    '}',
  ].join('\n');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
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

  // Webflow custom attributes always have a value, so any value except "false" turns a flag on.
  function flag(value) {
    return value !== undefined && value !== 'false';
  }

  function readOptions(container) {
    var data = container.dataset;
    var shorts = data.ytSource === 'shorts';
    var limit = parseInt(data.ytLimit, 10) || (shorts ? 4 : 3);
    return {
      source: shorts ? 'shorts' : 'videos',
      layout: shorts ? 'shorts' : data.ytLayout === 'list' ? 'list' : 'grid',
      limit: Math.min(Math.max(limit, 1), MAX_ITEMS),
      thumb: data.ytThumb === 'right' || data.ytThumb === 'alternate' ? data.ytThumb : 'left',
      description: !shorts && flag(data.ytDescription),
      links: !shorts && flag(data.ytLinks),
    };
  }

  // Card frame shared by placeholders and real cards; flip puts the thumbnail on the right in the list layout.
  function cardShell(tag, index, options) {
    var flip = options.thumb === 'right' || (options.thumb === 'alternate' && index % 2 === 1);
    var card = el(tag, 'yt-listings__card' + (flip ? ' yt-listings__card--flip' : ''));
    var media = el('div', 'yt-listings__media');
    var body = el('div', 'yt-listings__body');
    card.append(media, body);
    return { card: card, media: media, body: body };
  }

  // Same box as a real card, so the layout doesn't shift when videos arrive.
  function placeholderCard(index, options) {
    var shell = cardShell('div', index, options);
    shell.card.classList.add('yt-listings__card--loading');
    shell.card.setAttribute('aria-hidden', 'true');
    shell.media.append(el('div', 'yt-listings__thumb'));
    shell.body.append(el('p', 'yt-listings__title'));
    if (options.description) shell.body.append(el('p', 'yt-listings__description'));
    shell.body.append(el('span', 'yt-listings__watch', 'Watch'));
    return shell.card;
  }

  function externalLink(className, text, url) {
    var link = el('a', className, text);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  function platformLinks(links) {
    var line = el('p', 'yt-listings__links', 'Other ways to watch and listen: ');
    links.forEach(function (link, i) {
      if (i) line.append(', ');
      line.append(externalLink('', link.name, link.url));
    });
    return line;
  }

  function videoCard(video, index, options) {
    var shell = cardShell('article', index, options);
    var thumb = el('img', 'yt-listings__thumb');
    thumb.src = video.thumbnail;
    thumb.alt = video.title;
    thumb.setAttribute('loading', 'lazy');
    shell.media.append(thumb);

    shell.body.append(el('h3', 'yt-listings__title', video.title));
    if (options.description && video.description) {
      shell.body.append(el('p', 'yt-listings__description', video.description));
    }
    if (options.links && video.links && video.links.length) {
      shell.body.append(platformLinks(video.links));
    }

    var watch = externalLink('yt-listings__watch outlined-button w-button', 'Watch', video.url);
    watch.setAttribute('aria-label', 'Watch ' + video.title + ' on YouTube (opens in a new tab)');
    shell.body.append(watch);
    return shell.card;
  }

  function fill(container, count, makeCard) {
    var cards = [];
    for (var i = 0; i < count; i++) cards.push(makeCard(i));
    container.replaceChildren.apply(container, cards);
  }

  function init() {
    var targets = Array.prototype.map.call(document.querySelectorAll('[data-yt-listings]'), function (container) {
      return { container: container, options: readOptions(container) };
    });
    if (!targets.length) return;

    injectStyles();
    targets.forEach(function (target) {
      target.container.classList.add('yt-listings', 'yt-listings--' + target.options.layout);
      fill(target.container, target.options.limit, function (i) {
        return placeholderCard(i, target.options);
      });
    });

    fetch(endpoint)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        targets.forEach(function (target) {
          var options = target.options;
          var items = (data[options.source] || []).slice(0, options.limit);
          if (!items.length) console.warn('[yt-listings] No ' + options.source + ' to show');
          fill(target.container, items.length, function (i) {
            return videoCard(items[i], i, options);
          });
        });
      })
      .catch(function (err) {
        console.warn('[yt-listings] Could not load videos:', err.message);
        targets.forEach(function (target) {
          target.container.replaceChildren();
        });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
