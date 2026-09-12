/** Small DOM / rendering helpers shared by every tab. */

export function el(id) {
  return document.getElementById(id);
}

export function openDialog(id) {
  el(id).showModal();
}

export function closeDialog(id) {
  el(id).close();
}

/**
 * Render rows into a table's <tbody>.
 *
 * Each cell gets a `data-label` taken from its column header so the CSS can
 * stack rows into labeled cards on narrow screens. Cells built from elements
 * (action buttons) are placed as-is; the headerless last column is tagged
 * `cell-actions`.
 */
export function fillTable(tableId, rows) {
  const table = el(tableId);
  const tbody = table.querySelector("tbody");
  const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  tbody.innerHTML = "";

  if (rows.length === 0) {
    renderMessage(tbody, headers.length, "No data yet.");
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((cell, index) => {
      const td = document.createElement("td");
      if (cell instanceof HTMLElement) td.appendChild(cell);
      else td.textContent = cell ?? "";
      const label = headers[index] ?? "";
      if (label) td.dataset.label = label;
      else if (index > 0) td.classList.add("cell-actions");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

/** Fill a table body with a single message row (empty state / load error). */
export function fillTableMessage(tableId, message, { error = false } = {}) {
  const table = el(tableId);
  const tbody = table.querySelector("tbody");
  const headers = table.querySelectorAll("thead th").length;
  tbody.innerHTML = "";
  renderMessage(tbody, headers, message, error);
}

function renderMessage(tbody, columnCount, message, error = false) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.className = error ? "cell-message error" : "cell-message";
  td.colSpan = Math.max(columnCount, 1);
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

export function delButton(onClick) {
  const btn = document.createElement("button");
  btn.textContent = "Delete";
  btn.className = "danger small";
  btn.onclick = onClick;
  return btn;
}

export function smallButton(text, onClick, className) {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.className = "small";
  if (className) btn.classList.add(className);
  btn.onclick = onClick;
  return btn;
}

const COLLAPSE_MS = 180;

/**
 * Wire a toggle button to a collapsible form. The form starts hidden, the
 * button gets a caret that flips while `aria-expanded` tracks the state, and
 * opening/closing is animated.
 *
 * Returns { setOpen } so callers can collapse the form again after saving.
 */
export function bindCollapsible(toggleId, targetId) {
  const toggle = el(toggleId);
  const target = el(targetId);
  // The gap below the form has to animate too, otherwise the content below
  // jumps by that amount the moment the form finishes collapsing.
  const gap = parseFloat(getComputedStyle(target).marginBottom) || 0;

  toggle.classList.add("collapse-toggle");

  const caret = document.createElement("span");
  caret.className = "caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  toggle.appendChild(caret);

  let open = false;
  let animation = null;

  /** Apply the final (non-animated) state. */
  function render() {
    target.classList.toggle("hidden", !open);
    target.style.height = "";
    target.style.overflow = "";
    target.style.marginBottom = "";
    toggle.setAttribute("aria-expanded", String(open));
  }

  function setOpen(next, animate = true) {
    if (next === open) return;
    open = next;
    toggle.setAttribute("aria-expanded", String(open));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reducedMotion) {
      animation?.cancel();
      animation = null;
      render();
      if (open) target.querySelector("input, select")?.focus();
      return;
    }

    // Height is read before unhiding (0 while closed) so a click in the middle
    // of a running animation continues from wherever it currently is.
    const startHeight = target.getBoundingClientRect().height;
    animation?.cancel();
    if (open) target.classList.remove("hidden");
    const endHeight = open ? target.scrollHeight : 0;
    target.style.overflow = "hidden";

    animation = target.animate(
      {
        height: [`${startHeight}px`, `${endHeight}px`],
        marginBottom: open ? ["0px", `${gap}px`] : [`${gap}px`, "0px"],
      },
      { duration: COLLAPSE_MS, easing: "ease" },
    );
    animation.onfinish = () => {
      animation = null;
      render();
      if (open) target.querySelector("input, select")?.focus();
    };
  }

  toggle.onclick = () => setOpen(!open);
  render();

  return { setOpen };
}

/** Group row action buttons so they wrap cleanly (incl. mobile cards). */
export function wrapButtons(...buttons) {
  const span = document.createElement("span");
  span.className = "row-actions";
  for (const button of buttons) span.appendChild(button);
  return span;
}
