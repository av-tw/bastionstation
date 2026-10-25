const CONFIG = {
  serverinfoUrl: 'serverinfo.json',
  identifier: 'bastion',
  address: 'www.bastionstation.com:1336',
  pollMs: 10000,
};

(() => {
  const el = (id) => document.getElementById(id);
  const demo = new URLSearchParams(location.search).has('demo');
  const endpoint = demo ? 'serverinfo.sample.json' : CONFIG.serverinfoUrl;
  const connect = el('connect');
  let address = CONFIG.address;
  let pending = false;

  function secondsToTime(seconds) {
    const total = Number(seconds) || 0;
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total / 3600) % 24;
    const minutes = String(Math.floor((total / 60) % 60)).padStart(2, '0');
    const remainder = String(Math.floor(total) % 60).padStart(2, '0');
    return `${total >= 86400 ? `${days}:` : ''}${total >= 3600 ? `${String(hours).padStart(2, '0')}:` : ''}${minutes}:${remainder}`;
  }

  function populationCap(data) {
    const extreme = Number(data.extreme_popcap);
    const hard = Number(data.hard_popcap);
    if (extreme) {
      return hard && hard < extreme ? `${hard}(${extreme})` : String(extreme);
    }
    return String(data.hard_popcap || data.popcap || '∞');
  }

  function shuttleText(data) {
    if (!data.shuttle_mode || !Number(data.shuttle_timer)) return '';
    const prefixes = { igniting: 'IGN', recalled: 'RCL', called: 'ETA', docked: 'ETD', escape: 'ESC' };
    if (data.shuttle_mode === 'stranded') return 'ERR --:--';
    if (data.shuttle_mode === 'endgame: game over') return 'FIN 00:00';
    const prefix = prefixes[data.shuttle_mode];
    return prefix ? `${prefix} ${secondsToTime(data.shuttle_timer)}` : '';
  }

  function setAddress(value) {
    // Accept a BYOND host and port, never arbitrary URL schemes from the feed.
    address = typeof value === 'string' && /^[a-z0-9.\-\[\]:]+$/i.test(value)
      ? value : CONFIG.address;
    el('address').textContent = address;
  }

  function setPopulation(data) {
    const count = data ? `${data.players}/${populationCap(data)}` : 'Unknown';
    const cap = data && Number(data.hard_popcap || data.popcap || data.extreme_popcap);
    const players = data && Number(data.players);
    const bar = el('population');
    el('population-count').textContent = data && !cap ? String(data.players) : count;
    el('population-fill').style.width = cap > 0
      ? `${Math.max(0, Math.min(100, players / cap * 100))}%` : '0%';
    bar.setAttribute('aria-valuetext', data && !cap ? `${data.players} players, no cap` : count);
    ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].forEach((attr) => bar.removeAttribute(attr));
    if (cap > 0) {
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(cap));
      bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(cap, players))));
    }
  }

  function render(data) {
    const error = !data || Object.hasOwn(data, 'ERROR') || data.players == null || data.version == null;
    const state = error ? 'offline' : [2, 3].includes(Number(data.gamestate))
      ? 'underway' : Number(data.gamestate) === 4 ? 'ending' : 'lobby';
    el('server').dataset.state = state;
    el('state').textContent = { offline: 'Offline', underway: 'Round underway', ending: 'Round ending', lobby: 'In lobby' }[state];
    el('pop-total').textContent = error ? 'Player count unavailable' : `${data.players} players online`;
    el('version').textContent = error ? String(data?.errortext || 'Connection Error!')
      : `Playing ${Object.hasOwn(data, 'custom_event') ? `Event ${data.custom_event}` : `${data.version}${Object.hasOwn(data, 'mode') ? ` mode "${data.mode}"` : ''}`}`;
    el('map').textContent = error ? 'Unknown' : String(data.map_name ?? 'Unknown');
    el('round').textContent = error ? 'Unknown' : `#${data.round_id ?? '?'} · ${secondsToTime(data.round_duration)}`;
    const shuttle = error ? '' : shuttleText(data);
    el('shuttle').textContent = shuttle;
    el('shuttle').hidden = el('shuttle-label').hidden = !shuttle;
    const level = error ? 'unknown' : String(data.security_level || 'unknown').toLowerCase();
    el('alert').textContent = level.charAt(0).toUpperCase() + level.slice(1);
    el('alert').className = ['green', 'blue', 'red', 'delta'].includes(level) ? `alert-${level}` : '';
    el('admins').textContent = error ? 'Unknown' : String(data.admins ?? 'Unknown');
    setPopulation(error ? null : data);
    el('badges').replaceChildren();
    if (!error) {
      for (const [show, text] of [[data.bunkered === true, 'Bunker on'], [data.hub === true, 'On BYOND hub']]) {
        if (!show) continue;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = text;
        el('badges').append(badge);
      }
    }
    el('badges').hidden = !el('badges').childElementCount;
    const revision = el('revision');
    revision.textContent = 'Unknown';
    if (!error && data.revision) {
      const hash = String(data.revision);
      // Plain text: the server reports its TGS merge commit, which is not pushed to GitHub.
      revision.textContent = hash.slice(0, 7);
      const date = String(data.revision_date || '').match(/^\d{4}-\d{2}-\d{2}/);
      if (date) revision.append(document.createTextNode(` · ${date[0]}`));
    }
    setAddress(error ? CONFIG.address : data.public_address);
    // Connect stays live without stats: the game server can be up while the stats feed is not.
    connect.href = `byond://${address}`;
  }

  async function poll() {
    if (document.hidden || pending) return;
    pending = true;
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Status request failed');
      const payload = await response.json();
      const entry = payload.servers.find((server) => server.identifier === CONFIG.identifier);
      render(entry?.data);
    } catch {
      render(null);
    } finally {
      pending = false;
    }
  }

  el('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address);
      el('copy-status').textContent = 'Copied';
    } catch {
      el('copy-status').textContent = 'Select the address to copy it.';
      const range = document.createRange();
      range.selectNodeContents(el('address'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  document.querySelector('#notice .x').addEventListener('click', () => el('notice').remove());
  el('demo-note').hidden = !demo;
  setAddress(CONFIG.address);

  // Header sprite: the Bastion wall first, then shuffled items. Click advances; auto-advance skips reduced motion.
  const sprites = [
    ['crowbar', 'Crowbar'], ['toolbox', 'Mechanical toolbox'], ['clown-mask', 'Clown mask'], ['stun-baton', 'Stun baton'],
    ['extinguisher', 'Fire extinguisher'], ['medkit', 'Medkit'], ['plasma-tank', 'Plasma tank'], ['banana', 'Banana'],
    ['corgi', 'Corgi'], ['moth-plush', 'Moth plushie'],
  ].sort(() => Math.random() - 0.5);
  sprites.unshift(['bastion-wall', 'Bastion wall']);
  const spriteImg = el('sprite').querySelector('img');
  let spriteAt = 0;
  for (const [slug] of sprites) new Image().src = `icons/${slug}.png`;
  function nextSprite() {
    spriteAt = (spriteAt + 1) % sprites.length;
    const [slug, label] = sprites[spriteAt];
    spriteImg.src = `icons/${slug}.png`;
    spriteImg.alt = spriteImg.title = label;
  }
  el('sprite').addEventListener('click', nextSprite);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(() => { if (!document.hidden) nextSprite(); }, 6000);
  }

  // Box-shadow stars, generated once, on a 2400x2000 tile. Each layer drifts one whole tile
  // along [tx, ty] (CSS reads --dx/--dy), with copies on the trailing side so the loop is seamless.
  // Bigger stars move faster for parallax.
  const W = 2400, H = 2000;
  for (const [size, count, color, tx, ty, pxPerSec] of [
    [1, 600, '#aaa', 0, -1, 7], [2, 160, '#bbb', -1, 0, 10], [2, 140, '#657e82', 1, -1, 10], [3, 14, '#8b6d2c', -1, 1, 17],
  ]) {
    const layer = document.createElement('i');
    layer.style.width = layer.style.height = `${size}px`;
    layer.style.setProperty('--dx', `${tx * W}px`);
    layer.style.setProperty('--dy', `${ty * H}px`);
    layer.style.animationDuration = `${Math.round(Math.hypot(tx * W, ty * H) / pxPerSec)}s`;
    const offsets = [[0, 0], [-tx * W, 0], [0, -ty * H], [-tx * W, -ty * H]]
      .filter(([ox, oy], i, all) => all.findIndex(([x, y]) => x === ox && y === oy) === i);
    layer.style.boxShadow = Array.from({ length: count }, () => {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      return offsets.map(([ox, oy]) => `${x + ox}px ${y + oy}px ${color}`).join(',');
    }).join(',');
    el('space').append(layer);
  }
  poll();
  setInterval(poll, CONFIG.pollMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
