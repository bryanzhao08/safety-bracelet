// web/app/ui/thread.js - draws the night timeline's "string": one fluid SVG thread that sways
// through every node in a list, colored by node type, and (optionally) draws itself in with the
// nodes popping as the thread reaches them.
const SVG_NS = 'http://www.w3.org/2000/svg';
let uid = 0;

/**
 * listEl: positioned container holding rows; each row has a `.tl-node` whose
 * `data-color` is a CSS color. Returns a cleanup function.
 */
export function drawThread(listEl, { animate = false } = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let svg = null;

  function build(withAnimation) {
    svg?.remove();
    const nodes = [...listEl.querySelectorAll('.tl-node')];
    if (nodes.length === 0) return;

    const box = listEl.getBoundingClientRect();
    const pts = nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, color: n.dataset.color };
    });
    const height = Math.max(box.height, pts[pts.length - 1].y + 8);

    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tl-thread');
    svg.setAttribute('width', String(box.width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('aria-hidden', 'true');

    // Vertical gradient whose stops sit at each node, so the string changes color node to node
    const gid = `tl-grad-${++uid}`;
    const defs = document.createElementNS(SVG_NS, 'defs');
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    grad.setAttribute('id', gid);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', '0'); grad.setAttribute('x2', '0');
    grad.setAttribute('y1', '0'); grad.setAttribute('y2', String(height));
    for (const p of pts) {
      const stop = document.createElementNS(SVG_NS, 'stop');
      stop.setAttribute('offset', String(Math.min(1, Math.max(0, p.y / height))));
      stop.style.stopColor = p.color;
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Smooth thread: from node to node with a gentle alternating sway
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dy = b.y - a.y;
      const sway = Math.min(14, dy * 0.18) * (i % 2 ? 1 : -1);
      d += ` C ${a.x + sway} ${a.y + dy * 0.45}, ${b.x + sway} ${b.y - dy * 0.45}, ${b.x} ${b.y}`;
    }

    const glow = document.createElementNS(SVG_NS, 'path');
    glow.setAttribute('d', d);
    glow.setAttribute('class', 'tl-thread-glow');
    glow.setAttribute('stroke', `url(#${gid})`);
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', d);
    line.setAttribute('class', 'tl-thread-line');
    line.setAttribute('stroke', `url(#${gid})`);
    svg.append(glow, line);
    listEl.prepend(svg);

    if (!withAnimation || reduce || pts.length < 2) {
      listEl.classList.add('tl-shown');
      return;
    }

    // Draw-in: the thread grows top to bottom; each row appears as the thread reaches it
    const total = line.getTotalLength();
    const duration = Math.min(1600, 320 + 160 * pts.length);
    const ease = 'cubic-bezier(.22,.8,.26,1)';
    for (const path of [line, glow]) {
      path.style.strokeDasharray = `${total}`;
      path.animate([{ strokeDashoffset: total }, { strokeDashoffset: 0 }], { duration, easing: ease, fill: 'both' });
    }
    const span = pts[pts.length - 1].y - pts[0].y || 1;
    nodes.forEach((node, i) => {
      // Ease-out means the thread reaches lower nodes later than linear; approximate with sqrt
      const t = Math.pow((pts[i].y - pts[0].y) / span, 1.6);
      const delay = Math.round(t * duration * 0.9);
      const row = node.closest('.tl-row') || node;
      row.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, delay, easing: 'ease-out', fill: 'both' },
      );
      node.animate(
        [{ transform: 'scale(.2)' }, { transform: 'scale(1.18)', offset: 0.6 }, { transform: 'scale(1)' }],
        { duration: 420, delay, easing: 'ease-out', fill: 'both' },
      );
    });
    listEl.classList.add('tl-shown');
  }

  build(animate);

  // Redraw (without animating) when the layout changes width
  let lastW = listEl.clientWidth;
  const ro = new ResizeObserver(() => {
    if (listEl.clientWidth !== lastW) { lastW = listEl.clientWidth; build(false); }
  });
  ro.observe(listEl);
  return () => { ro.disconnect(); svg?.remove(); };
}
