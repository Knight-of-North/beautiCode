import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

/**
 * Minimal DOM for console.js placement. Mirrors DSH 0.1.2-alpha.5 through
 * 0.1.5-rc.1: footArea > settingsArea > (optional display:contents slot) >
 * triggerRow (horizontal flex) > settings button. Putting #beauticode-console
 * inside triggerRow squeezes the settings button to zero width (Issue #37).
 * Counting the contents wrapper as a layout parent inserts into the collapsed
 * settingsArea row instead of footArea (Issue #39).
 */
class FakeNode {
  constructor(tagName, document) {
    this.tagName = String(tagName).toUpperCase();
    this.document = document;
    this.id = "";
    this.className = "";
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this._innerHTML = "";
    this.textContent = "";
    this.listeners = new Map();
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const on = force === undefined ? !names.has(name) : Boolean(force);
        if (on) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
        return on;
      },
    };
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_all, ch) => ch.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) != null;
  }

  set innerHTML(html) {
    this._innerHTML = String(html);
    for (const child of [...this.children]) child.remove();
    const re = /<([a-z0-9]+)([^>]*)>/gi;
    let match;
    while ((match = re.exec(this._innerHTML))) {
      const tag = match[1].toLowerCase();
      if (["svg", "path", "rect", "circle", "strong", "small", "h2"].includes(tag)) {
        continue;
      }
      const attrs = match[2];
      const classMatch = attrs.match(/class="([^"]*)"/);
      if (tag === "span" && !classMatch) continue;
      const child = this.document.createElement(tag);
      if (classMatch) child.className = classMatch[1];
      for (const attr of attrs.matchAll(/([a-z0-9:-]+)="([^"]*)"/gi)) {
        if (attr[1] === "class") continue;
        child.setAttribute(attr[1], attr[2]);
      }
      this.append(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  insertBefore(node, ref) {
    node.remove();
    node.parentElement = this;
    const index = ref ? this.children.indexOf(ref) : -1;
    if (index >= 0) this.children.splice(index, 0, node);
    else this.children.push(node);
    return node;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(name, handler) {
    const list = this.listeners.get(name) ?? [];
    list.push(handler);
    this.listeners.set(name, list);
  }

  click() {
    this.clicks = (this.clicks ?? 0) + 1;
    for (const handler of this.listeners.get("click") ?? []) {
      handler({ target: this, stopPropagation() {} });
    }
  }

  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    const attr = selector.match(/^(\w+)?\[([^=\]]+)=["']([^"']+)["']\]$/);
    if (attr) {
      const [, tag, name, value] = attr;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      return this.getAttribute(name) === value;
    }
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName === selector.toUpperCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getBoundingClientRect() {
    if (this.getAttribute("aria-haspopup") !== "dialog") {
      return { width: 36, height: 36, left: 8, top: 724, bottom: 760 };
    }
    const squeezed = this.parentElement?.children.some(
      (child) => child.id === "beauticode-console",
    );
    if (squeezed) {
      return { width: 0, height: 0, left: 8, top: 0, bottom: 0 };
    }
    return { width: 36, height: 36, left: 8, top: 724, bottom: 760 };
  }
}

function createConsoleDocument() {
  const document = {
    createElement(tagName) {
      const node = new FakeNode(tagName, document);
      if (tagName === "input") node.type = "";
      return node;
    },
    addEventListener() {},
  };
  const documentElement = new FakeNode("html", document);
  const head = new FakeNode("head", document);
  const body = new FakeNode("body", document);
  document.documentElement = documentElement;
  document.head = head;
  document.body = body;
  documentElement.append(head, body);
  document.querySelectorAll = (selector) => documentElement.querySelectorAll(selector);
  document.getElementById = (id) => documentElement.querySelector(`#${id}`);
  return document;
}

function mountAlpha5Sidebar(document) {
  const footArea = document.createElement("div");
  footArea.id = "foot-area";
  const settingsArea = document.createElement("div");
  settingsArea.id = "settings-area";
  const triggerRow = document.createElement("div");
  triggerRow.id = "trigger-row";
  triggerRow.style.display = "flex";
  triggerRow.style.flexDirection = "row";
  const settings = document.createElement("button");
  settings.id = "dsh-settings";
  settings.setAttribute("aria-haspopup", "dialog");
  triggerRow.append(settings);
  settingsArea.append(triggerRow);
  footArea.append(settingsArea);
  document.body.append(footArea);
  return { footArea, settingsArea, triggerRow, settings };
}

/**
 * DSH 0.1.5-rc.1 collapsed rail: SlotOutlet wraps sidebar.settings in a
 * display:contents [data-slot] node, and .settingsArea becomes a horizontal
 * flex. Counting raw parentElement hops then inserts into that row — Issue #39.
 */
function mountCollapsedRailSidebar(document) {
  const footArea = document.createElement("div");
  footArea.id = "foot-area";
  footArea.style.display = "flex";
  footArea.style.flexDirection = "column";
  const footerActions = document.createElement("div");
  footerActions.id = "footer-actions";
  const settingsArea = document.createElement("div");
  settingsArea.id = "settings-area";
  settingsArea.style.display = "flex";
  const slot = document.createElement("div");
  slot.id = "settings-slot";
  slot.setAttribute("data-slot", "sidebar.settings");
  slot.style.display = "contents";
  const triggerRow = document.createElement("div");
  triggerRow.id = "trigger-row";
  triggerRow.style.display = "flex";
  triggerRow.style.flexDirection = "row";
  const settings = document.createElement("button");
  settings.id = "dsh-settings";
  settings.setAttribute("aria-haspopup", "dialog");
  triggerRow.append(settings);
  slot.append(triggerRow);
  settingsArea.append(slot);
  footArea.append(footerActions, settingsArea);
  document.body.append(footArea);
  return { footArea, footerActions, settingsArea, slot, triggerRow, settings };
}

async function loadConsole(document, { fetch: fetchImpl } = {}) {
  const source = await fs.readFile(new URL("../console.js", import.meta.url), "utf8");
  const ticks = [];
  const context = {
    window: null,
    document,
    MutationObserver: class {
      observe() {}
    },
    addEventListener() {},
    innerHeight: 800,
    setInterval: (fn) => {
      ticks.push(fn);
      return ticks.length;
    },
    // console.js request() builds a timeout guard on every call; without these
    // the guard throws and refresh() falls back to its error branch, so the
    // status payload never reaches renderStatus().
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl ?? (async () => ({ ok: false, json: async () => ({}) })),
    getComputedStyle: (el) => ({ display: el?.style?.display || "block" }),
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return {
    tick() {
      for (const fn of ticks) fn();
    },
  };
}

test("console mounts above the settings area instead of inside the trigger row", async () => {
  const document = createConsoleDocument();
  const { footArea, settingsArea, triggerRow, settings } = mountAlpha5Sidebar(document);
  const runtime = await loadConsole(document);

  const snapshots = [];
  const capture = () => {
    const host = document.getElementById("beauticode-console");
    snapshots.push({
      parent: host?.parentElement?.id ?? null,
      next: host?.nextElementSibling?.id ?? null,
      settingsWidth: settings.getBoundingClientRect().width,
      inTriggerRow: triggerRow.children.includes(host),
    });
  };

  capture();
  for (let i = 0; i < 6; i += 1) {
    runtime.tick();
    capture();
  }

  const host = document.getElementById("beauticode-console");
  assert.equal(host?.parentElement?.id, "foot-area");
  assert.equal(host?.nextElementSibling?.id, "settings-area");
  assert.equal(triggerRow.children.map((child) => child.id).join(","), "dsh-settings");
  assert.equal(host.parentElement, footArea);
  assert.equal(host.nextElementSibling, settingsArea);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.parent, "foot-area");
    assert.equal(snapshot.next, "settings-area");
    assert.equal(snapshot.settingsWidth, 36);
    assert.equal(snapshot.inTriggerRow, false);
  }
});

test("console skips display:contents slot wrappers so collapsed rail stacks vertically", async () => {
  const document = createConsoleDocument();
  const { footArea, settingsArea, slot, triggerRow, settings } = mountCollapsedRailSidebar(document);
  const runtime = await loadConsole(document);

  const snapshots = [];
  const capture = () => {
    const host = document.getElementById("beauticode-console");
    snapshots.push({
      parent: host?.parentElement?.id ?? null,
      next: host?.nextElementSibling?.id ?? null,
      inSettingsArea: settingsArea.children.includes(host),
      inSlot: slot.children.includes(host),
      inTriggerRow: triggerRow.children.includes(host),
      settingsWidth: settings.getBoundingClientRect().width,
    });
  };

  capture();
  for (let i = 0; i < 6; i += 1) {
    runtime.tick();
    capture();
  }

  const host = document.getElementById("beauticode-console");
  assert.equal(host?.parentElement?.id, "foot-area");
  assert.equal(host?.nextElementSibling?.id, "settings-area");
  assert.equal(host.parentElement, footArea);
  assert.equal(host.nextElementSibling, settingsArea);
  assert.equal(settingsArea.children.map((child) => child.id).join(","), "settings-slot");
  assert.equal(triggerRow.children.map((child) => child.id).join(","), "dsh-settings");
  for (const snapshot of snapshots) {
    assert.equal(snapshot.parent, "foot-area");
    assert.equal(snapshot.next, "settings-area");
    assert.equal(snapshot.inSettingsArea, false);
    assert.equal(snapshot.inSlot, false);
    assert.equal(snapshot.inTriggerRow, false);
    assert.equal(snapshot.settingsWidth, 36);
  }
});

test("console pop includes a dim slider and restore-default control", async () => {
  const document = createConsoleDocument();
  mountAlpha5Sidebar(document);
  await loadConsole(document);

  const pop = document.getElementById("beauticode-console-pop");
  assert.match(pop.innerHTML, /class="bc-dim-slider"/);
  assert.match(pop.innerHTML, /type="range"/);
  assert.match(pop.innerHTML, /恢复默认/);
  assert.match(pop.innerHTML, /data-act="dim-reset"/);
  assert.ok(pop.querySelector(".bc-dim-slider"));
  assert.ok(pop.querySelector('[data-act="dim-reset"]'));
  assert.equal(pop.querySelector(".bc-dim-value")?.textContent, "自动");
  assert.equal(pop.querySelector('[data-act="dim-reset"]').hidden, true);
});

const flushAsync = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Safari (and WebKit generally) only opens a file picker when input.click()
 * runs synchronously inside the user-gesture handler; a click deferred past an
 * await silently does nothing. On every non-Windows platform /ui/pick can only
 * answer native_picker_unavailable, so asking it first put the fallback click
 * behind a round trip and the picker never appeared.
 */
test("console opens the file picker inside the click when managed upload is allowed", async () => {
  const document = createConsoleDocument();
  mountAlpha5Sidebar(document);
  await loadConsole(document, {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        importPolicy: { nativeLocalRequired: false, managedUploadAllowed: true },
      }),
    }),
  });

  document.querySelectorAll(".bc-trigger")[0].click();
  await flushAsync();

  const fileInput = document.getElementById("beauticode-console-file");
  const imageButton = document.querySelectorAll('[data-act="image"]')[0];
  assert.ok(imageButton, "image import button is wired");

  imageButton.click();
  // No await between the click and these assertions: the picker must open in
  // the same synchronous block as the gesture, not after a round trip.
  assert.equal(fileInput.clicks, 1, "file picker opens from the click handler");
  assert.match(fileInput.accept, /image\/jpeg/);
  assert.equal(fileInput.dataset.compatibilityUpload, "true");
});

test("console leaves the browser picker closed when the host picker is required", async () => {
  const document = createConsoleDocument();
  mountAlpha5Sidebar(document);
  await loadConsole(document, {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        cancelled: true,
        importPolicy: { nativeLocalRequired: true, managedUploadAllowed: false },
      }),
    }),
  });

  document.querySelectorAll(".bc-trigger")[0].click();
  await flushAsync();

  const fileInput = document.getElementById("beauticode-console-file");
  const imageButton = document.querySelectorAll('[data-act="image"]')[0];
  imageButton.click();
  assert.equal(fileInput.clicks ?? 0, 0, "the host picker path opens no browser picker");

  await flushAsync();
  assert.equal(fileInput.clicks ?? 0, 0, "and none appears once the round trip settles");
});
