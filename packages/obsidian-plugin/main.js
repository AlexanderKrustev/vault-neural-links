"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultNeuralLinksPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/SettingTab.ts
var import_obsidian = require("obsidian");
var VaultNeuralLinksSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Minimum edge weight").setDesc(
      "Hide usage-weighted links below this weight in the graph view. Notes left with no remaining edges are hidden entirely. Native wikilinks are unaffected."
    ).addSlider(
      (slider) => slider.setLimits(0, 20, 0.5).setValue(this.plugin.settings.minWeightFilter).setDynamicTooltip().onChange((value) => {
        this.plugin.settings.minWeightFilter = value;
        void this.plugin.saveSettings();
        this.plugin.refreshGraphViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Color scheme").setDesc("Palette used for the weight gradient on neural (usage-weighted) edges.").addDropdown(
      (dropdown) => dropdown.addOption("default", "Default").addOption("high-contrast", "High contrast").setValue(this.plugin.settings.colorScheme).onChange((value) => {
        this.plugin.settings.colorScheme = value;
        void this.plugin.saveSettings();
        this.plugin.refreshGraphViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Decay half-life (days)").setDesc(
      "Should match the vault-neural-link MCP server's decay half-life. Controls how quickly edges fade toward 'stale' in the graph view \u2014 it does not change actual weight decay, which happens server-side during compaction."
    ).addText(
      (text) => text.setValue(String(this.plugin.settings.decayHalfLifeDays)).onChange((value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        this.plugin.settings.decayHalfLifeDays = parsed;
        void this.plugin.saveSettings();
        this.plugin.refreshGraphViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Continuous animation").setDesc("Keep a gentle jitter running forever instead of letting the graph settle.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.continuousAnimation).onChange((value) => {
        this.plugin.settings.continuousAnimation = value;
        void this.plugin.saveSettings();
        this.plugin.refreshGraphViews();
      })
    );
  }
};

// src/settings.ts
var DEFAULT_SETTINGS = {
  decayHalfLifeDays: 30,
  colorScheme: "default",
  minWeightFilter: 0,
  continuousAnimation: false
};

// src/view/NeuralGraphView.ts
var import_obsidian2 = require("obsidian");

// src/WeightsWatcher.ts
var POLL_INTERVAL_MS = 2e3;
var DEBOUNCE_MS = 500;
function loadFs() {
  try {
    return require("node:fs");
  } catch {
    return null;
  }
}
var WeightsWatcher = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  fsWatcher = null;
  pollHandle = null;
  debounceHandle = null;
  previous = null;
  onChange = null;
  onError = null;
  start(onChange, onError) {
    this.onChange = onChange;
    this.onError = onError ?? null;
    void this.reload();
    const fs = loadFs();
    if (fs) {
      try {
        this.fsWatcher = fs.watch(this.filePath, () => this.scheduleReload());
        return;
      } catch {
        this.fsWatcher = null;
      }
    }
    this.pollHandle = setInterval(() => void this.reload(), POLL_INTERVAL_MS);
  }
  stop() {
    this.fsWatcher?.close();
    this.fsWatcher = null;
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.onChange = null;
    this.onError = null;
  }
  scheduleReload() {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => void this.reload(), DEBOUNCE_MS);
  }
  async reload() {
    const fs = loadFs();
    if (!fs) return;
    fs.readFile(this.filePath, "utf-8", (err, data) => {
      if (err) {
        this.onError?.(err);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (parseErr) {
        this.onError?.(parseErr);
        return;
      }
      if (this.previous?.compactedAt === parsed.compactedAt) return;
      const previous = this.previous;
      this.previous = parsed;
      this.onChange?.(parsed, previous);
    });
  }
};

// src/PrimedWatcher.ts
var POLL_INTERVAL_MS2 = 2e3;
var STALE_MS = 15 * 60 * 1e3;
function loadFs2() {
  try {
    return require("node:fs");
  } catch {
    return null;
  }
}
var PrimedWatcher = class {
  constructor(sessionDir) {
    this.sessionDir = sessionDir;
  }
  pollHandle = null;
  previousKey = "";
  onChange = null;
  start(onChange) {
    this.onChange = onChange;
    void this.reload();
    this.pollHandle = setInterval(() => void this.reload(), POLL_INTERVAL_MS2);
  }
  stop() {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.onChange = null;
  }
  async reload() {
    const fs = loadFs2();
    if (!fs) return;
    const files = await new Promise((resolve) => {
      fs.readdir(this.sessionDir, (err, entries) => resolve(err ? [] : entries));
    });
    const now2 = Date.now();
    const primed = /* @__PURE__ */ new Set();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await new Promise((resolve) => {
        fs.readFile(`${this.sessionDir}/${file}`, "utf-8", (err, data) => resolve(err ? null : data));
      });
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (now2 - Date.parse(parsed.updatedAt) > STALE_MS) continue;
      for (const note of parsed.notes) primed.add(note);
    }
    const key = [...primed].sort().join("|");
    if (key === this.previousKey) return;
    this.previousKey = key;
    this.onChange?.(primed);
  }
};

// ../../node_modules/d3-force/src/center.js
function center_default(x3, y3) {
  var nodes, strength = 1;
  if (x3 == null) x3 = 0;
  if (y3 == null) y3 = 0;
  function force() {
    var i, n = nodes.length, node, sx = 0, sy = 0;
    for (i = 0; i < n; ++i) {
      node = nodes[i], sx += node.x, sy += node.y;
    }
    for (sx = (sx / n - x3) * strength, sy = (sy / n - y3) * strength, i = 0; i < n; ++i) {
      node = nodes[i], node.x -= sx, node.y -= sy;
    }
  }
  force.initialize = function(_) {
    nodes = _;
  };
  force.x = function(_) {
    return arguments.length ? (x3 = +_, force) : x3;
  };
  force.y = function(_) {
    return arguments.length ? (y3 = +_, force) : y3;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = +_, force) : strength;
  };
  return force;
}

// ../../node_modules/d3-quadtree/src/add.js
function add_default(d) {
  const x3 = +this._x.call(null, d), y3 = +this._y.call(null, d);
  return add(this.cover(x3, y3), x3, y3, d);
}
function add(tree, x3, y3, d) {
  if (isNaN(x3) || isNaN(y3)) return tree;
  var parent, node = tree._root, leaf = { data: d }, x0 = tree._x0, y0 = tree._y0, x1 = tree._x1, y1 = tree._y1, xm, ym, xp, yp, right, bottom, i, j;
  if (!node) return tree._root = leaf, tree;
  while (node.length) {
    if (right = x3 >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
    if (parent = node, !(node = node[i = bottom << 1 | right])) return parent[i] = leaf, tree;
  }
  xp = +tree._x.call(null, node.data);
  yp = +tree._y.call(null, node.data);
  if (x3 === xp && y3 === yp) return leaf.next = node, parent ? parent[i] = leaf : tree._root = leaf, tree;
  do {
    parent = parent ? parent[i] = new Array(4) : tree._root = new Array(4);
    if (right = x3 >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
  } while ((i = bottom << 1 | right) === (j = (yp >= ym) << 1 | xp >= xm));
  return parent[j] = node, parent[i] = leaf, tree;
}
function addAll(data) {
  var d, i, n = data.length, x3, y3, xz = new Array(n), yz = new Array(n), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (i = 0; i < n; ++i) {
    if (isNaN(x3 = +this._x.call(null, d = data[i])) || isNaN(y3 = +this._y.call(null, d))) continue;
    xz[i] = x3;
    yz[i] = y3;
    if (x3 < x0) x0 = x3;
    if (x3 > x1) x1 = x3;
    if (y3 < y0) y0 = y3;
    if (y3 > y1) y1 = y3;
  }
  if (x0 > x1 || y0 > y1) return this;
  this.cover(x0, y0).cover(x1, y1);
  for (i = 0; i < n; ++i) {
    add(this, xz[i], yz[i], data[i]);
  }
  return this;
}

// ../../node_modules/d3-quadtree/src/cover.js
function cover_default(x3, y3) {
  if (isNaN(x3 = +x3) || isNaN(y3 = +y3)) return this;
  var x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1;
  if (isNaN(x0)) {
    x1 = (x0 = Math.floor(x3)) + 1;
    y1 = (y0 = Math.floor(y3)) + 1;
  } else {
    var z = x1 - x0 || 1, node = this._root, parent, i;
    while (x0 > x3 || x3 >= x1 || y0 > y3 || y3 >= y1) {
      i = (y3 < y0) << 1 | x3 < x0;
      parent = new Array(4), parent[i] = node, node = parent, z *= 2;
      switch (i) {
        case 0:
          x1 = x0 + z, y1 = y0 + z;
          break;
        case 1:
          x0 = x1 - z, y1 = y0 + z;
          break;
        case 2:
          x1 = x0 + z, y0 = y1 - z;
          break;
        case 3:
          x0 = x1 - z, y0 = y1 - z;
          break;
      }
    }
    if (this._root && this._root.length) this._root = node;
  }
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  return this;
}

// ../../node_modules/d3-quadtree/src/data.js
function data_default() {
  var data = [];
  this.visit(function(node) {
    if (!node.length) do
      data.push(node.data);
    while (node = node.next);
  });
  return data;
}

// ../../node_modules/d3-quadtree/src/extent.js
function extent_default(_) {
  return arguments.length ? this.cover(+_[0][0], +_[0][1]).cover(+_[1][0], +_[1][1]) : isNaN(this._x0) ? void 0 : [[this._x0, this._y0], [this._x1, this._y1]];
}

// ../../node_modules/d3-quadtree/src/quad.js
function quad_default(node, x0, y0, x1, y1) {
  this.node = node;
  this.x0 = x0;
  this.y0 = y0;
  this.x1 = x1;
  this.y1 = y1;
}

// ../../node_modules/d3-quadtree/src/find.js
function find_default(x3, y3, radius) {
  var data, x0 = this._x0, y0 = this._y0, x1, y1, x22, y22, x32 = this._x1, y32 = this._y1, quads = [], node = this._root, q, i;
  if (node) quads.push(new quad_default(node, x0, y0, x32, y32));
  if (radius == null) radius = Infinity;
  else {
    x0 = x3 - radius, y0 = y3 - radius;
    x32 = x3 + radius, y32 = y3 + radius;
    radius *= radius;
  }
  while (q = quads.pop()) {
    if (!(node = q.node) || (x1 = q.x0) > x32 || (y1 = q.y0) > y32 || (x22 = q.x1) < x0 || (y22 = q.y1) < y0) continue;
    if (node.length) {
      var xm = (x1 + x22) / 2, ym = (y1 + y22) / 2;
      quads.push(
        new quad_default(node[3], xm, ym, x22, y22),
        new quad_default(node[2], x1, ym, xm, y22),
        new quad_default(node[1], xm, y1, x22, ym),
        new quad_default(node[0], x1, y1, xm, ym)
      );
      if (i = (y3 >= ym) << 1 | x3 >= xm) {
        q = quads[quads.length - 1];
        quads[quads.length - 1] = quads[quads.length - 1 - i];
        quads[quads.length - 1 - i] = q;
      }
    } else {
      var dx = x3 - +this._x.call(null, node.data), dy = y3 - +this._y.call(null, node.data), d2 = dx * dx + dy * dy;
      if (d2 < radius) {
        var d = Math.sqrt(radius = d2);
        x0 = x3 - d, y0 = y3 - d;
        x32 = x3 + d, y32 = y3 + d;
        data = node.data;
      }
    }
  }
  return data;
}

// ../../node_modules/d3-quadtree/src/remove.js
function remove_default(d) {
  if (isNaN(x3 = +this._x.call(null, d)) || isNaN(y3 = +this._y.call(null, d))) return this;
  var parent, node = this._root, retainer, previous, next, x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1, x3, y3, xm, ym, right, bottom, i, j;
  if (!node) return this;
  if (node.length) while (true) {
    if (right = x3 >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
    if (!(parent = node, node = node[i = bottom << 1 | right])) return this;
    if (!node.length) break;
    if (parent[i + 1 & 3] || parent[i + 2 & 3] || parent[i + 3 & 3]) retainer = parent, j = i;
  }
  while (node.data !== d) if (!(previous = node, node = node.next)) return this;
  if (next = node.next) delete node.next;
  if (previous) return next ? previous.next = next : delete previous.next, this;
  if (!parent) return this._root = next, this;
  next ? parent[i] = next : delete parent[i];
  if ((node = parent[0] || parent[1] || parent[2] || parent[3]) && node === (parent[3] || parent[2] || parent[1] || parent[0]) && !node.length) {
    if (retainer) retainer[j] = node;
    else this._root = node;
  }
  return this;
}
function removeAll(data) {
  for (var i = 0, n = data.length; i < n; ++i) this.remove(data[i]);
  return this;
}

// ../../node_modules/d3-quadtree/src/root.js
function root_default() {
  return this._root;
}

// ../../node_modules/d3-quadtree/src/size.js
function size_default() {
  var size = 0;
  this.visit(function(node) {
    if (!node.length) do
      ++size;
    while (node = node.next);
  });
  return size;
}

// ../../node_modules/d3-quadtree/src/visit.js
function visit_default(callback) {
  var quads = [], q, node = this._root, child, x0, y0, x1, y1;
  if (node) quads.push(new quad_default(node, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    if (!callback(node = q.node, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1) && node.length) {
      var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[3]) quads.push(new quad_default(child, xm, ym, x1, y1));
      if (child = node[2]) quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[1]) quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[0]) quads.push(new quad_default(child, x0, y0, xm, ym));
    }
  }
  return this;
}

// ../../node_modules/d3-quadtree/src/visitAfter.js
function visitAfter_default(callback) {
  var quads = [], next = [], q;
  if (this._root) quads.push(new quad_default(this._root, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    var node = q.node;
    if (node.length) {
      var child, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[0]) quads.push(new quad_default(child, x0, y0, xm, ym));
      if (child = node[1]) quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[2]) quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[3]) quads.push(new quad_default(child, xm, ym, x1, y1));
    }
    next.push(q);
  }
  while (q = next.pop()) {
    callback(q.node, q.x0, q.y0, q.x1, q.y1);
  }
  return this;
}

// ../../node_modules/d3-quadtree/src/x.js
function defaultX(d) {
  return d[0];
}
function x_default(_) {
  return arguments.length ? (this._x = _, this) : this._x;
}

// ../../node_modules/d3-quadtree/src/y.js
function defaultY(d) {
  return d[1];
}
function y_default(_) {
  return arguments.length ? (this._y = _, this) : this._y;
}

// ../../node_modules/d3-quadtree/src/quadtree.js
function quadtree(nodes, x3, y3) {
  var tree = new Quadtree(x3 == null ? defaultX : x3, y3 == null ? defaultY : y3, NaN, NaN, NaN, NaN);
  return nodes == null ? tree : tree.addAll(nodes);
}
function Quadtree(x3, y3, x0, y0, x1, y1) {
  this._x = x3;
  this._y = y3;
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  this._root = void 0;
}
function leaf_copy(leaf) {
  var copy = { data: leaf.data }, next = copy;
  while (leaf = leaf.next) next = next.next = { data: leaf.data };
  return copy;
}
var treeProto = quadtree.prototype = Quadtree.prototype;
treeProto.copy = function() {
  var copy = new Quadtree(this._x, this._y, this._x0, this._y0, this._x1, this._y1), node = this._root, nodes, child;
  if (!node) return copy;
  if (!node.length) return copy._root = leaf_copy(node), copy;
  nodes = [{ source: node, target: copy._root = new Array(4) }];
  while (node = nodes.pop()) {
    for (var i = 0; i < 4; ++i) {
      if (child = node.source[i]) {
        if (child.length) nodes.push({ source: child, target: node.target[i] = new Array(4) });
        else node.target[i] = leaf_copy(child);
      }
    }
  }
  return copy;
};
treeProto.add = add_default;
treeProto.addAll = addAll;
treeProto.cover = cover_default;
treeProto.data = data_default;
treeProto.extent = extent_default;
treeProto.find = find_default;
treeProto.remove = remove_default;
treeProto.removeAll = removeAll;
treeProto.root = root_default;
treeProto.size = size_default;
treeProto.visit = visit_default;
treeProto.visitAfter = visitAfter_default;
treeProto.x = x_default;
treeProto.y = y_default;

// ../../node_modules/d3-force/src/constant.js
function constant_default(x3) {
  return function() {
    return x3;
  };
}

// ../../node_modules/d3-force/src/jiggle.js
function jiggle_default(random) {
  return (random() - 0.5) * 1e-6;
}

// ../../node_modules/d3-force/src/collide.js
function x(d) {
  return d.x + d.vx;
}
function y(d) {
  return d.y + d.vy;
}
function collide_default(radius) {
  var nodes, radii, random, strength = 1, iterations = 1;
  if (typeof radius !== "function") radius = constant_default(radius == null ? 1 : +radius);
  function force() {
    var i, n = nodes.length, tree, node, xi, yi, ri, ri2;
    for (var k = 0; k < iterations; ++k) {
      tree = quadtree(nodes, x, y).visitAfter(prepare);
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        ri = radii[node.index], ri2 = ri * ri;
        xi = node.x + node.vx;
        yi = node.y + node.vy;
        tree.visit(apply);
      }
    }
    function apply(quad, x0, y0, x1, y1) {
      var data = quad.data, rj = quad.r, r = ri + rj;
      if (data) {
        if (data.index > node.index) {
          var x3 = xi - data.x - data.vx, y3 = yi - data.y - data.vy, l = x3 * x3 + y3 * y3;
          if (l < r * r) {
            if (x3 === 0) x3 = jiggle_default(random), l += x3 * x3;
            if (y3 === 0) y3 = jiggle_default(random), l += y3 * y3;
            l = (r - (l = Math.sqrt(l))) / l * strength;
            node.vx += (x3 *= l) * (r = (rj *= rj) / (ri2 + rj));
            node.vy += (y3 *= l) * r;
            data.vx -= x3 * (r = 1 - r);
            data.vy -= y3 * r;
          }
        }
        return;
      }
      return x0 > xi + r || x1 < xi - r || y0 > yi + r || y1 < yi - r;
    }
  }
  function prepare(quad) {
    if (quad.data) return quad.r = radii[quad.data.index];
    for (var i = quad.r = 0; i < 4; ++i) {
      if (quad[i] && quad[i].r > quad.r) {
        quad.r = quad[i].r;
      }
    }
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length, node;
    radii = new Array(n);
    for (i = 0; i < n; ++i) node = nodes[i], radii[node.index] = +radius(node, i, nodes);
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.iterations = function(_) {
    return arguments.length ? (iterations = +_, force) : iterations;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = +_, force) : strength;
  };
  force.radius = function(_) {
    return arguments.length ? (radius = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : radius;
  };
  return force;
}

// ../../node_modules/d3-force/src/link.js
function index(d) {
  return d.index;
}
function find(nodeById, nodeId) {
  var node = nodeById.get(nodeId);
  if (!node) throw new Error("node not found: " + nodeId);
  return node;
}
function link_default(links) {
  var id = index, strength = defaultStrength, strengths, distance = constant_default(30), distances, nodes, count, bias, random, iterations = 1;
  if (links == null) links = [];
  function defaultStrength(link) {
    return 1 / Math.min(count[link.source.index], count[link.target.index]);
  }
  function force(alpha) {
    for (var k = 0, n = links.length; k < iterations; ++k) {
      for (var i = 0, link, source, target, x3, y3, l, b; i < n; ++i) {
        link = links[i], source = link.source, target = link.target;
        x3 = target.x + target.vx - source.x - source.vx || jiggle_default(random);
        y3 = target.y + target.vy - source.y - source.vy || jiggle_default(random);
        l = Math.sqrt(x3 * x3 + y3 * y3);
        l = (l - distances[i]) / l * alpha * strengths[i];
        x3 *= l, y3 *= l;
        target.vx -= x3 * (b = bias[i]);
        target.vy -= y3 * b;
        source.vx += x3 * (b = 1 - b);
        source.vy += y3 * b;
      }
    }
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length, m2 = links.length, nodeById = new Map(nodes.map((d, i2) => [id(d, i2, nodes), d])), link;
    for (i = 0, count = new Array(n); i < m2; ++i) {
      link = links[i], link.index = i;
      if (typeof link.source !== "object") link.source = find(nodeById, link.source);
      if (typeof link.target !== "object") link.target = find(nodeById, link.target);
      count[link.source.index] = (count[link.source.index] || 0) + 1;
      count[link.target.index] = (count[link.target.index] || 0) + 1;
    }
    for (i = 0, bias = new Array(m2); i < m2; ++i) {
      link = links[i], bias[i] = count[link.source.index] / (count[link.source.index] + count[link.target.index]);
    }
    strengths = new Array(m2), initializeStrength();
    distances = new Array(m2), initializeDistance();
  }
  function initializeStrength() {
    if (!nodes) return;
    for (var i = 0, n = links.length; i < n; ++i) {
      strengths[i] = +strength(links[i], i, links);
    }
  }
  function initializeDistance() {
    if (!nodes) return;
    for (var i = 0, n = links.length; i < n; ++i) {
      distances[i] = +distance(links[i], i, links);
    }
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.links = function(_) {
    return arguments.length ? (links = _, initialize(), force) : links;
  };
  force.id = function(_) {
    return arguments.length ? (id = _, force) : id;
  };
  force.iterations = function(_) {
    return arguments.length ? (iterations = +_, force) : iterations;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default(+_), initializeStrength(), force) : strength;
  };
  force.distance = function(_) {
    return arguments.length ? (distance = typeof _ === "function" ? _ : constant_default(+_), initializeDistance(), force) : distance;
  };
  return force;
}

// ../../node_modules/d3-dispatch/src/dispatch.js
var noop = { value: () => {
} };
function dispatch() {
  for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
    if (!(t = arguments[i] + "") || t in _ || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
    _[t] = [];
  }
  return new Dispatch(_);
}
function Dispatch(_) {
  this._ = _;
}
function parseTypenames(typenames, types) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
    if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
    return { type: t, name };
  });
}
Dispatch.prototype = dispatch.prototype = {
  constructor: Dispatch,
  on: function(typename, callback) {
    var _ = this._, T = parseTypenames(typename + "", _), t, i = -1, n = T.length;
    if (arguments.length < 2) {
      while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
      return;
    }
    if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
    while (++i < n) {
      if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
      else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
    }
    return this;
  },
  copy: function() {
    var copy = {}, _ = this._;
    for (var t in _) copy[t] = _[t].slice();
    return new Dispatch(copy);
  },
  call: function(type, that) {
    if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  },
  apply: function(type, that, args) {
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  }
};
function get(type, name) {
  for (var i = 0, n = type.length, c2; i < n; ++i) {
    if ((c2 = type[i]).name === name) {
      return c2.value;
    }
  }
}
function set(type, name, callback) {
  for (var i = 0, n = type.length; i < n; ++i) {
    if (type[i].name === name) {
      type[i] = noop, type = type.slice(0, i).concat(type.slice(i + 1));
      break;
    }
  }
  if (callback != null) type.push({ name, value: callback });
  return type;
}
var dispatch_default = dispatch;

// ../../node_modules/d3-timer/src/timer.js
var frame = 0;
var timeout = 0;
var interval = 0;
var pokeDelay = 1e3;
var taskHead;
var taskTail;
var clockLast = 0;
var clockNow = 0;
var clockSkew = 0;
var clock = typeof performance === "object" && performance.now ? performance : Date;
var setFrame = typeof window === "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(f) {
  setTimeout(f, 17);
};
function now() {
  return clockNow || (setFrame(clearNow), clockNow = clock.now() + clockSkew);
}
function clearNow() {
  clockNow = 0;
}
function Timer() {
  this._call = this._time = this._next = null;
}
Timer.prototype = timer.prototype = {
  constructor: Timer,
  restart: function(callback, delay, time) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    time = (time == null ? now() : +time) + (delay == null ? 0 : +delay);
    if (!this._next && taskTail !== this) {
      if (taskTail) taskTail._next = this;
      else taskHead = this;
      taskTail = this;
    }
    this._call = callback;
    this._time = time;
    sleep();
  },
  stop: function() {
    if (this._call) {
      this._call = null;
      this._time = Infinity;
      sleep();
    }
  }
};
function timer(callback, delay, time) {
  var t = new Timer();
  t.restart(callback, delay, time);
  return t;
}
function timerFlush() {
  now();
  ++frame;
  var t = taskHead, e;
  while (t) {
    if ((e = clockNow - t._time) >= 0) t._call.call(void 0, e);
    t = t._next;
  }
  --frame;
}
function wake() {
  clockNow = (clockLast = clock.now()) + clockSkew;
  frame = timeout = 0;
  try {
    timerFlush();
  } finally {
    frame = 0;
    nap();
    clockNow = 0;
  }
}
function poke() {
  var now2 = clock.now(), delay = now2 - clockLast;
  if (delay > pokeDelay) clockSkew -= delay, clockLast = now2;
}
function nap() {
  var t0, t1 = taskHead, t2, time = Infinity;
  while (t1) {
    if (t1._call) {
      if (time > t1._time) time = t1._time;
      t0 = t1, t1 = t1._next;
    } else {
      t2 = t1._next, t1._next = null;
      t1 = t0 ? t0._next = t2 : taskHead = t2;
    }
  }
  taskTail = t0;
  sleep(time);
}
function sleep(time) {
  if (frame) return;
  if (timeout) timeout = clearTimeout(timeout);
  var delay = time - clockNow;
  if (delay > 24) {
    if (time < Infinity) timeout = setTimeout(wake, time - clock.now() - clockSkew);
    if (interval) interval = clearInterval(interval);
  } else {
    if (!interval) clockLast = clock.now(), interval = setInterval(poke, pokeDelay);
    frame = 1, setFrame(wake);
  }
}

// ../../node_modules/d3-force/src/lcg.js
var a = 1664525;
var c = 1013904223;
var m = 4294967296;
function lcg_default() {
  let s = 1;
  return () => (s = (a * s + c) % m) / m;
}

// ../../node_modules/d3-force/src/simulation.js
function x2(d) {
  return d.x;
}
function y2(d) {
  return d.y;
}
var initialRadius = 10;
var initialAngle = Math.PI * (3 - Math.sqrt(5));
function simulation_default(nodes) {
  var simulation, alpha = 1, alphaMin = 1e-3, alphaDecay = 1 - Math.pow(alphaMin, 1 / 300), alphaTarget = 0, velocityDecay = 0.6, forces = /* @__PURE__ */ new Map(), stepper = timer(step), event = dispatch_default("tick", "end"), random = lcg_default();
  if (nodes == null) nodes = [];
  function step() {
    tick();
    event.call("tick", simulation);
    if (alpha < alphaMin) {
      stepper.stop();
      event.call("end", simulation);
    }
  }
  function tick(iterations) {
    var i, n = nodes.length, node;
    if (iterations === void 0) iterations = 1;
    for (var k = 0; k < iterations; ++k) {
      alpha += (alphaTarget - alpha) * alphaDecay;
      forces.forEach(function(force) {
        force(alpha);
      });
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        if (node.fx == null) node.x += node.vx *= velocityDecay;
        else node.x = node.fx, node.vx = 0;
        if (node.fy == null) node.y += node.vy *= velocityDecay;
        else node.y = node.fy, node.vy = 0;
      }
    }
    return simulation;
  }
  function initializeNodes() {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.index = i;
      if (node.fx != null) node.x = node.fx;
      if (node.fy != null) node.y = node.fy;
      if (isNaN(node.x) || isNaN(node.y)) {
        var radius = initialRadius * Math.sqrt(0.5 + i), angle = i * initialAngle;
        node.x = radius * Math.cos(angle);
        node.y = radius * Math.sin(angle);
      }
      if (isNaN(node.vx) || isNaN(node.vy)) {
        node.vx = node.vy = 0;
      }
    }
  }
  function initializeForce(force) {
    if (force.initialize) force.initialize(nodes, random);
    return force;
  }
  initializeNodes();
  return simulation = {
    tick,
    restart: function() {
      return stepper.restart(step), simulation;
    },
    stop: function() {
      return stepper.stop(), simulation;
    },
    nodes: function(_) {
      return arguments.length ? (nodes = _, initializeNodes(), forces.forEach(initializeForce), simulation) : nodes;
    },
    alpha: function(_) {
      return arguments.length ? (alpha = +_, simulation) : alpha;
    },
    alphaMin: function(_) {
      return arguments.length ? (alphaMin = +_, simulation) : alphaMin;
    },
    alphaDecay: function(_) {
      return arguments.length ? (alphaDecay = +_, simulation) : +alphaDecay;
    },
    alphaTarget: function(_) {
      return arguments.length ? (alphaTarget = +_, simulation) : alphaTarget;
    },
    velocityDecay: function(_) {
      return arguments.length ? (velocityDecay = 1 - _, simulation) : 1 - velocityDecay;
    },
    randomSource: function(_) {
      return arguments.length ? (random = _, forces.forEach(initializeForce), simulation) : random;
    },
    force: function(name, _) {
      return arguments.length > 1 ? (_ == null ? forces.delete(name) : forces.set(name, initializeForce(_)), simulation) : forces.get(name);
    },
    find: function(x3, y3, radius) {
      var i = 0, n = nodes.length, dx, dy, d2, node, closest;
      if (radius == null) radius = Infinity;
      else radius *= radius;
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        dx = x3 - node.x;
        dy = y3 - node.y;
        d2 = dx * dx + dy * dy;
        if (d2 < radius) closest = node, radius = d2;
      }
      return closest;
    },
    on: function(name, _) {
      return arguments.length > 1 ? (event.on(name, _), simulation) : event.on(name);
    }
  };
}

// ../../node_modules/d3-force/src/manyBody.js
function manyBody_default() {
  var nodes, node, random, alpha, strength = constant_default(-30), strengths, distanceMin2 = 1, distanceMax2 = Infinity, theta2 = 0.81;
  function force(_) {
    var i, n = nodes.length, tree = quadtree(nodes, x2, y2).visitAfter(accumulate);
    for (alpha = _, i = 0; i < n; ++i) node = nodes[i], tree.visit(apply);
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length, node2;
    strengths = new Array(n);
    for (i = 0; i < n; ++i) node2 = nodes[i], strengths[node2.index] = +strength(node2, i, nodes);
  }
  function accumulate(quad) {
    var strength2 = 0, q, c2, weight = 0, x3, y3, i;
    if (quad.length) {
      for (x3 = y3 = i = 0; i < 4; ++i) {
        if ((q = quad[i]) && (c2 = Math.abs(q.value))) {
          strength2 += q.value, weight += c2, x3 += c2 * q.x, y3 += c2 * q.y;
        }
      }
      quad.x = x3 / weight;
      quad.y = y3 / weight;
    } else {
      q = quad;
      q.x = q.data.x;
      q.y = q.data.y;
      do
        strength2 += strengths[q.data.index];
      while (q = q.next);
    }
    quad.value = strength2;
  }
  function apply(quad, x1, _, x22) {
    if (!quad.value) return true;
    var x3 = quad.x - node.x, y3 = quad.y - node.y, w = x22 - x1, l = x3 * x3 + y3 * y3;
    if (w * w / theta2 < l) {
      if (l < distanceMax2) {
        if (x3 === 0) x3 = jiggle_default(random), l += x3 * x3;
        if (y3 === 0) y3 = jiggle_default(random), l += y3 * y3;
        if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
        node.vx += x3 * quad.value * alpha / l;
        node.vy += y3 * quad.value * alpha / l;
      }
      return true;
    } else if (quad.length || l >= distanceMax2) return;
    if (quad.data !== node || quad.next) {
      if (x3 === 0) x3 = jiggle_default(random), l += x3 * x3;
      if (y3 === 0) y3 = jiggle_default(random), l += y3 * y3;
      if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
    }
    do
      if (quad.data !== node) {
        w = strengths[quad.data.index] * alpha / l;
        node.vx += x3 * w;
        node.vy += y3 * w;
      }
    while (quad = quad.next);
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : strength;
  };
  force.distanceMin = function(_) {
    return arguments.length ? (distanceMin2 = _ * _, force) : Math.sqrt(distanceMin2);
  };
  force.distanceMax = function(_) {
    return arguments.length ? (distanceMax2 = _ * _, force) : Math.sqrt(distanceMax2);
  };
  force.theta = function(_) {
    return arguments.length ? (theta2 = _ * _, force) : Math.sqrt(theta2);
  };
  return force;
}

// src/view/ForceSim.ts
var DEFAULT_HALF_LIFE_DAYS = 30;
function liveWeight(baseStrength, lastTouched) {
  const daysSince = (Date.now() - new Date(lastTouched).getTime()) / (1e3 * 60 * 60 * 24);
  if (daysSince <= 0) return baseStrength;
  const lambda = Math.LN2 / DEFAULT_HALF_LIFE_DAYS;
  return baseStrength * Math.exp(-lambda * daysSince);
}
var JITTER_STRENGTH = 0.6;
var JITTER_ALPHA_TARGET = 0.05;
var NODE_BASE_RADIUS = 5;
var NODE_DEGREE_SCALE = 3;
var NODE_MAX_RADIUS = 22;
var ISOLATED_RING_MARGIN = 40;
function nodeRadius(degree) {
  return Math.min(NODE_MAX_RADIUS, NODE_BASE_RADIUS + Math.log2(degree + 1) * NODE_DEGREE_SCALE);
}
function createJitterForce() {
  let nodes = [];
  const force = () => {
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) + (Math.random() - 0.5) * JITTER_STRENGTH;
      node.vy = (node.vy ?? 0) + (Math.random() - 0.5) * JITTER_STRENGTH;
    }
  };
  force.initialize = (initNodes) => {
    nodes = initNodes;
  };
  return force;
}
function createIsolateRingForce(degree) {
  let nodes = [];
  const force = (alpha) => {
    let maxConnectedDist = 0;
    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) === 0) continue;
      if (n.x === void 0 || n.y === void 0) continue;
      maxConnectedDist = Math.max(maxConnectedDist, Math.hypot(n.x, n.y));
    }
    const minRadius = maxConnectedDist + ISOLATED_RING_MARGIN;
    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) !== 0) continue;
      if (n.x === void 0 || n.y === void 0) continue;
      const dist = Math.hypot(n.x, n.y) || 1e-4;
      const angle = Math.atan2(n.y, n.x);
      const diff = dist < minRadius ? minRadius - dist : (minRadius - dist) * 0.05;
      const k = 0.08 * alpha;
      n.vx = (n.vx ?? 0) + Math.cos(angle) * diff * k;
      n.vy = (n.vy ?? 0) + Math.sin(angle) * diff * k;
    }
  };
  force.initialize = (initNodes) => {
    nodes = initNodes;
  };
  return force;
}
var ForceSim = class {
  simulation = null;
  edges = [];
  maxWeight = 0;
  degree = /* @__PURE__ */ new Map();
  /** most recent lastTouched among each note's incident "neural" (usage) edges — native wikilinks don't carry recency */
  lastTouched = /* @__PURE__ */ new Map();
  tickCallback = null;
  continuousAnimation = false;
  /** carried across setData calls so unchanged notes keep their position instead of re-exploding */
  nodesById = /* @__PURE__ */ new Map();
  onTick(callback) {
    this.tickCallback = callback;
    this.simulation?.on("tick", () => callback(this.simulation.nodes()));
  }
  getEdges() {
    return this.edges;
  }
  getMaxWeight() {
    return this.maxWeight;
  }
  getDegree(id) {
    return this.degree.get(id) ?? 0;
  }
  /** ISO timestamp of the most recent usage touch on this note, or undefined if it has none. */
  getLastTouched(id) {
    return this.lastTouched.get(id);
  }
  /** Wake the simulation so it reorganizes around a change (e.g. a node drag). */
  reheat(alpha = 0.3) {
    this.simulation?.alphaTarget(this.continuousAnimation ? JITTER_ALPHA_TARGET : 0).alpha(alpha).restart();
  }
  setContinuousAnimation(enabled) {
    this.continuousAnimation = enabled;
    if (!this.simulation) return;
    if (enabled) {
      this.simulation.force("jitter", createJitterForce());
      this.simulation.alphaTarget(JITTER_ALPHA_TARGET).restart();
    } else {
      this.simulation.force("jitter", null);
      this.simulation.alphaTarget(0);
    }
  }
  setData(notePaths, weights, nativeEdges = [], minWeight = 0) {
    const ids = new Set(notePaths);
    const neuralEdges = [];
    for (const [key, record] of Object.entries(weights.edges)) {
      const weight = liveWeight(record.baseStrength, record.lastTouched);
      if (weight < minWeight) continue;
      const [source, target] = key.split("|");
      if (source === void 0 || target === void 0) continue;
      ids.add(source);
      ids.add(target);
      neuralEdges.push({ source, target, kind: "neural", weight, lastTouched: record.lastTouched });
    }
    const nativeSimEdges = [];
    for (const { source, target } of nativeEdges) {
      ids.add(source);
      ids.add(target);
      nativeSimEdges.push({ source, target, kind: "native", weight: 0, lastTouched: "" });
    }
    const wasFirstLoad = this.simulation === null;
    const nodes = [...ids].map((id) => this.nodesById.get(id) ?? { id });
    this.nodesById = new Map(nodes.map((n) => [n.id, n]));
    const edges = [...nativeSimEdges, ...neuralEdges];
    this.edges = edges;
    this.maxWeight = neuralEdges.reduce((max, e) => Math.max(max, e.weight), 0);
    const degree = /* @__PURE__ */ new Map();
    for (const e of edges) {
      const source = e.source;
      const target = e.target;
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
    this.degree = degree;
    const lastTouched = /* @__PURE__ */ new Map();
    for (const e of neuralEdges) {
      const source = e.source;
      const target = e.target;
      if (!lastTouched.has(source) || e.lastTouched > lastTouched.get(source)) lastTouched.set(source, e.lastTouched);
      if (!lastTouched.has(target) || e.lastTouched > lastTouched.get(target)) lastTouched.set(target, e.lastTouched);
    }
    this.lastTouched = lastTouched;
    this.simulation?.stop();
    this.simulation = simulation_default(nodes).force("charge", manyBody_default().strength(-90)).force(
      "link",
      link_default(edges).id((d) => d.id).distance(55).strength((d) => d.kind === "native" ? 0.05 : 0.3)
    ).force("center", center_default(0, 0)).force("collide", collide_default((d) => nodeRadius(degree.get(d.id) ?? 0) + 3)).force("isolate", createIsolateRingForce(degree));
    if (!wasFirstLoad) this.simulation.alpha(0.3);
    if (this.continuousAnimation) {
      this.simulation.force("jitter", createJitterForce());
      this.simulation.alphaTarget(JITTER_ALPHA_TARGET);
    }
    if (this.tickCallback) {
      const callback = this.tickCallback;
      this.simulation.on("tick", () => callback(this.simulation.nodes()));
    }
  }
  stop() {
    this.simulation?.stop();
  }
};

// src/view/Renderer.ts
var PULSE_DURATION_MS = 600;
var DEFAULT_EDGE_MAX_AGE_DAYS = 30;
var MIN_SCALE = 0.2;
var MAX_SCALE = 5;
var ZOOM_STEP = 1.2;
function edgeKey(a2, b) {
  return [a2, b].sort().join("|");
}
function resolvedNode(end) {
  return typeof end === "string" ? null : end;
}
var WEIGHT_GRADIENTS = {
  default: [
    [64, 140, 255],
    // blue
    [70, 200, 140],
    // green
    [235, 220, 60],
    // yellow
    [235, 110, 170],
    // pink
    [230, 60, 60]
    // red
  ],
  // wider perceptual spacing between stops for readers who struggle to
  // distinguish the default palette's green/yellow/pink midtones
  "high-contrast": [
    [0, 120, 255],
    // blue
    [0, 220, 220],
    // cyan
    [255, 230, 0],
    // yellow
    [255, 140, 0],
    // orange
    [255, 0, 90]
    // magenta
  ]
};
function weightColor(t, gradient) {
  const clamped = Math.max(0, Math.min(1, t));
  const segments = gradient.length - 1;
  const scaled = clamped * segments;
  const idx = Math.min(segments - 1, Math.floor(scaled));
  const localT = scaled - idx;
  const [r1, g1, b1] = gradient[idx];
  const [r2, g2, b2] = gradient[idx + 1];
  return [Math.round(r1 + (r2 - r1) * localT), Math.round(g1 + (g2 - g1) * localT), Math.round(b1 + (b2 - b1) * localT)];
}
var Renderer = class {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.sim.onTick((nodes) => {
      this.nodes = nodes;
    });
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }
  ctx;
  nodes = [];
  pulses = [];
  rafHandle = null;
  hoveredEdge = null;
  hoveredNode = null;
  tooltipEl = null;
  onNodeClick = null;
  scale = 1;
  panX = 0;
  panY = 0;
  gradient = WEIGHT_GRADIENTS.default;
  edgeMaxAgeDays = DEFAULT_EDGE_MAX_AGE_DAYS;
  primedNotes = /* @__PURE__ */ new Set();
  // drag state: either panning the canvas or dragging a single node
  dragNode = null;
  isPanning = false;
  dragMoved = false;
  lastClientX = 0;
  lastClientY = 0;
  handleClick = (evt) => this.onClick(evt);
  handleMouseDown = (evt) => this.onMouseDown(evt);
  handleMouseMove = (evt) => this.onMouseMove(evt);
  handleMouseUp = () => this.endDrag();
  handleMouseLeave = () => this.clearHover();
  handleWheel = (evt) => this.onWheel(evt);
  onNodeClicked(callback) {
    this.onNodeClick = callback;
  }
  setColorScheme(scheme) {
    this.gradient = WEIGHT_GRADIENTS[scheme];
  }
  setEdgeMaxAgeDays(days) {
    this.edgeMaxAgeDays = days;
  }
  setPrimedNotes(notes) {
    this.primedNotes = notes;
  }
  start() {
    this.resizeToDisplaySize();
    const loop = () => {
      this.resizeToDisplaySize();
      this.draw();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }
  stop() {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.sim.stop();
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }
  pulseEdge(source, target) {
    this.pulses.push({ key: edgeKey(source, target), start: performance.now() });
  }
  zoomIn() {
    this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, ZOOM_STEP);
  }
  zoomOut() {
    this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, 1 / ZOOM_STEP);
  }
  resetView() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
  }
  zoomAt(screenX, screenY, factor) {
    const { x: cx, y: cy } = this.center();
    const worldX = (screenX - cx - this.panX) / this.scale;
    const worldY = (screenY - cy - this.panY) / this.scale;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.panX = screenX - cx - worldX * newScale;
    this.panY = screenY - cy - worldY * newScale;
    this.scale = newScale;
  }
  onWheel(evt) {
    evt.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const sx = (evt.clientX - rect.left) * ratio;
    const sy = (evt.clientY - rect.top) * ratio;
    const factor = evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.zoomAt(sx, sy, factor);
  }
  resizeToDisplaySize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
  center() {
    return { x: this.canvas.width / 2, y: this.canvas.height / 2 };
  }
  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { x: cx, y: cy } = this.center();
    ctx.save();
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.scale, this.scale);
    const now2 = performance.now();
    this.pulses = this.pulses.filter((p) => now2 - p.start < PULSE_DURATION_MS);
    const hoveredId = this.hoveredNode?.id;
    for (const edge of this.sim.getEdges()) {
      const source = resolvedNode(edge.source);
      const target = resolvedNode(edge.target);
      if (!source || !target || source.x === void 0 || target.x === void 0) continue;
      if (target.x === void 0 || target.y === void 0 || source.y === void 0) continue;
      const isHovered = this.hoveredEdge === edge;
      const touchesHoveredNode = hoveredId !== void 0 && (source.id === hoveredId || target.id === hoveredId);
      const dimmed = hoveredId !== void 0 && !touchesHoveredNode;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      if (edge.kind === "native") {
        const highlighted = isHovered || touchesHoveredNode;
        ctx.lineWidth = (highlighted ? 1.5 : 0.75) / this.scale;
        ctx.strokeStyle = highlighted ? "rgba(210, 210, 220, 0.75)" : dimmed ? "rgba(140, 140, 150, 0.08)" : "rgba(140, 140, 150, 0.25)";
        ctx.stroke();
        continue;
      }
      const ageDays = (Date.now() - Date.parse(edge.lastTouched)) / 864e5;
      const freshness = Math.max(0, 1 - ageDays / this.edgeMaxAgeDays);
      const thickness = Math.max(0.5, Math.log2(edge.weight + 1));
      const pulse = this.pulses.find((p) => p.key === edgeKey(source.id, target.id));
      const pulseBoost = pulse ? 1 - (now2 - pulse.start) / PULSE_DURATION_MS : 0;
      const maxWeight = this.sim.getMaxWeight();
      const [r, g, b] = weightColor(maxWeight > 0 ? edge.weight / maxWeight : 0, this.gradient);
      const baseAlpha = Math.min(1, 0.15 + freshness * 0.7 + pulseBoost * 0.5);
      const alpha = touchesHoveredNode ? 1 : dimmed ? baseAlpha * 0.15 : baseAlpha;
      ctx.lineWidth = (thickness + pulseBoost * 3 + (touchesHoveredNode ? 0.5 : 0)) / this.scale;
      ctx.strokeStyle = isHovered ? `rgba(255, 255, 255, ${Math.min(1, alpha + 0.3)})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.stroke();
    }
    for (const node of this.nodes) {
      if (node.x === void 0 || node.y === void 0) continue;
      const isHovered = this.hoveredNode === node;
      const radius = nodeRadius(this.sim.getDegree(node.id));
      const nodeLastTouched = this.sim.getLastTouched(node.id);
      const nodeAgeDays = nodeLastTouched ? (Date.now() - Date.parse(nodeLastTouched)) / 864e5 : Infinity;
      const nodeFreshness = Math.max(0, 1 - nodeAgeDays / this.edgeMaxAgeDays);
      const nodeAlpha = Math.min(1, 0.35 + nodeFreshness * 0.65);
      ctx.beginPath();
      ctx.arc(node.x, node.y, isHovered ? radius * 1.2 : radius, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? "rgba(255, 200, 80, 0.95)" : `rgba(220, 220, 230, ${nodeAlpha})`;
      ctx.fill();
      if (this.primedNotes.has(node.id)) {
        ctx.save();
        ctx.setLineDash([4 / this.scale, 3 / this.scale]);
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeStyle = "rgba(255, 170, 60, 0.9)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4 / this.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (isHovered) {
        const title = node.id.split("/").pop() ?? node.id;
        ctx.font = `${13 / this.scale}px var(--font-interface, sans-serif)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(235, 235, 245, 0.95)";
        ctx.fillText(title, node.x, node.y + radius + 4 / this.scale);
      }
    }
    ctx.restore();
  }
  eventToWorld(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const { x: cx, y: cy } = this.center();
    return {
      x: ((evt.clientX - rect.left) * ratio - cx - this.panX) / this.scale,
      y: ((evt.clientY - rect.top) * ratio - cy - this.panY) / this.scale
    };
  }
  hitTestNode(worldX, worldY) {
    for (const node of this.nodes) {
      if (node.x === void 0 || node.y === void 0) continue;
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      const threshold = nodeRadius(this.sim.getDegree(node.id)) + 3;
      if (dx * dx + dy * dy <= threshold ** 2) return node;
    }
    return null;
  }
  hitTestEdge(worldX, worldY) {
    const threshold = 5;
    for (const edge of this.sim.getEdges()) {
      const source = resolvedNode(edge.source);
      const target = resolvedNode(edge.target);
      if (!source || !target) continue;
      if (source.x === void 0 || source.y === void 0) continue;
      if (target.x === void 0 || target.y === void 0) continue;
      const dist = distanceToSegment(worldX, worldY, source.x, source.y, target.x, target.y);
      if (dist <= threshold) return edge;
    }
    return null;
  }
  isOverCanvas(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return evt.clientX >= rect.left && evt.clientX <= rect.right && evt.clientY >= rect.top && evt.clientY <= rect.bottom;
  }
  onClick(evt) {
    if (this.dragMoved) return;
    const { x: x3, y: y3 } = this.eventToWorld(evt);
    const node = this.hitTestNode(x3, y3);
    if (node) this.onNodeClick?.(node.id);
  }
  onMouseDown(evt) {
    const { x: x3, y: y3 } = this.eventToWorld(evt);
    const node = this.hitTestNode(x3, y3);
    this.dragMoved = false;
    this.lastClientX = evt.clientX;
    this.lastClientY = evt.clientY;
    if (node) {
      this.dragNode = node;
      node.fx = node.x;
      node.fy = node.y;
      this.sim.reheat();
    } else {
      this.isPanning = true;
      this.canvas.style.cursor = "grabbing";
    }
  }
  onMouseMove(evt) {
    if (this.dragNode) {
      const dx = evt.clientX - this.lastClientX;
      const dy = evt.clientY - this.lastClientY;
      if (dx !== 0 || dy !== 0) this.dragMoved = true;
      const { x: x4, y: y4 } = this.eventToWorld(evt);
      this.dragNode.fx = x4;
      this.dragNode.fy = y4;
      this.lastClientX = evt.clientX;
      this.lastClientY = evt.clientY;
      return;
    }
    if (this.isPanning) {
      const ratio = window.devicePixelRatio || 1;
      const dx = (evt.clientX - this.lastClientX) * ratio;
      const dy = (evt.clientY - this.lastClientY) * ratio;
      if (dx !== 0 || dy !== 0) this.dragMoved = true;
      this.panX += dx;
      this.panY += dy;
      this.lastClientX = evt.clientX;
      this.lastClientY = evt.clientY;
      return;
    }
    if (!this.isOverCanvas(evt)) {
      this.clearHover();
      return;
    }
    const { x: x3, y: y3 } = this.eventToWorld(evt);
    const node = this.hitTestNode(x3, y3);
    const edge = node ? null : this.hitTestEdge(x3, y3);
    this.hoveredNode = node;
    this.hoveredEdge = edge;
    this.canvas.style.cursor = node ? "grab" : "default";
    if (!edge) {
      this.tooltipEl?.remove();
      this.tooltipEl = null;
      return;
    }
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement("div");
      this.tooltipEl.addClass("vault-neural-links-tooltip");
      this.canvas.parentElement?.appendChild(this.tooltipEl);
    }
    const source = resolvedNode(edge.source);
    const target = resolvedNode(edge.target);
    this.tooltipEl.setText(
      edge.kind === "native" ? `${source?.id ?? "?"} \u2194 ${target?.id ?? "?"}
(native wikilink)` : `${source?.id ?? "?"} \u2194 ${target?.id ?? "?"}
weight: ${edge.weight.toFixed(2)}
last touched: ${edge.lastTouched}`
    );
    this.tooltipEl.style.left = `${evt.clientX + 12}px`;
    this.tooltipEl.style.top = `${evt.clientY + 12}px`;
  }
  endDrag() {
    if (this.dragNode) {
      this.dragNode.fx = null;
      this.dragNode.fy = null;
      this.dragNode = null;
    }
    this.isPanning = false;
    this.canvas.style.cursor = this.hoveredNode ? "grab" : "default";
  }
  clearHover() {
    this.hoveredNode = null;
    this.hoveredEdge = null;
    this.canvas.style.cursor = "default";
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }
};
function distanceToSegment(px, py, x1, y1, x22, y22) {
  const dx = x22 - x1;
  const dy = y22 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

// src/view/NeuralGraphView.ts
var NEURAL_GRAPH_VIEW_TYPE = "vault-neural-links-view";
var NeuralGraphView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  canvas = null;
  sim = null;
  renderer = null;
  watcher = null;
  primedWatcher = null;
  statusEl = null;
  lastWeights = null;
  firstLoadDone = false;
  getViewType() {
    return NEURAL_GRAPH_VIEW_TYPE;
  }
  getDisplayText() {
    return "Neural Graph";
  }
  getIcon() {
    return "git-fork";
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("vault-neural-links-view");
    this.canvas = container.createEl("canvas");
    this.sim = new ForceSim();
    this.sim.setContinuousAnimation(this.plugin.settings.continuousAnimation);
    this.renderer = new Renderer(this.canvas, this.sim);
    this.renderer.setColorScheme(this.plugin.settings.colorScheme);
    this.renderer.setEdgeMaxAgeDays(this.plugin.settings.decayHalfLifeDays);
    this.renderer.onNodeClicked((path) => this.openNote(path));
    this.renderer.start();
    this.statusEl = container.createDiv({ cls: "vault-neural-links-status" });
    this.statusEl.setText("Loading graph\u2026");
    const controls = container.createDiv({ cls: "vault-neural-links-zoom-controls" });
    const renderer = this.renderer;
    const sim = this.sim;
    controls.createEl("button", { text: "+" }).addEventListener("click", () => renderer.zoomIn());
    controls.createEl("button", { text: "\u2212" }).addEventListener("click", () => renderer.zoomOut());
    controls.createEl("button", { text: "\u27F2" }).addEventListener("click", () => renderer.resetView());
    const animateBtn = controls.createEl("button", {
      text: "\u{1F30A}",
      cls: this.plugin.settings.continuousAnimation ? "is-active" : ""
    });
    animateBtn.setAttr("aria-label", "Toggle continuous animation");
    animateBtn.addEventListener("click", () => {
      const enabled = !this.plugin.settings.continuousAnimation;
      this.plugin.settings.continuousAnimation = enabled;
      void this.plugin.saveSettings();
      sim.setContinuousAnimation(enabled);
      animateBtn.toggleClass("is-active", enabled);
    });
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian2.FileSystemAdapter)) {
      container.createEl("div", {
        text: "Vault Neural Links requires the desktop file system \u2014 this view is unavailable here."
      });
      return;
    }
    const weightsPath = `${adapter.getBasePath()}/.vault-neural-links/link-weights.json`;
    this.watcher = new WeightsWatcher(weightsPath);
    this.watcher.start(
      (current, previous) => this.onWeightsChanged(current, previous),
      (err) => this.onWeightsError(err)
    );
    const sessionDir = `${adapter.getBasePath()}/.vault-neural-links/session`;
    this.primedWatcher = new PrimedWatcher(sessionDir);
    this.primedWatcher.start((primed) => this.renderer?.setPrimedNotes(primed));
  }
  async onClose() {
    this.watcher?.stop();
    this.watcher = null;
    this.primedWatcher?.stop();
    this.primedWatcher = null;
    this.renderer?.stop();
    this.renderer = null;
    this.sim = null;
  }
  /** Re-applies plugin settings (color scheme, decay window, min-weight filter, animation) to a live view. */
  applySettings() {
    if (!this.sim || !this.renderer) return;
    this.renderer.setColorScheme(this.plugin.settings.colorScheme);
    this.renderer.setEdgeMaxAgeDays(this.plugin.settings.decayHalfLifeDays);
    this.sim.setContinuousAnimation(this.plugin.settings.continuousAnimation);
    if (this.lastWeights) {
      const notePaths = this.app.vault.getMarkdownFiles().map((f) => f.path.replace(/\.md$/, ""));
      this.sim.setData(notePaths, this.lastWeights, this.getNativeEdges(), this.plugin.settings.minWeightFilter);
    }
  }
  onWeightsError(err) {
    if (this.firstLoadDone) {
      console.error("Vault Neural Links: failed to read link-weights.json", err);
      return;
    }
    const isMissing = err?.code === "ENOENT";
    this.statusEl?.setText(
      isMissing ? "No link-weights.json yet \u2014 create or link some notes via the vault-neural-link MCP server first." : "Failed to read link-weights.json \u2014 see the developer console for details."
    );
    if (!isMissing) console.error("Vault Neural Links: failed to read link-weights.json", err);
  }
  onWeightsChanged(current, previous) {
    if (!this.sim) return;
    if (!this.firstLoadDone) {
      this.firstLoadDone = true;
      this.statusEl?.remove();
      this.statusEl = null;
    }
    this.lastWeights = current;
    const notePaths = this.app.vault.getMarkdownFiles().map((f) => f.path.replace(/\.md$/, ""));
    try {
      this.sim.setData(notePaths, current, this.getNativeEdges(), this.plugin.settings.minWeightFilter);
    } catch (err) {
      console.error("Vault Neural Links: failed to render graph", err);
      return;
    }
    if (!previous || !this.renderer) return;
    for (const [key, record] of Object.entries(current.edges)) {
      const prevRecord = previous.edges[key];
      if (!prevRecord || prevRecord.reinforceCount !== record.reinforceCount) {
        const [source, target] = key.split("|");
        if (source && target) this.renderer.pulseEdge(source, target);
      }
    }
  }
  /** Obsidian's own [[wikilink]] graph, deduped to one undirected edge per pair. */
  getNativeEdges() {
    const resolved = this.app.metadataCache.resolvedLinks;
    const seen = /* @__PURE__ */ new Set();
    const edges = [];
    for (const [sourcePath, targets] of Object.entries(resolved)) {
      const source = sourcePath.replace(/\.md$/, "");
      for (const targetPath of Object.keys(targets)) {
        if (!targetPath.endsWith(".md")) continue;
        const target = targetPath.replace(/\.md$/, "");
        if (source === target) continue;
        const key = [source, target].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source, target });
      }
    }
    return edges;
  }
  openNote(path) {
    const file = this.app.vault.getMarkdownFiles().find((f) => f.path.replace(/\.md$/, "") === path);
    if (file) void this.app.workspace.getLeaf(false).openFile(file);
  }
};

// src/main.ts
var VaultNeuralLinksPlugin = class extends import_obsidian3.Plugin {
  settings = DEFAULT_SETTINGS;
  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
    this.registerView(NEURAL_GRAPH_VIEW_TYPE, (leaf) => new NeuralGraphView(leaf, this));
    this.addSettingTab(new VaultNeuralLinksSettingTab(this.app, this));
    this.addRibbonIcon("git-fork", "Open Neural Graph", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-neural-graph",
      name: "Open Neural Graph",
      callback: () => {
        void this.activateView();
      }
    });
  }
  onunload() {
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** Re-applies current settings to every open Neural Graph view without waiting for a data change. */
  refreshGraphViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(NEURAL_GRAPH_VIEW_TYPE)) {
      if (leaf.view instanceof NeuralGraphView) leaf.view.applySettings();
    }
  }
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(NEURAL_GRAPH_VIEW_TYPE)[0];
    if (existing) {
      workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: NEURAL_GRAPH_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL1NldHRpbmdUYWIudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy92aWV3L05ldXJhbEdyYXBoVmlldy50cyIsICJzcmMvV2VpZ2h0c1dhdGNoZXIudHMiLCAic3JjL1ByaW1lZFdhdGNoZXIudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9jZW50ZXIuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9hZGQuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9jb3Zlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL2RhdGEuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9leHRlbnQuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvZmluZC5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3JlbW92ZS5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3Jvb3QuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9zaXplLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvdmlzaXQuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy92aXNpdEFmdGVyLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMveC5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3kuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkdHJlZS5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2NvbnN0YW50LmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvamlnZ2xlLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvY29sbGlkZS5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2xpbmsuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL2QzLWRpc3BhdGNoL3NyYy9kaXNwYXRjaC5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtdGltZXIvc3JjL3RpbWVyLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvbGNnLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvc2ltdWxhdGlvbi5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL21hbnlCb2R5LmpzIiwgInNyYy92aWV3L0ZvcmNlU2ltLnRzIiwgInNyYy92aWV3L1JlbmRlcmVyLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBQbHVnaW4sIFdvcmtzcGFjZUxlYWYgfSBmcm9tIFwib2JzaWRpYW5cIjtcclxuaW1wb3J0IHsgVmF1bHROZXVyYWxMaW5rc1NldHRpbmdUYWIgfSBmcm9tIFwiLi9TZXR0aW5nVGFiLmpzXCI7XHJcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MsIHR5cGUgVmF1bHROZXVyYWxMaW5rc1NldHRpbmdzIH0gZnJvbSBcIi4vc2V0dGluZ3MuanNcIjtcclxuaW1wb3J0IHsgTkVVUkFMX0dSQVBIX1ZJRVdfVFlQRSwgTmV1cmFsR3JhcGhWaWV3IH0gZnJvbSBcIi4vdmlldy9OZXVyYWxHcmFwaFZpZXcuanNcIjtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZhdWx0TmV1cmFsTGlua3NQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gIHNldHRpbmdzOiBWYXVsdE5ldXJhbExpbmtzU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xyXG5cclxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0aGlzLnNldHRpbmdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLCAuLi4oYXdhaXQgdGhpcy5sb2FkRGF0YSgpKSB9O1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KE5FVVJBTF9HUkFQSF9WSUVXX1RZUEUsIChsZWFmOiBXb3Jrc3BhY2VMZWFmKSA9PiBuZXcgTmV1cmFsR3JhcGhWaWV3KGxlYWYsIHRoaXMpKTtcclxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHROZXVyYWxMaW5rc1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcclxuXHJcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJnaXQtZm9ya1wiLCBcIk9wZW4gTmV1cmFsIEdyYXBoXCIsICgpID0+IHtcclxuICAgICAgdm9pZCB0aGlzLmFjdGl2YXRlVmlldygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwib3Blbi1uZXVyYWwtZ3JhcGhcIixcclxuICAgICAgbmFtZTogXCJPcGVuIE5ldXJhbCBHcmFwaFwiLFxyXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5hY3RpdmF0ZVZpZXcoKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgb251bmxvYWQoKTogdm9pZCB7fVxyXG5cclxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xyXG4gIH1cclxuXHJcbiAgLyoqIFJlLWFwcGxpZXMgY3VycmVudCBzZXR0aW5ncyB0byBldmVyeSBvcGVuIE5ldXJhbCBHcmFwaCB2aWV3IHdpdGhvdXQgd2FpdGluZyBmb3IgYSBkYXRhIGNoYW5nZS4gKi9cclxuICByZWZyZXNoR3JhcGhWaWV3cygpOiB2b2lkIHtcclxuICAgIGZvciAoY29uc3QgbGVhZiBvZiB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKE5FVVJBTF9HUkFQSF9WSUVXX1RZUEUpKSB7XHJcbiAgICAgIGlmIChsZWFmLnZpZXcgaW5zdGFuY2VvZiBOZXVyYWxHcmFwaFZpZXcpIGxlYWYudmlldy5hcHBseVNldHRpbmdzKCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGFjdGl2YXRlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gd29ya3NwYWNlLmdldExlYXZlc09mVHlwZShORVVSQUxfR1JBUEhfVklFV19UWVBFKVswXTtcclxuICAgIGlmIChleGlzdGluZykge1xyXG4gICAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihleGlzdGluZyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsZWFmID0gd29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XHJcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IE5FVVJBTF9HUkFQSF9WSUVXX1RZUEUsIGFjdGl2ZTogdHJ1ZSB9KTtcclxuICAgIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB0eXBlIFZhdWx0TmV1cmFsTGlua3NQbHVnaW4gZnJvbSBcIi4vbWFpbi5qc1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIFZhdWx0TmV1cmFsTGlua3NTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBhcHA6IEFwcCxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBWYXVsdE5ldXJhbExpbmtzUGx1Z2luLFxyXG4gICkge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gIH1cclxuXHJcbiAgZGlzcGxheSgpOiB2b2lkIHtcclxuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XHJcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIk1pbmltdW0gZWRnZSB3ZWlnaHRcIilcclxuICAgICAgLnNldERlc2MoXHJcbiAgICAgICAgXCJIaWRlIHVzYWdlLXdlaWdodGVkIGxpbmtzIGJlbG93IHRoaXMgd2VpZ2h0IGluIHRoZSBncmFwaCB2aWV3LiBOb3RlcyBsZWZ0IHdpdGggbm8gXCIgK1xyXG4gICAgICAgICAgXCJyZW1haW5pbmcgZWRnZXMgYXJlIGhpZGRlbiBlbnRpcmVseS4gTmF0aXZlIHdpa2lsaW5rcyBhcmUgdW5hZmZlY3RlZC5cIixcclxuICAgICAgKVxyXG4gICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XHJcbiAgICAgICAgc2xpZGVyXHJcbiAgICAgICAgICAuc2V0TGltaXRzKDAsIDIwLCAwLjUpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MubWluV2VpZ2h0RmlsdGVyKVxyXG4gICAgICAgICAgLnNldER5bmFtaWNUb29sdGlwKClcclxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MubWluV2VpZ2h0RmlsdGVyID0gdmFsdWU7XHJcbiAgICAgICAgICAgIHZvaWQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hHcmFwaFZpZXdzKCk7XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJDb2xvciBzY2hlbWVcIilcclxuICAgICAgLnNldERlc2MoXCJQYWxldHRlIHVzZWQgZm9yIHRoZSB3ZWlnaHQgZ3JhZGllbnQgb24gbmV1cmFsICh1c2FnZS13ZWlnaHRlZCkgZWRnZXMuXCIpXHJcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XHJcbiAgICAgICAgZHJvcGRvd25cclxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkZWZhdWx0XCIsIFwiRGVmYXVsdFwiKVxyXG4gICAgICAgICAgLmFkZE9wdGlvbihcImhpZ2gtY29udHJhc3RcIiwgXCJIaWdoIGNvbnRyYXN0XCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JTY2hlbWUpXHJcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yU2NoZW1lID0gdmFsdWUgYXMgXCJkZWZhdWx0XCIgfCBcImhpZ2gtY29udHJhc3RcIjtcclxuICAgICAgICAgICAgdm9pZCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaEdyYXBoVmlld3MoKTtcclxuICAgICAgICAgIH0pLFxyXG4gICAgICApO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIkRlY2F5IGhhbGYtbGlmZSAoZGF5cylcIilcclxuICAgICAgLnNldERlc2MoXHJcbiAgICAgICAgXCJTaG91bGQgbWF0Y2ggdGhlIHZhdWx0LW5ldXJhbC1saW5rIE1DUCBzZXJ2ZXIncyBkZWNheSBoYWxmLWxpZmUuIENvbnRyb2xzIGhvdyBxdWlja2x5IFwiICtcclxuICAgICAgICAgIFwiZWRnZXMgZmFkZSB0b3dhcmQgJ3N0YWxlJyBpbiB0aGUgZ3JhcGggdmlldyBcdTIwMTQgaXQgZG9lcyBub3QgY2hhbmdlIGFjdHVhbCB3ZWlnaHQgZGVjYXksIFwiICtcclxuICAgICAgICAgIFwid2hpY2ggaGFwcGVucyBzZXJ2ZXItc2lkZSBkdXJpbmcgY29tcGFjdGlvbi5cIixcclxuICAgICAgKVxyXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cclxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyh0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWNheUhhbGZMaWZlRGF5cykpLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlKTtcclxuICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkgfHwgcGFyc2VkIDw9IDApIHJldHVybjtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlY2F5SGFsZkxpZmVEYXlzID0gcGFyc2VkO1xyXG4gICAgICAgICAgdm9pZCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hHcmFwaFZpZXdzKCk7XHJcbiAgICAgICAgfSksXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiQ29udGludW91cyBhbmltYXRpb25cIilcclxuICAgICAgLnNldERlc2MoXCJLZWVwIGEgZ2VudGxlIGppdHRlciBydW5uaW5nIGZvcmV2ZXIgaW5zdGVhZCBvZiBsZXR0aW5nIHRoZSBncmFwaCBzZXR0bGUuXCIpXHJcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29udGludW91c0FuaW1hdGlvbikub25DaGFuZ2UoKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb250aW51b3VzQW5pbWF0aW9uID0gdmFsdWU7XHJcbiAgICAgICAgICB2b2lkIHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaEdyYXBoVmlld3MoKTtcclxuICAgICAgICB9KSxcclxuICAgICAgKTtcclxuICB9XHJcbn1cclxuIiwgImV4cG9ydCBpbnRlcmZhY2UgVmF1bHROZXVyYWxMaW5rc1NldHRpbmdzIHtcbiAgLyoqIHJlYWQtb25seSBtaXJyb3Igb2YgY29yZSdzIGRlY2F5IGhhbGYtbGlmZSwgaW4gZGF5cyAqL1xuICBkZWNheUhhbGZMaWZlRGF5czogbnVtYmVyO1xuICBjb2xvclNjaGVtZTogXCJkZWZhdWx0XCIgfCBcImhpZ2gtY29udHJhc3RcIjtcbiAgbWluV2VpZ2h0RmlsdGVyOiBudW1iZXI7XG4gIC8qKiBrZWVwIGEgZ2VudGxlIGppdHRlciBydW5uaW5nIGZvcmV2ZXIgaW5zdGVhZCBvZiBzZXR0bGluZyBhZnRlciB0aGUgaW5pdGlhbCBsYXlvdXQgKi9cbiAgY29udGludW91c0FuaW1hdGlvbjogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IFZhdWx0TmV1cmFsTGlua3NTZXR0aW5ncyA9IHtcbiAgZGVjYXlIYWxmTGlmZURheXM6IDMwLFxuICBjb2xvclNjaGVtZTogXCJkZWZhdWx0XCIsXG4gIG1pbldlaWdodEZpbHRlcjogMCxcbiAgY29udGludW91c0FuaW1hdGlvbjogZmFsc2UsXG59O1xuIiwgImltcG9ydCB7IEZpbGVTeXN0ZW1BZGFwdGVyLCBJdGVtVmlldywgV29ya3NwYWNlTGVhZiB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgdHlwZSB7IExpbmtXZWlnaHRzRmlsZSB9IGZyb20gXCJAdmF1bHQtbmV1cmFsLWxpbmtzL2NvcmVcIjtcclxuaW1wb3J0IHR5cGUgVmF1bHROZXVyYWxMaW5rc1BsdWdpbiBmcm9tIFwiLi4vbWFpbi5qc1wiO1xyXG5pbXBvcnQgeyBXZWlnaHRzV2F0Y2hlciB9IGZyb20gXCIuLi9XZWlnaHRzV2F0Y2hlci5qc1wiO1xyXG5pbXBvcnQgeyBQcmltZWRXYXRjaGVyIH0gZnJvbSBcIi4uL1ByaW1lZFdhdGNoZXIuanNcIjtcclxuaW1wb3J0IHsgRm9yY2VTaW0sIHR5cGUgTmF0aXZlRWRnZSB9IGZyb20gXCIuL0ZvcmNlU2ltLmpzXCI7XHJcbmltcG9ydCB7IFJlbmRlcmVyIH0gZnJvbSBcIi4vUmVuZGVyZXIuanNcIjtcclxuXHJcbmV4cG9ydCBjb25zdCBORVVSQUxfR1JBUEhfVklFV19UWVBFID0gXCJ2YXVsdC1uZXVyYWwtbGlua3Mtdmlld1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIE5ldXJhbEdyYXBoVmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcclxuICBwcml2YXRlIGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHNpbTogRm9yY2VTaW0gfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHJlbmRlcmVyOiBSZW5kZXJlciB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgd2F0Y2hlcjogV2VpZ2h0c1dhdGNoZXIgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHByaW1lZFdhdGNoZXI6IFByaW1lZFdhdGNoZXIgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHN0YXR1c0VsOiBIVE1MRGl2RWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgbGFzdFdlaWdodHM6IExpbmtXZWlnaHRzRmlsZSB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgZmlyc3RMb2FkRG9uZSA9IGZhbHNlO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIGxlYWY6IFdvcmtzcGFjZUxlYWYsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogVmF1bHROZXVyYWxMaW5rc1BsdWdpbixcclxuICApIHtcclxuICAgIHN1cGVyKGxlYWYpO1xyXG4gIH1cclxuXHJcbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBORVVSQUxfR1JBUEhfVklFV19UWVBFO1xyXG4gIH1cclxuXHJcbiAgZ2V0RGlzcGxheVRleHQoKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBcIk5ldXJhbCBHcmFwaFwiO1xyXG4gIH1cclxuXHJcbiAgZ2V0SWNvbigpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIFwiZ2l0LWZvcmtcIjtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9uT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGVudEVsO1xyXG4gICAgY29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICBjb250YWluZXIuYWRkQ2xhc3MoXCJ2YXVsdC1uZXVyYWwtbGlua3Mtdmlld1wiKTtcclxuXHJcbiAgICB0aGlzLmNhbnZhcyA9IGNvbnRhaW5lci5jcmVhdGVFbChcImNhbnZhc1wiKTtcclxuICAgIHRoaXMuc2ltID0gbmV3IEZvcmNlU2ltKCk7XHJcbiAgICB0aGlzLnNpbS5zZXRDb250aW51b3VzQW5pbWF0aW9uKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbnRpbnVvdXNBbmltYXRpb24pO1xyXG4gICAgdGhpcy5yZW5kZXJlciA9IG5ldyBSZW5kZXJlcih0aGlzLmNhbnZhcywgdGhpcy5zaW0pO1xyXG4gICAgdGhpcy5yZW5kZXJlci5zZXRDb2xvclNjaGVtZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclNjaGVtZSk7XHJcbiAgICB0aGlzLnJlbmRlcmVyLnNldEVkZ2VNYXhBZ2VEYXlzKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlY2F5SGFsZkxpZmVEYXlzKTtcclxuICAgIHRoaXMucmVuZGVyZXIub25Ob2RlQ2xpY2tlZCgocGF0aCkgPT4gdGhpcy5vcGVuTm90ZShwYXRoKSk7XHJcbiAgICB0aGlzLnJlbmRlcmVyLnN0YXJ0KCk7XHJcblxyXG4gICAgdGhpcy5zdGF0dXNFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwidmF1bHQtbmV1cmFsLWxpbmtzLXN0YXR1c1wiIH0pO1xyXG4gICAgdGhpcy5zdGF0dXNFbC5zZXRUZXh0KFwiTG9hZGluZyBncmFwaFx1MjAyNlwiKTtcclxuXHJcbiAgICBjb25zdCBjb250cm9scyA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwidmF1bHQtbmV1cmFsLWxpbmtzLXpvb20tY29udHJvbHNcIiB9KTtcclxuICAgIGNvbnN0IHJlbmRlcmVyID0gdGhpcy5yZW5kZXJlcjtcclxuICAgIGNvbnN0IHNpbSA9IHRoaXMuc2ltO1xyXG4gICAgY29udHJvbHMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIitcIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuZGVyZXIuem9vbUluKCkpO1xyXG4gICAgY29udHJvbHMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjIxMlwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5kZXJlci56b29tT3V0KCkpO1xyXG4gICAgY29udHJvbHMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjdGMlwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5kZXJlci5yZXNldFZpZXcoKSk7XHJcblxyXG4gICAgY29uc3QgYW5pbWF0ZUJ0biA9IGNvbnRyb2xzLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgdGV4dDogXCJcdUQ4M0NcdURGMEFcIixcclxuICAgICAgY2xzOiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb250aW51b3VzQW5pbWF0aW9uID8gXCJpcy1hY3RpdmVcIiA6IFwiXCIsXHJcbiAgICB9KTtcclxuICAgIGFuaW1hdGVCdG4uc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJUb2dnbGUgY29udGludW91cyBhbmltYXRpb25cIik7XHJcbiAgICBhbmltYXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGVuYWJsZWQgPSAhdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29udGludW91c0FuaW1hdGlvbjtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29udGludW91c0FuaW1hdGlvbiA9IGVuYWJsZWQ7XHJcbiAgICAgIHZvaWQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHNpbS5zZXRDb250aW51b3VzQW5pbWF0aW9uKGVuYWJsZWQpO1xyXG4gICAgICBhbmltYXRlQnRuLnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGVuYWJsZWQpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XHJcbiAgICBpZiAoIShhZGFwdGVyIGluc3RhbmNlb2YgRmlsZVN5c3RlbUFkYXB0ZXIpKSB7XHJcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XHJcbiAgICAgICAgdGV4dDogXCJWYXVsdCBOZXVyYWwgTGlua3MgcmVxdWlyZXMgdGhlIGRlc2t0b3AgZmlsZSBzeXN0ZW0gXHUyMDE0IHRoaXMgdmlldyBpcyB1bmF2YWlsYWJsZSBoZXJlLlwiLFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHdlaWdodHNQYXRoID0gYCR7YWRhcHRlci5nZXRCYXNlUGF0aCgpfS8udmF1bHQtbmV1cmFsLWxpbmtzL2xpbmstd2VpZ2h0cy5qc29uYDtcclxuICAgIHRoaXMud2F0Y2hlciA9IG5ldyBXZWlnaHRzV2F0Y2hlcih3ZWlnaHRzUGF0aCk7XHJcbiAgICB0aGlzLndhdGNoZXIuc3RhcnQoXHJcbiAgICAgIChjdXJyZW50LCBwcmV2aW91cykgPT4gdGhpcy5vbldlaWdodHNDaGFuZ2VkKGN1cnJlbnQsIHByZXZpb3VzKSxcclxuICAgICAgKGVycikgPT4gdGhpcy5vbldlaWdodHNFcnJvcihlcnIpLFxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCBzZXNzaW9uRGlyID0gYCR7YWRhcHRlci5nZXRCYXNlUGF0aCgpfS8udmF1bHQtbmV1cmFsLWxpbmtzL3Nlc3Npb25gO1xyXG4gICAgdGhpcy5wcmltZWRXYXRjaGVyID0gbmV3IFByaW1lZFdhdGNoZXIoc2Vzc2lvbkRpcik7XHJcbiAgICB0aGlzLnByaW1lZFdhdGNoZXIuc3RhcnQoKHByaW1lZCkgPT4gdGhpcy5yZW5kZXJlcj8uc2V0UHJpbWVkTm90ZXMocHJpbWVkKSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy53YXRjaGVyPy5zdG9wKCk7XHJcbiAgICB0aGlzLndhdGNoZXIgPSBudWxsO1xyXG4gICAgdGhpcy5wcmltZWRXYXRjaGVyPy5zdG9wKCk7XHJcbiAgICB0aGlzLnByaW1lZFdhdGNoZXIgPSBudWxsO1xyXG4gICAgdGhpcy5yZW5kZXJlcj8uc3RvcCgpO1xyXG4gICAgdGhpcy5yZW5kZXJlciA9IG51bGw7XHJcbiAgICB0aGlzLnNpbSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICAvKiogUmUtYXBwbGllcyBwbHVnaW4gc2V0dGluZ3MgKGNvbG9yIHNjaGVtZSwgZGVjYXkgd2luZG93LCBtaW4td2VpZ2h0IGZpbHRlciwgYW5pbWF0aW9uKSB0byBhIGxpdmUgdmlldy4gKi9cclxuICBhcHBseVNldHRpbmdzKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLnNpbSB8fCAhdGhpcy5yZW5kZXJlcikgcmV0dXJuO1xyXG4gICAgdGhpcy5yZW5kZXJlci5zZXRDb2xvclNjaGVtZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclNjaGVtZSk7XHJcbiAgICB0aGlzLnJlbmRlcmVyLnNldEVkZ2VNYXhBZ2VEYXlzKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlY2F5SGFsZkxpZmVEYXlzKTtcclxuICAgIHRoaXMuc2ltLnNldENvbnRpbnVvdXNBbmltYXRpb24odGhpcy5wbHVnaW4uc2V0dGluZ3MuY29udGludW91c0FuaW1hdGlvbik7XHJcbiAgICBpZiAodGhpcy5sYXN0V2VpZ2h0cykge1xyXG4gICAgICBjb25zdCBub3RlUGF0aHMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkubWFwKChmKSA9PiBmLnBhdGgucmVwbGFjZSgvXFwubWQkLywgXCJcIikpO1xyXG4gICAgICB0aGlzLnNpbS5zZXREYXRhKG5vdGVQYXRocywgdGhpcy5sYXN0V2VpZ2h0cywgdGhpcy5nZXROYXRpdmVFZGdlcygpLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5taW5XZWlnaHRGaWx0ZXIpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbldlaWdodHNFcnJvcihlcnI6IE5vZGVKUy5FcnJub0V4Y2VwdGlvbiB8IHVua25vd24pOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmZpcnN0TG9hZERvbmUpIHtcclxuICAgICAgLy8gZ3JhcGggaXMgYWxyZWFkeSBzaG93aW5nIGRhdGE7IGEgdHJhbnNpZW50IHJlYWQvcGFyc2UgZmFpbHVyZSAoZS5nLiBtaWQtY29tcGFjdGlvblxyXG4gICAgICAvLyB3cml0ZSByYWNlKSBzaG91bGRuJ3QgYmxhbmsgaXQgb3V0IFx1MjAxNCBqdXN0IGxvZyBmb3IgZGlhZ25vc2lzXHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJWYXVsdCBOZXVyYWwgTGlua3M6IGZhaWxlZCB0byByZWFkIGxpbmstd2VpZ2h0cy5qc29uXCIsIGVycik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGlzTWlzc2luZyA9IChlcnIgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKT8uY29kZSA9PT0gXCJFTk9FTlRcIjtcclxuICAgIHRoaXMuc3RhdHVzRWw/LnNldFRleHQoXHJcbiAgICAgIGlzTWlzc2luZ1xyXG4gICAgICAgID8gXCJObyBsaW5rLXdlaWdodHMuanNvbiB5ZXQgXHUyMDE0IGNyZWF0ZSBvciBsaW5rIHNvbWUgbm90ZXMgdmlhIHRoZSB2YXVsdC1uZXVyYWwtbGluayBNQ1Agc2VydmVyIGZpcnN0LlwiXHJcbiAgICAgICAgOiBcIkZhaWxlZCB0byByZWFkIGxpbmstd2VpZ2h0cy5qc29uIFx1MjAxNCBzZWUgdGhlIGRldmVsb3BlciBjb25zb2xlIGZvciBkZXRhaWxzLlwiLFxyXG4gICAgKTtcclxuICAgIGlmICghaXNNaXNzaW5nKSBjb25zb2xlLmVycm9yKFwiVmF1bHQgTmV1cmFsIExpbmtzOiBmYWlsZWQgdG8gcmVhZCBsaW5rLXdlaWdodHMuanNvblwiLCBlcnIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbldlaWdodHNDaGFuZ2VkKGN1cnJlbnQ6IExpbmtXZWlnaHRzRmlsZSwgcHJldmlvdXM6IExpbmtXZWlnaHRzRmlsZSB8IG51bGwpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5zaW0pIHJldHVybjtcclxuICAgIGlmICghdGhpcy5maXJzdExvYWREb25lKSB7XHJcbiAgICAgIHRoaXMuZmlyc3RMb2FkRG9uZSA9IHRydWU7XHJcbiAgICAgIHRoaXMuc3RhdHVzRWw/LnJlbW92ZSgpO1xyXG4gICAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcclxuICAgIH1cclxuICAgIHRoaXMubGFzdFdlaWdodHMgPSBjdXJyZW50O1xyXG4gICAgY29uc3Qgbm90ZVBhdGhzID0gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLm1hcCgoZikgPT4gZi5wYXRoLnJlcGxhY2UoL1xcLm1kJC8sIFwiXCIpKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIHRoaXMuc2ltLnNldERhdGEobm90ZVBhdGhzLCBjdXJyZW50LCB0aGlzLmdldE5hdGl2ZUVkZ2VzKCksIHRoaXMucGx1Z2luLnNldHRpbmdzLm1pbldlaWdodEZpbHRlcik7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihcIlZhdWx0IE5ldXJhbCBMaW5rczogZmFpbGVkIHRvIHJlbmRlciBncmFwaFwiLCBlcnIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFwcmV2aW91cyB8fCAhdGhpcy5yZW5kZXJlcikgcmV0dXJuO1xyXG4gICAgZm9yIChjb25zdCBba2V5LCByZWNvcmRdIG9mIE9iamVjdC5lbnRyaWVzKGN1cnJlbnQuZWRnZXMpKSB7XHJcbiAgICAgIGNvbnN0IHByZXZSZWNvcmQgPSBwcmV2aW91cy5lZGdlc1trZXldO1xyXG4gICAgICBpZiAoIXByZXZSZWNvcmQgfHwgcHJldlJlY29yZC5yZWluZm9yY2VDb3VudCAhPT0gcmVjb3JkLnJlaW5mb3JjZUNvdW50KSB7XHJcbiAgICAgICAgY29uc3QgW3NvdXJjZSwgdGFyZ2V0XSA9IGtleS5zcGxpdChcInxcIik7XHJcbiAgICAgICAgaWYgKHNvdXJjZSAmJiB0YXJnZXQpIHRoaXMucmVuZGVyZXIucHVsc2VFZGdlKHNvdXJjZSwgdGFyZ2V0KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqIE9ic2lkaWFuJ3Mgb3duIFtbd2lraWxpbmtdXSBncmFwaCwgZGVkdXBlZCB0byBvbmUgdW5kaXJlY3RlZCBlZGdlIHBlciBwYWlyLiAqL1xyXG4gIHByaXZhdGUgZ2V0TmF0aXZlRWRnZXMoKTogTmF0aXZlRWRnZVtdIHtcclxuICAgIGNvbnN0IHJlc29sdmVkID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5yZXNvbHZlZExpbmtzO1xyXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgY29uc3QgZWRnZXM6IE5hdGl2ZUVkZ2VbXSA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBbc291cmNlUGF0aCwgdGFyZ2V0c10gb2YgT2JqZWN0LmVudHJpZXMocmVzb2x2ZWQpKSB7XHJcbiAgICAgIGNvbnN0IHNvdXJjZSA9IHNvdXJjZVBhdGgucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XHJcbiAgICAgIGZvciAoY29uc3QgdGFyZ2V0UGF0aCBvZiBPYmplY3Qua2V5cyh0YXJnZXRzKSkge1xyXG4gICAgICAgIGlmICghdGFyZ2V0UGF0aC5lbmRzV2l0aChcIi5tZFwiKSkgY29udGludWU7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gdGFyZ2V0UGF0aC5yZXBsYWNlKC9cXC5tZCQvLCBcIlwiKTtcclxuICAgICAgICBpZiAoc291cmNlID09PSB0YXJnZXQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvbnN0IGtleSA9IFtzb3VyY2UsIHRhcmdldF0uc29ydCgpLmpvaW4oXCJ8XCIpO1xyXG4gICAgICAgIGlmIChzZWVuLmhhcyhrZXkpKSBjb250aW51ZTtcclxuICAgICAgICBzZWVuLmFkZChrZXkpO1xyXG4gICAgICAgIGVkZ2VzLnB1c2goeyBzb3VyY2UsIHRhcmdldCB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGVkZ2VzO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvcGVuTm90ZShwYXRoOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkuZmluZCgoZikgPT4gZi5wYXRoLnJlcGxhY2UoL1xcLm1kJC8sIFwiXCIpID09PSBwYXRoKTtcclxuICAgIGlmIChmaWxlKSB2b2lkIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKGZhbHNlKS5vcGVuRmlsZShmaWxlKTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHsgTGlua1dlaWdodHNGaWxlIH0gZnJvbSBcIkB2YXVsdC1uZXVyYWwtbGlua3MvY29yZVwiO1xyXG5cclxuY29uc3QgUE9MTF9JTlRFUlZBTF9NUyA9IDIwMDA7XHJcbmNvbnN0IERFQk9VTkNFX01TID0gNTAwO1xyXG5cclxudHlwZSBGU1dhdGNoZXIgPSB7IGNsb3NlKCk6IHZvaWQgfTtcclxudHlwZSBOb2RlRnMgPSB7XHJcbiAgd2F0Y2gocGF0aDogc3RyaW5nLCBjYWxsYmFjazogKGV2ZW50OiBzdHJpbmcpID0+IHZvaWQpOiBGU1dhdGNoZXI7XHJcbiAgcmVhZEZpbGUocGF0aDogc3RyaW5nLCBlbmNvZGluZzogXCJ1dGYtOFwiLCBjYjogKGVycjogdW5rbm93biwgZGF0YTogc3RyaW5nKSA9PiB2b2lkKTogdm9pZDtcclxufTtcclxuXHJcbmZ1bmN0aW9uIGxvYWRGcygpOiBOb2RlRnMgfCBudWxsIHtcclxuICB0cnkge1xyXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHNcclxuICAgIHJldHVybiByZXF1aXJlKFwibm9kZTpmc1wiKSBhcyBOb2RlRnM7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBXYXRjaGVzIGRhdGEvbGluay13ZWlnaHRzLmpzb24gKGZzLndhdGNoLCB3aXRoIHBvbGxpbmcgZmFsbGJhY2spLFxyXG4gKiBkZWJvdW5jZXMgcmVsb2FkcyAofjUwMG1zKSwgYW5kIGVtaXRzIGRpZmZzIGFnYWluc3QgdGhlIHByZXZpb3VzXHJcbiAqIHNuYXBzaG90IHNvIHRoZSByZW5kZXJlciBjYW4gZHJpdmUgcmVpbmZvcmNlbWVudC1wdWxzZSBhbmltYXRpb25zLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFdlaWdodHNXYXRjaGVyIHtcclxuICBwcml2YXRlIGZzV2F0Y2hlcjogRlNXYXRjaGVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBwb2xsSGFuZGxlOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGRlYm91bmNlSGFuZGxlOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgcHJldmlvdXM6IExpbmtXZWlnaHRzRmlsZSB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgb25DaGFuZ2U6ICgoY3VycmVudDogTGlua1dlaWdodHNGaWxlLCBwcmV2aW91czogTGlua1dlaWdodHNGaWxlIHwgbnVsbCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG9uRXJyb3I6ICgoZXJyOiBOb2RlSlMuRXJybm9FeGNlcHRpb24gfCB1bmtub3duKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xyXG5cclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGZpbGVQYXRoOiBzdHJpbmcpIHt9XHJcblxyXG4gIHN0YXJ0KFxyXG4gICAgb25DaGFuZ2U6IChjdXJyZW50OiBMaW5rV2VpZ2h0c0ZpbGUsIHByZXZpb3VzOiBMaW5rV2VpZ2h0c0ZpbGUgfCBudWxsKSA9PiB2b2lkLFxyXG4gICAgb25FcnJvcj86IChlcnI6IE5vZGVKUy5FcnJub0V4Y2VwdGlvbiB8IHVua25vd24pID0+IHZvaWQsXHJcbiAgKTogdm9pZCB7XHJcbiAgICB0aGlzLm9uQ2hhbmdlID0gb25DaGFuZ2U7XHJcbiAgICB0aGlzLm9uRXJyb3IgPSBvbkVycm9yID8/IG51bGw7XHJcbiAgICB2b2lkIHRoaXMucmVsb2FkKCk7XHJcblxyXG4gICAgY29uc3QgZnMgPSBsb2FkRnMoKTtcclxuICAgIGlmIChmcykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHRoaXMuZnNXYXRjaGVyID0gZnMud2F0Y2godGhpcy5maWxlUGF0aCwgKCkgPT4gdGhpcy5zY2hlZHVsZVJlbG9hZCgpKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIHRoaXMuZnNXYXRjaGVyID0gbnVsbDtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucG9sbEhhbmRsZSA9IHNldEludGVydmFsKCgpID0+IHZvaWQgdGhpcy5yZWxvYWQoKSwgUE9MTF9JTlRFUlZBTF9NUyk7XHJcbiAgfVxyXG5cclxuICBzdG9wKCk6IHZvaWQge1xyXG4gICAgdGhpcy5mc1dhdGNoZXI/LmNsb3NlKCk7XHJcbiAgICB0aGlzLmZzV2F0Y2hlciA9IG51bGw7XHJcbiAgICBpZiAodGhpcy5wb2xsSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5wb2xsSGFuZGxlKTtcclxuICAgICAgdGhpcy5wb2xsSGFuZGxlID0gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICh0aGlzLmRlYm91bmNlSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlYm91bmNlSGFuZGxlKTtcclxuICAgICAgdGhpcy5kZWJvdW5jZUhhbmRsZSA9IG51bGw7XHJcbiAgICB9XHJcbiAgICB0aGlzLm9uQ2hhbmdlID0gbnVsbDtcclxuICAgIHRoaXMub25FcnJvciA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNjaGVkdWxlUmVsb2FkKCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMuZGVib3VuY2VIYW5kbGUgIT09IG51bGwpIGNsZWFyVGltZW91dCh0aGlzLmRlYm91bmNlSGFuZGxlKTtcclxuICAgIHRoaXMuZGVib3VuY2VIYW5kbGUgPSBzZXRUaW1lb3V0KCgpID0+IHZvaWQgdGhpcy5yZWxvYWQoKSwgREVCT1VOQ0VfTVMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBmcyA9IGxvYWRGcygpO1xyXG4gICAgaWYgKCFmcykgcmV0dXJuO1xyXG4gICAgZnMucmVhZEZpbGUodGhpcy5maWxlUGF0aCwgXCJ1dGYtOFwiLCAoZXJyLCBkYXRhKSA9PiB7XHJcbiAgICAgIGlmIChlcnIpIHtcclxuICAgICAgICB0aGlzLm9uRXJyb3I/LihlcnIpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBsZXQgcGFyc2VkOiBMaW5rV2VpZ2h0c0ZpbGU7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKSBhcyBMaW5rV2VpZ2h0c0ZpbGU7XHJcbiAgICAgIH0gY2F0Y2ggKHBhcnNlRXJyKSB7XHJcbiAgICAgICAgdGhpcy5vbkVycm9yPy4ocGFyc2VFcnIpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBpZiAodGhpcy5wcmV2aW91cz8uY29tcGFjdGVkQXQgPT09IHBhcnNlZC5jb21wYWN0ZWRBdCkgcmV0dXJuO1xyXG4gICAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMucHJldmlvdXM7XHJcbiAgICAgIHRoaXMucHJldmlvdXMgPSBwYXJzZWQ7XHJcbiAgICAgIHRoaXMub25DaGFuZ2U/LihwYXJzZWQsIHByZXZpb3VzKTtcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHR5cGUgeyBTZXNzaW9uQnVmZmVyRmlsZSB9IGZyb20gXCJAdmF1bHQtbmV1cmFsLWxpbmtzL2NvcmVcIjtcblxuY29uc3QgUE9MTF9JTlRFUlZBTF9NUyA9IDIwMDA7XG4vLyBUaGVyZSdzIG5vIGNsZWFuLXNodXRkb3duIGhvb2sgd2hlbiBhbiBNQ1Agc2VydmVyIGluc3RhbmNlJ3Mgc2Vzc2lvblxuLy8gZW5kcywgc28gYSBzZXNzaW9uLWJ1ZmZlciBmaWxlIGxpbmdlcnMgb24gZGlzayBmb3JldmVyIG90aGVyd2lzZS4gVHJlYXRcbi8vIGZpbGVzIG5vdCB1cGRhdGVkIHdpdGhpbiB0aGlzIHdpbmRvdyBhcyBiZWxvbmdpbmcgdG8gYW4gZW5kZWQgc2Vzc2lvbi5cbmNvbnN0IFNUQUxFX01TID0gMTUgKiA2MCAqIDEwMDA7XG5cbnR5cGUgTm9kZUZzID0ge1xuICByZWFkZGlyKHBhdGg6IHN0cmluZywgY2I6IChlcnI6IHVua25vd24sIGZpbGVzOiBzdHJpbmdbXSkgPT4gdm9pZCk6IHZvaWQ7XG4gIHJlYWRGaWxlKHBhdGg6IHN0cmluZywgZW5jb2Rpbmc6IFwidXRmLThcIiwgY2I6IChlcnI6IHVua25vd24sIGRhdGE6IHN0cmluZykgPT4gdm9pZCk6IHZvaWQ7XG59O1xuXG5mdW5jdGlvbiBsb2FkRnMoKTogTm9kZUZzIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHNcbiAgICByZXR1cm4gcmVxdWlyZShcIm5vZGU6ZnNcIikgYXMgTm9kZUZzO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFBvbGxzIGAudmF1bHQtbmV1cmFsLWxpbmtzL3Nlc3Npb24vKi5qc29uYCBcdTIwMTQgb25lIGZpbGUgcGVyIGxpdmUgTUNQXG4gKiBzZXJ2ZXIgaW5zdGFuY2UncyBpbi1tZW1vcnkgU2Vzc2lvbkJ1ZmZlciAoc2VlIHBhY2thZ2VzL2NvcmUvc3JjL3ByaW1pbmcudHMpXG4gKiBcdTIwMTQgYW5kIHVuaW9ucyB0aGUgbm90ZXMgZnJvbSBub24tc3RhbGUgZmlsZXMgaW50byBhIHNpbmdsZSBcInByaW1lZFwiIHNldFxuICogZm9yIHRoZSBncmFwaCB2aWV3IHRvIHJpbmcuIFBvbGxzIHJhdGhlciB0aGFuIGZzLndhdGNoIG9uIHRoZSBkaXJlY3RvcnlcbiAqIHNpbmNlIHdhdGNoaW5nIGEgZGlyZWN0b3J5IGZvciBjb250ZW50IGNoYW5nZXMgaW4gZmlsZXMgaXQgY29udGFpbnNcbiAqIGlzbid0IHJlbGlhYmxlIGNyb3NzLXBsYXRmb3JtLCBhbmQgdGhpcyBtaXJyb3JzIFdlaWdodHNXYXRjaGVyJ3Mgb3duXG4gKiBwb2xsaW5nIGZhbGxiYWNrIGludGVydmFsLlxuICovXG5leHBvcnQgY2xhc3MgUHJpbWVkV2F0Y2hlciB7XG4gIHByaXZhdGUgcG9sbEhhbmRsZTogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcHJldmlvdXNLZXkgPSBcIlwiO1xuICBwcml2YXRlIG9uQ2hhbmdlOiAoKHByaW1lZDogUmVhZG9ubHlTZXQ8c3RyaW5nPikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHNlc3Npb25EaXI6IHN0cmluZykge31cblxuICBzdGFydChvbkNoYW5nZTogKHByaW1lZDogUmVhZG9ubHlTZXQ8c3RyaW5nPikgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMub25DaGFuZ2UgPSBvbkNoYW5nZTtcbiAgICB2b2lkIHRoaXMucmVsb2FkKCk7XG4gICAgdGhpcy5wb2xsSGFuZGxlID0gc2V0SW50ZXJ2YWwoKCkgPT4gdm9pZCB0aGlzLnJlbG9hZCgpLCBQT0xMX0lOVEVSVkFMX01TKTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucG9sbEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnBvbGxIYW5kbGUpO1xuICAgICAgdGhpcy5wb2xsSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5vbkNoYW5nZSA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmcyA9IGxvYWRGcygpO1xuICAgIGlmICghZnMpIHJldHVybjtcblxuICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgbmV3IFByb21pc2U8c3RyaW5nW10+KChyZXNvbHZlKSA9PiB7XG4gICAgICBmcy5yZWFkZGlyKHRoaXMuc2Vzc2lvbkRpciwgKGVyciwgZW50cmllcykgPT4gcmVzb2x2ZShlcnIgPyBbXSA6IGVudHJpZXMpKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgY29uc3QgcHJpbWVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICBpZiAoIWZpbGUuZW5kc1dpdGgoXCIuanNvblwiKSkgY29udGludWU7XG4gICAgICBjb25zdCByYXcgPSBhd2FpdCBuZXcgUHJvbWlzZTxzdHJpbmcgfCBudWxsPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICBmcy5yZWFkRmlsZShgJHt0aGlzLnNlc3Npb25EaXJ9LyR7ZmlsZX1gLCBcInV0Zi04XCIsIChlcnIsIGRhdGEpID0+IHJlc29sdmUoZXJyID8gbnVsbCA6IGRhdGEpKTtcbiAgICAgIH0pO1xuICAgICAgaWYgKCFyYXcpIGNvbnRpbnVlO1xuXG4gICAgICBsZXQgcGFyc2VkOiBTZXNzaW9uQnVmZmVyRmlsZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyBTZXNzaW9uQnVmZmVyRmlsZTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChub3cgLSBEYXRlLnBhcnNlKHBhcnNlZC51cGRhdGVkQXQpID4gU1RBTEVfTVMpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCBub3RlIG9mIHBhcnNlZC5ub3RlcykgcHJpbWVkLmFkZChub3RlKTtcbiAgICB9XG5cbiAgICBjb25zdCBrZXkgPSBbLi4ucHJpbWVkXS5zb3J0KCkuam9pbihcInxcIik7XG4gICAgaWYgKGtleSA9PT0gdGhpcy5wcmV2aW91c0tleSkgcmV0dXJuO1xuICAgIHRoaXMucHJldmlvdXNLZXkgPSBrZXk7XG4gICAgdGhpcy5vbkNoYW5nZT8uKHByaW1lZCk7XG4gIH1cbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4LCB5KSB7XG4gIHZhciBub2Rlcywgc3RyZW5ndGggPSAxO1xuXG4gIGlmICh4ID09IG51bGwpIHggPSAwO1xuICBpZiAoeSA9PSBudWxsKSB5ID0gMDtcblxuICBmdW5jdGlvbiBmb3JjZSgpIHtcbiAgICB2YXIgaSxcbiAgICAgICAgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgbm9kZSxcbiAgICAgICAgc3ggPSAwLFxuICAgICAgICBzeSA9IDA7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBub2RlID0gbm9kZXNbaV0sIHN4ICs9IG5vZGUueCwgc3kgKz0gbm9kZS55O1xuICAgIH1cblxuICAgIGZvciAoc3ggPSAoc3ggLyBuIC0geCkgKiBzdHJlbmd0aCwgc3kgPSAoc3kgLyBuIC0geSkgKiBzdHJlbmd0aCwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS54IC09IHN4LCBub2RlLnkgLT0gc3k7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gIH07XG5cbiAgZm9yY2UueCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh4ID0gK18sIGZvcmNlKSA6IHg7XG4gIH07XG5cbiAgZm9yY2UueSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh5ID0gK18sIGZvcmNlKSA6IHk7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSArXywgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgcmV0dXJuIGZvcmNlO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGQpIHtcbiAgY29uc3QgeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCksXG4gICAgICB5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKTtcbiAgcmV0dXJuIGFkZCh0aGlzLmNvdmVyKHgsIHkpLCB4LCB5LCBkKTtcbn1cblxuZnVuY3Rpb24gYWRkKHRyZWUsIHgsIHksIGQpIHtcbiAgaWYgKGlzTmFOKHgpIHx8IGlzTmFOKHkpKSByZXR1cm4gdHJlZTsgLy8gaWdub3JlIGludmFsaWQgcG9pbnRzXG5cbiAgdmFyIHBhcmVudCxcbiAgICAgIG5vZGUgPSB0cmVlLl9yb290LFxuICAgICAgbGVhZiA9IHtkYXRhOiBkfSxcbiAgICAgIHgwID0gdHJlZS5feDAsXG4gICAgICB5MCA9IHRyZWUuX3kwLFxuICAgICAgeDEgPSB0cmVlLl94MSxcbiAgICAgIHkxID0gdHJlZS5feTEsXG4gICAgICB4bSxcbiAgICAgIHltLFxuICAgICAgeHAsXG4gICAgICB5cCxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0cmVlLl9yb290ID0gbGVhZiwgdHJlZTtcblxuICAvLyBGaW5kIHRoZSBleGlzdGluZyBsZWFmIGZvciB0aGUgbmV3IHBvaW50LCBvciBhZGQgaXQuXG4gIHdoaWxlIChub2RlLmxlbmd0aCkge1xuICAgIGlmIChyaWdodCA9IHggPj0gKHhtID0gKHgwICsgeDEpIC8gMikpIHgwID0geG07IGVsc2UgeDEgPSB4bTtcbiAgICBpZiAoYm90dG9tID0geSA+PSAoeW0gPSAoeTAgKyB5MSkgLyAyKSkgeTAgPSB5bTsgZWxzZSB5MSA9IHltO1xuICAgIGlmIChwYXJlbnQgPSBub2RlLCAhKG5vZGUgPSBub2RlW2kgPSBib3R0b20gPDwgMSB8IHJpZ2h0XSkpIHJldHVybiBwYXJlbnRbaV0gPSBsZWFmLCB0cmVlO1xuICB9XG5cbiAgLy8gSXMgdGhlIG5ldyBwb2ludCBpcyBleGFjdGx5IGNvaW5jaWRlbnQgd2l0aCB0aGUgZXhpc3RpbmcgcG9pbnQ/XG4gIHhwID0gK3RyZWUuX3guY2FsbChudWxsLCBub2RlLmRhdGEpO1xuICB5cCA9ICt0cmVlLl95LmNhbGwobnVsbCwgbm9kZS5kYXRhKTtcbiAgaWYgKHggPT09IHhwICYmIHkgPT09IHlwKSByZXR1cm4gbGVhZi5uZXh0ID0gbm9kZSwgcGFyZW50ID8gcGFyZW50W2ldID0gbGVhZiA6IHRyZWUuX3Jvb3QgPSBsZWFmLCB0cmVlO1xuXG4gIC8vIE90aGVyd2lzZSwgc3BsaXQgdGhlIGxlYWYgbm9kZSB1bnRpbCB0aGUgb2xkIGFuZCBuZXcgcG9pbnQgYXJlIHNlcGFyYXRlZC5cbiAgZG8ge1xuICAgIHBhcmVudCA9IHBhcmVudCA/IHBhcmVudFtpXSA9IG5ldyBBcnJheSg0KSA6IHRyZWUuX3Jvb3QgPSBuZXcgQXJyYXkoNCk7XG4gICAgaWYgKHJpZ2h0ID0geCA+PSAoeG0gPSAoeDAgKyB4MSkgLyAyKSkgeDAgPSB4bTsgZWxzZSB4MSA9IHhtO1xuICAgIGlmIChib3R0b20gPSB5ID49ICh5bSA9ICh5MCArIHkxKSAvIDIpKSB5MCA9IHltOyBlbHNlIHkxID0geW07XG4gIH0gd2hpbGUgKChpID0gYm90dG9tIDw8IDEgfCByaWdodCkgPT09IChqID0gKHlwID49IHltKSA8PCAxIHwgKHhwID49IHhtKSkpO1xuICByZXR1cm4gcGFyZW50W2pdID0gbm9kZSwgcGFyZW50W2ldID0gbGVhZiwgdHJlZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEFsbChkYXRhKSB7XG4gIHZhciBkLCBpLCBuID0gZGF0YS5sZW5ndGgsXG4gICAgICB4LFxuICAgICAgeSxcbiAgICAgIHh6ID0gbmV3IEFycmF5KG4pLFxuICAgICAgeXogPSBuZXcgQXJyYXkobiksXG4gICAgICB4MCA9IEluZmluaXR5LFxuICAgICAgeTAgPSBJbmZpbml0eSxcbiAgICAgIHgxID0gLUluZmluaXR5LFxuICAgICAgeTEgPSAtSW5maW5pdHk7XG5cbiAgLy8gQ29tcHV0ZSB0aGUgcG9pbnRzIGFuZCB0aGVpciBleHRlbnQuXG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCA9IGRhdGFbaV0pKSB8fCBpc05hTih5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKSkpIGNvbnRpbnVlO1xuICAgIHh6W2ldID0geDtcbiAgICB5eltpXSA9IHk7XG4gICAgaWYgKHggPCB4MCkgeDAgPSB4O1xuICAgIGlmICh4ID4geDEpIHgxID0geDtcbiAgICBpZiAoeSA8IHkwKSB5MCA9IHk7XG4gICAgaWYgKHkgPiB5MSkgeTEgPSB5O1xuICB9XG5cbiAgLy8gSWYgdGhlcmUgd2VyZSBubyAodmFsaWQpIHBvaW50cywgYWJvcnQuXG4gIGlmICh4MCA+IHgxIHx8IHkwID4geTEpIHJldHVybiB0aGlzO1xuXG4gIC8vIEV4cGFuZCB0aGUgdHJlZSB0byBjb3ZlciB0aGUgbmV3IHBvaW50cy5cbiAgdGhpcy5jb3Zlcih4MCwgeTApLmNvdmVyKHgxLCB5MSk7XG5cbiAgLy8gQWRkIHRoZSBuZXcgcG9pbnRzLlxuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgYWRkKHRoaXMsIHh6W2ldLCB5eltpXSwgZGF0YVtpXSk7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4LCB5KSB7XG4gIGlmIChpc05hTih4ID0gK3gpIHx8IGlzTmFOKHkgPSAreSkpIHJldHVybiB0aGlzOyAvLyBpZ25vcmUgaW52YWxpZCBwb2ludHNcblxuICB2YXIgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MTtcblxuICAvLyBJZiB0aGUgcXVhZHRyZWUgaGFzIG5vIGV4dGVudCwgaW5pdGlhbGl6ZSB0aGVtLlxuICAvLyBJbnRlZ2VyIGV4dGVudCBhcmUgbmVjZXNzYXJ5IHNvIHRoYXQgaWYgd2UgbGF0ZXIgZG91YmxlIHRoZSBleHRlbnQsXG4gIC8vIHRoZSBleGlzdGluZyBxdWFkcmFudCBib3VuZGFyaWVzIGRvblx1MjAxOXQgY2hhbmdlIGR1ZSB0byBmbG9hdGluZyBwb2ludCBlcnJvciFcbiAgaWYgKGlzTmFOKHgwKSkge1xuICAgIHgxID0gKHgwID0gTWF0aC5mbG9vcih4KSkgKyAxO1xuICAgIHkxID0gKHkwID0gTWF0aC5mbG9vcih5KSkgKyAxO1xuICB9XG5cbiAgLy8gT3RoZXJ3aXNlLCBkb3VibGUgcmVwZWF0ZWRseSB0byBjb3Zlci5cbiAgZWxzZSB7XG4gICAgdmFyIHogPSB4MSAtIHgwIHx8IDEsXG4gICAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIGk7XG5cbiAgICB3aGlsZSAoeDAgPiB4IHx8IHggPj0geDEgfHwgeTAgPiB5IHx8IHkgPj0geTEpIHtcbiAgICAgIGkgPSAoeSA8IHkwKSA8PCAxIHwgKHggPCB4MCk7XG4gICAgICBwYXJlbnQgPSBuZXcgQXJyYXkoNCksIHBhcmVudFtpXSA9IG5vZGUsIG5vZGUgPSBwYXJlbnQsIHogKj0gMjtcbiAgICAgIHN3aXRjaCAoaSkge1xuICAgICAgICBjYXNlIDA6IHgxID0geDAgKyB6LCB5MSA9IHkwICsgejsgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogeDAgPSB4MSAtIHosIHkxID0geTAgKyB6OyBicmVhaztcbiAgICAgICAgY2FzZSAyOiB4MSA9IHgwICsgeiwgeTAgPSB5MSAtIHo7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHgwID0geDEgLSB6LCB5MCA9IHkxIC0gejsgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3Jvb3QgJiYgdGhpcy5fcm9vdC5sZW5ndGgpIHRoaXMuX3Jvb3QgPSBub2RlO1xuICB9XG5cbiAgdGhpcy5feDAgPSB4MDtcbiAgdGhpcy5feTAgPSB5MDtcbiAgdGhpcy5feDEgPSB4MTtcbiAgdGhpcy5feTEgPSB5MTtcbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBkYXRhID0gW107XG4gIHRoaXMudmlzaXQoZnVuY3Rpb24obm9kZSkge1xuICAgIGlmICghbm9kZS5sZW5ndGgpIGRvIGRhdGEucHVzaChub2RlLmRhdGEpOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBkYXRhO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5jb3ZlcigrX1swXVswXSwgK19bMF1bMV0pLmNvdmVyKCtfWzFdWzBdLCArX1sxXVsxXSlcbiAgICAgIDogaXNOYU4odGhpcy5feDApID8gdW5kZWZpbmVkIDogW1t0aGlzLl94MCwgdGhpcy5feTBdLCBbdGhpcy5feDEsIHRoaXMuX3kxXV07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy54MCA9IHgwO1xuICB0aGlzLnkwID0geTA7XG4gIHRoaXMueDEgPSB4MTtcbiAgdGhpcy55MSA9IHkxO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gIHZhciBkYXRhLFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSxcbiAgICAgIHkxLFxuICAgICAgeDIsXG4gICAgICB5MixcbiAgICAgIHgzID0gdGhpcy5feDEsXG4gICAgICB5MyA9IHRoaXMuX3kxLFxuICAgICAgcXVhZHMgPSBbXSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgcSxcbiAgICAgIGk7XG5cbiAgaWYgKG5vZGUpIHF1YWRzLnB1c2gobmV3IFF1YWQobm9kZSwgeDAsIHkwLCB4MywgeTMpKTtcbiAgaWYgKHJhZGl1cyA9PSBudWxsKSByYWRpdXMgPSBJbmZpbml0eTtcbiAgZWxzZSB7XG4gICAgeDAgPSB4IC0gcmFkaXVzLCB5MCA9IHkgLSByYWRpdXM7XG4gICAgeDMgPSB4ICsgcmFkaXVzLCB5MyA9IHkgKyByYWRpdXM7XG4gICAgcmFkaXVzICo9IHJhZGl1cztcbiAgfVxuXG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcblxuICAgIC8vIFN0b3Agc2VhcmNoaW5nIGlmIHRoaXMgcXVhZHJhbnQgY2FuXHUyMDE5dCBjb250YWluIGEgY2xvc2VyIG5vZGUuXG4gICAgaWYgKCEobm9kZSA9IHEubm9kZSlcbiAgICAgICAgfHwgKHgxID0gcS54MCkgPiB4M1xuICAgICAgICB8fCAoeTEgPSBxLnkwKSA+IHkzXG4gICAgICAgIHx8ICh4MiA9IHEueDEpIDwgeDBcbiAgICAgICAgfHwgKHkyID0gcS55MSkgPCB5MCkgY29udGludWU7XG5cbiAgICAvLyBCaXNlY3QgdGhlIGN1cnJlbnQgcXVhZHJhbnQuXG4gICAgaWYgKG5vZGUubGVuZ3RoKSB7XG4gICAgICB2YXIgeG0gPSAoeDEgKyB4MikgLyAyLFxuICAgICAgICAgIHltID0gKHkxICsgeTIpIC8gMjtcblxuICAgICAgcXVhZHMucHVzaChcbiAgICAgICAgbmV3IFF1YWQobm9kZVszXSwgeG0sIHltLCB4MiwgeTIpLFxuICAgICAgICBuZXcgUXVhZChub2RlWzJdLCB4MSwgeW0sIHhtLCB5MiksXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbMV0sIHhtLCB5MSwgeDIsIHltKSxcbiAgICAgICAgbmV3IFF1YWQobm9kZVswXSwgeDEsIHkxLCB4bSwgeW0pXG4gICAgICApO1xuXG4gICAgICAvLyBWaXNpdCB0aGUgY2xvc2VzdCBxdWFkcmFudCBmaXJzdC5cbiAgICAgIGlmIChpID0gKHkgPj0geW0pIDw8IDEgfCAoeCA+PSB4bSkpIHtcbiAgICAgICAgcSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDFdO1xuICAgICAgICBxdWFkc1txdWFkcy5sZW5ndGggLSAxXSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDEgLSBpXTtcbiAgICAgICAgcXVhZHNbcXVhZHMubGVuZ3RoIC0gMSAtIGldID0gcTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBWaXNpdCB0aGlzIHBvaW50LiAoVmlzaXRpbmcgY29pbmNpZGVudCBwb2ludHMgaXNuXHUyMDE5dCBuZWNlc3NhcnkhKVxuICAgIGVsc2Uge1xuICAgICAgdmFyIGR4ID0geCAtICt0aGlzLl94LmNhbGwobnVsbCwgbm9kZS5kYXRhKSxcbiAgICAgICAgICBkeSA9IHkgLSArdGhpcy5feS5jYWxsKG51bGwsIG5vZGUuZGF0YSksXG4gICAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgIGlmIChkMiA8IHJhZGl1cykge1xuICAgICAgICB2YXIgZCA9IE1hdGguc3FydChyYWRpdXMgPSBkMik7XG4gICAgICAgIHgwID0geCAtIGQsIHkwID0geSAtIGQ7XG4gICAgICAgIHgzID0geCArIGQsIHkzID0geSArIGQ7XG4gICAgICAgIGRhdGEgPSBub2RlLmRhdGE7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRhdGE7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZCkge1xuICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCkpIHx8IGlzTmFOKHkgPSArdGhpcy5feS5jYWxsKG51bGwsIGQpKSkgcmV0dXJuIHRoaXM7IC8vIGlnbm9yZSBpbnZhbGlkIHBvaW50c1xuXG4gIHZhciBwYXJlbnQsXG4gICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgIHJldGFpbmVyLFxuICAgICAgcHJldmlvdXMsXG4gICAgICBuZXh0LFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MSxcbiAgICAgIHgsXG4gICAgICB5LFxuICAgICAgeG0sXG4gICAgICB5bSxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0aGlzO1xuXG4gIC8vIEZpbmQgdGhlIGxlYWYgbm9kZSBmb3IgdGhlIHBvaW50LlxuICAvLyBXaGlsZSBkZXNjZW5kaW5nLCBhbHNvIHJldGFpbiB0aGUgZGVlcGVzdCBwYXJlbnQgd2l0aCBhIG5vbi1yZW1vdmVkIHNpYmxpbmcuXG4gIGlmIChub2RlLmxlbmd0aCkgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAocmlnaHQgPSB4ID49ICh4bSA9ICh4MCArIHgxKSAvIDIpKSB4MCA9IHhtOyBlbHNlIHgxID0geG07XG4gICAgaWYgKGJvdHRvbSA9IHkgPj0gKHltID0gKHkwICsgeTEpIC8gMikpIHkwID0geW07IGVsc2UgeTEgPSB5bTtcbiAgICBpZiAoIShwYXJlbnQgPSBub2RlLCBub2RlID0gbm9kZVtpID0gYm90dG9tIDw8IDEgfCByaWdodF0pKSByZXR1cm4gdGhpcztcbiAgICBpZiAoIW5vZGUubGVuZ3RoKSBicmVhaztcbiAgICBpZiAocGFyZW50WyhpICsgMSkgJiAzXSB8fCBwYXJlbnRbKGkgKyAyKSAmIDNdIHx8IHBhcmVudFsoaSArIDMpICYgM10pIHJldGFpbmVyID0gcGFyZW50LCBqID0gaTtcbiAgfVxuXG4gIC8vIEZpbmQgdGhlIHBvaW50IHRvIHJlbW92ZS5cbiAgd2hpbGUgKG5vZGUuZGF0YSAhPT0gZCkgaWYgKCEocHJldmlvdXMgPSBub2RlLCBub2RlID0gbm9kZS5uZXh0KSkgcmV0dXJuIHRoaXM7XG4gIGlmIChuZXh0ID0gbm9kZS5uZXh0KSBkZWxldGUgbm9kZS5uZXh0O1xuXG4gIC8vIElmIHRoZXJlIGFyZSBtdWx0aXBsZSBjb2luY2lkZW50IHBvaW50cywgcmVtb3ZlIGp1c3QgdGhlIHBvaW50LlxuICBpZiAocHJldmlvdXMpIHJldHVybiAobmV4dCA/IHByZXZpb3VzLm5leHQgPSBuZXh0IDogZGVsZXRlIHByZXZpb3VzLm5leHQpLCB0aGlzO1xuXG4gIC8vIElmIHRoaXMgaXMgdGhlIHJvb3QgcG9pbnQsIHJlbW92ZSBpdC5cbiAgaWYgKCFwYXJlbnQpIHJldHVybiB0aGlzLl9yb290ID0gbmV4dCwgdGhpcztcblxuICAvLyBSZW1vdmUgdGhpcyBsZWFmLlxuICBuZXh0ID8gcGFyZW50W2ldID0gbmV4dCA6IGRlbGV0ZSBwYXJlbnRbaV07XG5cbiAgLy8gSWYgdGhlIHBhcmVudCBub3cgY29udGFpbnMgZXhhY3RseSBvbmUgbGVhZiwgY29sbGFwc2Ugc3VwZXJmbHVvdXMgcGFyZW50cy5cbiAgaWYgKChub2RlID0gcGFyZW50WzBdIHx8IHBhcmVudFsxXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzNdKVxuICAgICAgJiYgbm9kZSA9PT0gKHBhcmVudFszXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzFdIHx8IHBhcmVudFswXSlcbiAgICAgICYmICFub2RlLmxlbmd0aCkge1xuICAgIGlmIChyZXRhaW5lcikgcmV0YWluZXJbal0gPSBub2RlO1xuICAgIGVsc2UgdGhpcy5fcm9vdCA9IG5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFsbChkYXRhKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gZGF0YS5sZW5ndGg7IGkgPCBuOyArK2kpIHRoaXMucmVtb3ZlKGRhdGFbaV0pO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuX3Jvb3Q7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBzaXplID0gMDtcbiAgdGhpcy52aXNpdChmdW5jdGlvbihub2RlKSB7XG4gICAgaWYgKCFub2RlLmxlbmd0aCkgZG8gKytzaXplOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBzaXplO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIHEsIG5vZGUgPSB0aGlzLl9yb290LCBjaGlsZCwgeDAsIHkwLCB4MSwgeTE7XG4gIGlmIChub2RlKSBxdWFkcy5wdXNoKG5ldyBRdWFkKG5vZGUsIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSk7XG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcbiAgICBpZiAoIWNhbGxiYWNrKG5vZGUgPSBxLm5vZGUsIHgwID0gcS54MCwgeTAgPSBxLnkwLCB4MSA9IHEueDEsIHkxID0gcS55MSkgJiYgbm9kZS5sZW5ndGgpIHtcbiAgICAgIHZhciB4bSA9ICh4MCArIHgxKSAvIDIsIHltID0gKHkwICsgeTEpIC8gMjtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbM10pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5bSwgeDEsIHkxKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsxXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHkwLCB4MSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMF0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5MCwgeG0sIHltKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIG5leHQgPSBbXSwgcTtcbiAgaWYgKHRoaXMuX3Jvb3QpIHF1YWRzLnB1c2gobmV3IFF1YWQodGhpcy5fcm9vdCwgdGhpcy5feDAsIHRoaXMuX3kwLCB0aGlzLl94MSwgdGhpcy5feTEpKTtcbiAgd2hpbGUgKHEgPSBxdWFkcy5wb3AoKSkge1xuICAgIHZhciBub2RlID0gcS5ub2RlO1xuICAgIGlmIChub2RlLmxlbmd0aCkge1xuICAgICAgdmFyIGNoaWxkLCB4MCA9IHEueDAsIHkwID0gcS55MCwgeDEgPSBxLngxLCB5MSA9IHEueTEsIHhtID0gKHgwICsgeDEpIC8gMiwgeW0gPSAoeTAgKyB5MSkgLyAyO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVswXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHkwLCB4bSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMV0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5MCwgeDEsIHltKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVszXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHltLCB4MSwgeTEpKTtcbiAgICB9XG4gICAgbmV4dC5wdXNoKHEpO1xuICB9XG4gIHdoaWxlIChxID0gbmV4dC5wb3AoKSkge1xuICAgIGNhbGxiYWNrKHEubm9kZSwgcS54MCwgcS55MCwgcS54MSwgcS55MSk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRYKGQpIHtcbiAgcmV0dXJuIGRbMF07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhpcy5feCA9IF8sIHRoaXMpIDogdGhpcy5feDtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gZGVmYXVsdFkoZCkge1xuICByZXR1cm4gZFsxXTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oXykge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0aGlzLl95ID0gXywgdGhpcykgOiB0aGlzLl95O1xufVxuIiwgImltcG9ydCB0cmVlX2FkZCwge2FkZEFsbCBhcyB0cmVlX2FkZEFsbH0gZnJvbSBcIi4vYWRkLmpzXCI7XG5pbXBvcnQgdHJlZV9jb3ZlciBmcm9tIFwiLi9jb3Zlci5qc1wiO1xuaW1wb3J0IHRyZWVfZGF0YSBmcm9tIFwiLi9kYXRhLmpzXCI7XG5pbXBvcnQgdHJlZV9leHRlbnQgZnJvbSBcIi4vZXh0ZW50LmpzXCI7XG5pbXBvcnQgdHJlZV9maW5kIGZyb20gXCIuL2ZpbmQuanNcIjtcbmltcG9ydCB0cmVlX3JlbW92ZSwge3JlbW92ZUFsbCBhcyB0cmVlX3JlbW92ZUFsbH0gZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgdHJlZV9yb290IGZyb20gXCIuL3Jvb3QuanNcIjtcbmltcG9ydCB0cmVlX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHRyZWVfdmlzaXQgZnJvbSBcIi4vdmlzaXQuanNcIjtcbmltcG9ydCB0cmVlX3Zpc2l0QWZ0ZXIgZnJvbSBcIi4vdmlzaXRBZnRlci5qc1wiO1xuaW1wb3J0IHRyZWVfeCwge2RlZmF1bHRYfSBmcm9tIFwiLi94LmpzXCI7XG5pbXBvcnQgdHJlZV95LCB7ZGVmYXVsdFl9IGZyb20gXCIuL3kuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcXVhZHRyZWUobm9kZXMsIHgsIHkpIHtcbiAgdmFyIHRyZWUgPSBuZXcgUXVhZHRyZWUoeCA9PSBudWxsID8gZGVmYXVsdFggOiB4LCB5ID09IG51bGwgPyBkZWZhdWx0WSA6IHksIE5hTiwgTmFOLCBOYU4sIE5hTik7XG4gIHJldHVybiBub2RlcyA9PSBudWxsID8gdHJlZSA6IHRyZWUuYWRkQWxsKG5vZGVzKTtcbn1cblxuZnVuY3Rpb24gUXVhZHRyZWUoeCwgeSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5feCA9IHg7XG4gIHRoaXMuX3kgPSB5O1xuICB0aGlzLl94MCA9IHgwO1xuICB0aGlzLl95MCA9IHkwO1xuICB0aGlzLl94MSA9IHgxO1xuICB0aGlzLl95MSA9IHkxO1xuICB0aGlzLl9yb290ID0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBsZWFmX2NvcHkobGVhZikge1xuICB2YXIgY29weSA9IHtkYXRhOiBsZWFmLmRhdGF9LCBuZXh0ID0gY29weTtcbiAgd2hpbGUgKGxlYWYgPSBsZWFmLm5leHQpIG5leHQgPSBuZXh0Lm5leHQgPSB7ZGF0YTogbGVhZi5kYXRhfTtcbiAgcmV0dXJuIGNvcHk7XG59XG5cbnZhciB0cmVlUHJvdG8gPSBxdWFkdHJlZS5wcm90b3R5cGUgPSBRdWFkdHJlZS5wcm90b3R5cGU7XG5cbnRyZWVQcm90by5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFF1YWR0cmVlKHRoaXMuX3gsIHRoaXMuX3ksIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgbm9kZXMsXG4gICAgICBjaGlsZDtcblxuICBpZiAoIW5vZGUpIHJldHVybiBjb3B5O1xuXG4gIGlmICghbm9kZS5sZW5ndGgpIHJldHVybiBjb3B5Ll9yb290ID0gbGVhZl9jb3B5KG5vZGUpLCBjb3B5O1xuXG4gIG5vZGVzID0gW3tzb3VyY2U6IG5vZGUsIHRhcmdldDogY29weS5fcm9vdCA9IG5ldyBBcnJheSg0KX1dO1xuICB3aGlsZSAobm9kZSA9IG5vZGVzLnBvcCgpKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGUuc291cmNlW2ldKSB7XG4gICAgICAgIGlmIChjaGlsZC5sZW5ndGgpIG5vZGVzLnB1c2goe3NvdXJjZTogY2hpbGQsIHRhcmdldDogbm9kZS50YXJnZXRbaV0gPSBuZXcgQXJyYXkoNCl9KTtcbiAgICAgICAgZWxzZSBub2RlLnRhcmdldFtpXSA9IGxlYWZfY29weShjaGlsZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG50cmVlUHJvdG8uYWRkID0gdHJlZV9hZGQ7XG50cmVlUHJvdG8uYWRkQWxsID0gdHJlZV9hZGRBbGw7XG50cmVlUHJvdG8uY292ZXIgPSB0cmVlX2NvdmVyO1xudHJlZVByb3RvLmRhdGEgPSB0cmVlX2RhdGE7XG50cmVlUHJvdG8uZXh0ZW50ID0gdHJlZV9leHRlbnQ7XG50cmVlUHJvdG8uZmluZCA9IHRyZWVfZmluZDtcbnRyZWVQcm90by5yZW1vdmUgPSB0cmVlX3JlbW92ZTtcbnRyZWVQcm90by5yZW1vdmVBbGwgPSB0cmVlX3JlbW92ZUFsbDtcbnRyZWVQcm90by5yb290ID0gdHJlZV9yb290O1xudHJlZVByb3RvLnNpemUgPSB0cmVlX3NpemU7XG50cmVlUHJvdG8udmlzaXQgPSB0cmVlX3Zpc2l0O1xudHJlZVByb3RvLnZpc2l0QWZ0ZXIgPSB0cmVlX3Zpc2l0QWZ0ZXI7XG50cmVlUHJvdG8ueCA9IHRyZWVfeDtcbnRyZWVQcm90by55ID0gdHJlZV95O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB4O1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHJhbmRvbSkge1xuICByZXR1cm4gKHJhbmRvbSgpIC0gMC41KSAqIDFlLTY7XG59XG4iLCAiaW1wb3J0IHtxdWFkdHJlZX0gZnJvbSBcImQzLXF1YWR0cmVlXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBqaWdnbGUgZnJvbSBcIi4vamlnZ2xlLmpzXCI7XG5cbmZ1bmN0aW9uIHgoZCkge1xuICByZXR1cm4gZC54ICsgZC52eDtcbn1cblxuZnVuY3Rpb24geShkKSB7XG4gIHJldHVybiBkLnkgKyBkLnZ5O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihyYWRpdXMpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgcmFkaWksXG4gICAgICByYW5kb20sXG4gICAgICBzdHJlbmd0aCA9IDEsXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAodHlwZW9mIHJhZGl1cyAhPT0gXCJmdW5jdGlvblwiKSByYWRpdXMgPSBjb25zdGFudChyYWRpdXMgPT0gbnVsbCA/IDEgOiArcmFkaXVzKTtcblxuICBmdW5jdGlvbiBmb3JjZSgpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgdHJlZSxcbiAgICAgICAgbm9kZSxcbiAgICAgICAgeGksXG4gICAgICAgIHlpLFxuICAgICAgICByaSxcbiAgICAgICAgcmkyO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihwcmVwYXJlKTtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICByaSA9IHJhZGlpW25vZGUuaW5kZXhdLCByaTIgPSByaSAqIHJpO1xuICAgICAgICB4aSA9IG5vZGUueCArIG5vZGUudng7XG4gICAgICAgIHlpID0gbm9kZS55ICsgbm9kZS52eTtcbiAgICAgICAgdHJlZS52aXNpdChhcHBseSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgICAgIHZhciBkYXRhID0gcXVhZC5kYXRhLCByaiA9IHF1YWQuciwgciA9IHJpICsgcmo7XG4gICAgICBpZiAoZGF0YSkge1xuICAgICAgICBpZiAoZGF0YS5pbmRleCA+IG5vZGUuaW5kZXgpIHtcbiAgICAgICAgICB2YXIgeCA9IHhpIC0gZGF0YS54IC0gZGF0YS52eCxcbiAgICAgICAgICAgICAgeSA9IHlpIC0gZGF0YS55IC0gZGF0YS52eSxcbiAgICAgICAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG4gICAgICAgICAgaWYgKGwgPCByICogcikge1xuICAgICAgICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgICAgICBsID0gKHIgLSAobCA9IE1hdGguc3FydChsKSkpIC8gbCAqIHN0cmVuZ3RoO1xuICAgICAgICAgICAgbm9kZS52eCArPSAoeCAqPSBsKSAqIChyID0gKHJqICo9IHJqKSAvIChyaTIgKyByaikpO1xuICAgICAgICAgICAgbm9kZS52eSArPSAoeSAqPSBsKSAqIHI7XG4gICAgICAgICAgICBkYXRhLnZ4IC09IHggKiAociA9IDEgLSByKTtcbiAgICAgICAgICAgIGRhdGEudnkgLT0geSAqIHI7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB4MCA+IHhpICsgciB8fCB4MSA8IHhpIC0gciB8fCB5MCA+IHlpICsgciB8fCB5MSA8IHlpIC0gcjtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBwcmVwYXJlKHF1YWQpIHtcbiAgICBpZiAocXVhZC5kYXRhKSByZXR1cm4gcXVhZC5yID0gcmFkaWlbcXVhZC5kYXRhLmluZGV4XTtcbiAgICBmb3IgKHZhciBpID0gcXVhZC5yID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgaWYgKHF1YWRbaV0gJiYgcXVhZFtpXS5yID4gcXVhZC5yKSB7XG4gICAgICAgIHF1YWQuciA9IHF1YWRbaV0ucjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICByYWRpaSA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHJhZGlpW25vZGUuaW5kZXhdID0gK3JhZGl1cyhub2RlLCBpLCBub2Rlcyk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSArXywgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UucmFkaXVzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHJhZGl1cyA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHJhZGl1cztcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuXG5mdW5jdGlvbiBpbmRleChkKSB7XG4gIHJldHVybiBkLmluZGV4O1xufVxuXG5mdW5jdGlvbiBmaW5kKG5vZGVCeUlkLCBub2RlSWQpIHtcbiAgdmFyIG5vZGUgPSBub2RlQnlJZC5nZXQobm9kZUlkKTtcbiAgaWYgKCFub2RlKSB0aHJvdyBuZXcgRXJyb3IoXCJub2RlIG5vdCBmb3VuZDogXCIgKyBub2RlSWQpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obGlua3MpIHtcbiAgdmFyIGlkID0gaW5kZXgsXG4gICAgICBzdHJlbmd0aCA9IGRlZmF1bHRTdHJlbmd0aCxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIGRpc3RhbmNlID0gY29uc3RhbnQoMzApLFxuICAgICAgZGlzdGFuY2VzLFxuICAgICAgbm9kZXMsXG4gICAgICBjb3VudCxcbiAgICAgIGJpYXMsXG4gICAgICByYW5kb20sXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAobGlua3MgPT0gbnVsbCkgbGlua3MgPSBbXTtcblxuICBmdW5jdGlvbiBkZWZhdWx0U3RyZW5ndGgobGluaykge1xuICAgIHJldHVybiAxIC8gTWF0aC5taW4oY291bnRbbGluay5zb3VyY2UuaW5kZXhdLCBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZm9yY2UoYWxwaGEpIHtcbiAgICBmb3IgKHZhciBrID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGxpbmssIHNvdXJjZSwgdGFyZ2V0LCB4LCB5LCBsLCBiOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGxpbmsgPSBsaW5rc1tpXSwgc291cmNlID0gbGluay5zb3VyY2UsIHRhcmdldCA9IGxpbmsudGFyZ2V0O1xuICAgICAgICB4ID0gdGFyZ2V0LnggKyB0YXJnZXQudnggLSBzb3VyY2UueCAtIHNvdXJjZS52eCB8fCBqaWdnbGUocmFuZG9tKTtcbiAgICAgICAgeSA9IHRhcmdldC55ICsgdGFyZ2V0LnZ5IC0gc291cmNlLnkgLSBzb3VyY2UudnkgfHwgamlnZ2xlKHJhbmRvbSk7XG4gICAgICAgIGwgPSBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XG4gICAgICAgIGwgPSAobCAtIGRpc3RhbmNlc1tpXSkgLyBsICogYWxwaGEgKiBzdHJlbmd0aHNbaV07XG4gICAgICAgIHggKj0gbCwgeSAqPSBsO1xuICAgICAgICB0YXJnZXQudnggLT0geCAqIChiID0gYmlhc1tpXSk7XG4gICAgICAgIHRhcmdldC52eSAtPSB5ICogYjtcbiAgICAgICAgc291cmNlLnZ4ICs9IHggKiAoYiA9IDEgLSBiKTtcbiAgICAgICAgc291cmNlLnZ5ICs9IHkgKiBiO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuXG4gICAgdmFyIGksXG4gICAgICAgIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgIG0gPSBsaW5rcy5sZW5ndGgsXG4gICAgICAgIG5vZGVCeUlkID0gbmV3IE1hcChub2Rlcy5tYXAoKGQsIGkpID0+IFtpZChkLCBpLCBub2RlcyksIGRdKSksXG4gICAgICAgIGxpbms7XG5cbiAgICBmb3IgKGkgPSAwLCBjb3VudCA9IG5ldyBBcnJheShuKTsgaSA8IG07ICsraSkge1xuICAgICAgbGluayA9IGxpbmtzW2ldLCBsaW5rLmluZGV4ID0gaTtcbiAgICAgIGlmICh0eXBlb2YgbGluay5zb3VyY2UgIT09IFwib2JqZWN0XCIpIGxpbmsuc291cmNlID0gZmluZChub2RlQnlJZCwgbGluay5zb3VyY2UpO1xuICAgICAgaWYgKHR5cGVvZiBsaW5rLnRhcmdldCAhPT0gXCJvYmplY3RcIikgbGluay50YXJnZXQgPSBmaW5kKG5vZGVCeUlkLCBsaW5rLnRhcmdldCk7XG4gICAgICBjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gPSAoY291bnRbbGluay5zb3VyY2UuaW5kZXhdIHx8IDApICsgMTtcbiAgICAgIGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSA9IChjb3VudFtsaW5rLnRhcmdldC5pbmRleF0gfHwgMCkgKyAxO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDAsIGJpYXMgPSBuZXcgQXJyYXkobSk7IGkgPCBtOyArK2kpIHtcbiAgICAgIGxpbmsgPSBsaW5rc1tpXSwgYmlhc1tpXSA9IGNvdW50W2xpbmsuc291cmNlLmluZGV4XSAvIChjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gKyBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICAgIH1cblxuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShtKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCk7XG4gICAgZGlzdGFuY2VzID0gbmV3IEFycmF5KG0pLCBpbml0aWFsaXplRGlzdGFuY2UoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVTdHJlbmd0aCgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgc3RyZW5ndGhzW2ldID0gK3N0cmVuZ3RoKGxpbmtzW2ldLCBpLCBsaW5rcyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZURpc3RhbmNlKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlua3MubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSArZGlzdGFuY2UobGlua3NbaV0sIGksIGxpbmtzKTtcbiAgICB9XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UubGlua3MgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAobGlua3MgPSBfLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IGxpbmtzO1xuICB9O1xuXG4gIGZvcmNlLmlkID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGlkID0gXywgZm9yY2UpIDogaWQ7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemVEaXN0YW5jZSgpLCBmb3JjZSkgOiBkaXN0YW5jZTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAidmFyIG5vb3AgPSB7dmFsdWU6ICgpID0+IHt9fTtcblxuZnVuY3Rpb24gZGlzcGF0Y2goKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gYXJndW1lbnRzLmxlbmd0aCwgXyA9IHt9LCB0OyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKCEodCA9IGFyZ3VtZW50c1tpXSArIFwiXCIpIHx8ICh0IGluIF8pIHx8IC9bXFxzLl0vLnRlc3QodCkpIHRocm93IG5ldyBFcnJvcihcImlsbGVnYWwgdHlwZTogXCIgKyB0KTtcbiAgICBfW3RdID0gW107XG4gIH1cbiAgcmV0dXJuIG5ldyBEaXNwYXRjaChfKTtcbn1cblxuZnVuY3Rpb24gRGlzcGF0Y2goXykge1xuICB0aGlzLl8gPSBfO1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMsIHR5cGVzKSB7XG4gIHJldHVybiB0eXBlbmFtZXMudHJpbSgpLnNwbGl0KC9efFxccysvKS5tYXAoZnVuY3Rpb24odCkge1xuICAgIHZhciBuYW1lID0gXCJcIiwgaSA9IHQuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGkgPj0gMCkgbmFtZSA9IHQuc2xpY2UoaSArIDEpLCB0ID0gdC5zbGljZSgwLCBpKTtcbiAgICBpZiAodCAmJiAhdHlwZXMuaGFzT3duUHJvcGVydHkodCkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0KTtcbiAgICByZXR1cm4ge3R5cGU6IHQsIG5hbWU6IG5hbWV9O1xuICB9KTtcbn1cblxuRGlzcGF0Y2gucHJvdG90eXBlID0gZGlzcGF0Y2gucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogRGlzcGF0Y2gsXG4gIG9uOiBmdW5jdGlvbih0eXBlbmFtZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgXyA9IHRoaXMuXyxcbiAgICAgICAgVCA9IHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lICsgXCJcIiwgXyksXG4gICAgICAgIHQsXG4gICAgICAgIGkgPSAtMSxcbiAgICAgICAgbiA9IFQubGVuZ3RoO1xuXG4gICAgLy8gSWYgbm8gY2FsbGJhY2sgd2FzIHNwZWNpZmllZCwgcmV0dXJuIHRoZSBjYWxsYmFjayBvZiB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSAmJiAodCA9IGdldChfW3RdLCB0eXBlbmFtZS5uYW1lKSkpIHJldHVybiB0O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIGEgdHlwZSB3YXMgc3BlY2lmaWVkLCBzZXQgdGhlIGNhbGxiYWNrIGZvciB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICAvLyBPdGhlcndpc2UsIGlmIGEgbnVsbCBjYWxsYmFjayB3YXMgc3BlY2lmaWVkLCByZW1vdmUgY2FsbGJhY2tzIG9mIHRoZSBnaXZlbiBuYW1lLlxuICAgIGlmIChjYWxsYmFjayAhPSBudWxsICYmIHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIGNhbGxiYWNrOiBcIiArIGNhbGxiYWNrKTtcbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgaWYgKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIGNhbGxiYWNrKTtcbiAgICAgIGVsc2UgaWYgKGNhbGxiYWNrID09IG51bGwpIGZvciAodCBpbiBfKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIG51bGwpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9LFxuICBjb3B5OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY29weSA9IHt9LCBfID0gdGhpcy5fO1xuICAgIGZvciAodmFyIHQgaW4gXykgY29weVt0XSA9IF9bdF0uc2xpY2UoKTtcbiAgICByZXR1cm4gbmV3IERpc3BhdGNoKGNvcHkpO1xuICB9LFxuICBjYWxsOiBmdW5jdGlvbih0eXBlLCB0aGF0KSB7XG4gICAgaWYgKChuID0gYXJndW1lbnRzLmxlbmd0aCAtIDIpID4gMCkgZm9yICh2YXIgYXJncyA9IG5ldyBBcnJheShuKSwgaSA9IDAsIG4sIHQ7IGkgPCBuOyArK2kpIGFyZ3NbaV0gPSBhcmd1bWVudHNbaSArIDJdO1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh0ID0gdGhpcy5fW3R5cGVdLCBpID0gMCwgbiA9IHQubGVuZ3RoOyBpIDwgbjsgKytpKSB0W2ldLnZhbHVlLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9LFxuICBhcHBseTogZnVuY3Rpb24odHlwZSwgdGhhdCwgYXJncykge1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh2YXIgdCA9IHRoaXMuX1t0eXBlXSwgaSA9IDAsIG4gPSB0Lmxlbmd0aDsgaSA8IG47ICsraSkgdFtpXS52YWx1ZS5hcHBseSh0aGF0LCBhcmdzKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gZ2V0KHR5cGUsIG5hbWUpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aCwgYzsgaSA8IG47ICsraSkge1xuICAgIGlmICgoYyA9IHR5cGVbaV0pLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHJldHVybiBjLnZhbHVlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBzZXQodHlwZSwgbmFtZSwgY2FsbGJhY2spIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgIGlmICh0eXBlW2ldLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHR5cGVbaV0gPSBub29wLCB0eXBlID0gdHlwZS5zbGljZSgwLCBpKS5jb25jYXQodHlwZS5zbGljZShpICsgMSkpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChjYWxsYmFjayAhPSBudWxsKSB0eXBlLnB1c2goe25hbWU6IG5hbWUsIHZhbHVlOiBjYWxsYmFja30pO1xuICByZXR1cm4gdHlwZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGlzcGF0Y2g7XG4iLCAidmFyIGZyYW1lID0gMCwgLy8gaXMgYW4gYW5pbWF0aW9uIGZyYW1lIHBlbmRpbmc/XG4gICAgdGltZW91dCA9IDAsIC8vIGlzIGEgdGltZW91dCBwZW5kaW5nP1xuICAgIGludGVydmFsID0gMCwgLy8gYXJlIGFueSB0aW1lcnMgYWN0aXZlP1xuICAgIHBva2VEZWxheSA9IDEwMDAsIC8vIGhvdyBmcmVxdWVudGx5IHdlIGNoZWNrIGZvciBjbG9jayBza2V3XG4gICAgdGFza0hlYWQsXG4gICAgdGFza1RhaWwsXG4gICAgY2xvY2tMYXN0ID0gMCxcbiAgICBjbG9ja05vdyA9IDAsXG4gICAgY2xvY2tTa2V3ID0gMCxcbiAgICBjbG9jayA9IHR5cGVvZiBwZXJmb3JtYW5jZSA9PT0gXCJvYmplY3RcIiAmJiBwZXJmb3JtYW5jZS5ub3cgPyBwZXJmb3JtYW5jZSA6IERhdGUsXG4gICAgc2V0RnJhbWUgPSB0eXBlb2Ygd2luZG93ID09PSBcIm9iamVjdFwiICYmIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPyB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lLmJpbmQod2luZG93KSA6IGZ1bmN0aW9uKGYpIHsgc2V0VGltZW91dChmLCAxNyk7IH07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3coKSB7XG4gIHJldHVybiBjbG9ja05vdyB8fCAoc2V0RnJhbWUoY2xlYXJOb3cpLCBjbG9ja05vdyA9IGNsb2NrLm5vdygpICsgY2xvY2tTa2V3KTtcbn1cblxuZnVuY3Rpb24gY2xlYXJOb3coKSB7XG4gIGNsb2NrTm93ID0gMDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIFRpbWVyKCkge1xuICB0aGlzLl9jYWxsID1cbiAgdGhpcy5fdGltZSA9XG4gIHRoaXMuX25leHQgPSBudWxsO1xufVxuXG5UaW1lci5wcm90b3R5cGUgPSB0aW1lci5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBUaW1lcixcbiAgcmVzdGFydDogZnVuY3Rpb24oY2FsbGJhY2ssIGRlbGF5LCB0aW1lKSB7XG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiY2FsbGJhY2sgaXMgbm90IGEgZnVuY3Rpb25cIik7XG4gICAgdGltZSA9ICh0aW1lID09IG51bGwgPyBub3coKSA6ICt0aW1lKSArIChkZWxheSA9PSBudWxsID8gMCA6ICtkZWxheSk7XG4gICAgaWYgKCF0aGlzLl9uZXh0ICYmIHRhc2tUYWlsICE9PSB0aGlzKSB7XG4gICAgICBpZiAodGFza1RhaWwpIHRhc2tUYWlsLl9uZXh0ID0gdGhpcztcbiAgICAgIGVsc2UgdGFza0hlYWQgPSB0aGlzO1xuICAgICAgdGFza1RhaWwgPSB0aGlzO1xuICAgIH1cbiAgICB0aGlzLl9jYWxsID0gY2FsbGJhY2s7XG4gICAgdGhpcy5fdGltZSA9IHRpbWU7XG4gICAgc2xlZXAoKTtcbiAgfSxcbiAgc3RvcDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX2NhbGwpIHtcbiAgICAgIHRoaXMuX2NhbGwgPSBudWxsO1xuICAgICAgdGhpcy5fdGltZSA9IEluZmluaXR5O1xuICAgICAgc2xlZXAoKTtcbiAgICB9XG4gIH1cbn07XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lcihjYWxsYmFjaywgZGVsYXksIHRpbWUpIHtcbiAgdmFyIHQgPSBuZXcgVGltZXI7XG4gIHQucmVzdGFydChjYWxsYmFjaywgZGVsYXksIHRpbWUpO1xuICByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVyRmx1c2goKSB7XG4gIG5vdygpOyAvLyBHZXQgdGhlIGN1cnJlbnQgdGltZSwgaWYgbm90IGFscmVhZHkgc2V0LlxuICArK2ZyYW1lOyAvLyBQcmV0ZW5kIHdlXHUyMDE5dmUgc2V0IGFuIGFsYXJtLCBpZiB3ZSBoYXZlblx1MjAxOXQgYWxyZWFkeS5cbiAgdmFyIHQgPSB0YXNrSGVhZCwgZTtcbiAgd2hpbGUgKHQpIHtcbiAgICBpZiAoKGUgPSBjbG9ja05vdyAtIHQuX3RpbWUpID49IDApIHQuX2NhbGwuY2FsbCh1bmRlZmluZWQsIGUpO1xuICAgIHQgPSB0Ll9uZXh0O1xuICB9XG4gIC0tZnJhbWU7XG59XG5cbmZ1bmN0aW9uIHdha2UoKSB7XG4gIGNsb2NrTm93ID0gKGNsb2NrTGFzdCA9IGNsb2NrLm5vdygpKSArIGNsb2NrU2tldztcbiAgZnJhbWUgPSB0aW1lb3V0ID0gMDtcbiAgdHJ5IHtcbiAgICB0aW1lckZsdXNoKCk7XG4gIH0gZmluYWxseSB7XG4gICAgZnJhbWUgPSAwO1xuICAgIG5hcCgpO1xuICAgIGNsb2NrTm93ID0gMDtcbiAgfVxufVxuXG5mdW5jdGlvbiBwb2tlKCkge1xuICB2YXIgbm93ID0gY2xvY2subm93KCksIGRlbGF5ID0gbm93IC0gY2xvY2tMYXN0O1xuICBpZiAoZGVsYXkgPiBwb2tlRGVsYXkpIGNsb2NrU2tldyAtPSBkZWxheSwgY2xvY2tMYXN0ID0gbm93O1xufVxuXG5mdW5jdGlvbiBuYXAoKSB7XG4gIHZhciB0MCwgdDEgPSB0YXNrSGVhZCwgdDIsIHRpbWUgPSBJbmZpbml0eTtcbiAgd2hpbGUgKHQxKSB7XG4gICAgaWYgKHQxLl9jYWxsKSB7XG4gICAgICBpZiAodGltZSA+IHQxLl90aW1lKSB0aW1lID0gdDEuX3RpbWU7XG4gICAgICB0MCA9IHQxLCB0MSA9IHQxLl9uZXh0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0MiA9IHQxLl9uZXh0LCB0MS5fbmV4dCA9IG51bGw7XG4gICAgICB0MSA9IHQwID8gdDAuX25leHQgPSB0MiA6IHRhc2tIZWFkID0gdDI7XG4gICAgfVxuICB9XG4gIHRhc2tUYWlsID0gdDA7XG4gIHNsZWVwKHRpbWUpO1xufVxuXG5mdW5jdGlvbiBzbGVlcCh0aW1lKSB7XG4gIGlmIChmcmFtZSkgcmV0dXJuOyAvLyBTb29uZXN0IGFsYXJtIGFscmVhZHkgc2V0LCBvciB3aWxsIGJlLlxuICBpZiAodGltZW91dCkgdGltZW91dCA9IGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgdmFyIGRlbGF5ID0gdGltZSAtIGNsb2NrTm93OyAvLyBTdHJpY3RseSBsZXNzIHRoYW4gaWYgd2UgcmVjb21wdXRlZCBjbG9ja05vdy5cbiAgaWYgKGRlbGF5ID4gMjQpIHtcbiAgICBpZiAodGltZSA8IEluZmluaXR5KSB0aW1lb3V0ID0gc2V0VGltZW91dCh3YWtlLCB0aW1lIC0gY2xvY2subm93KCkgLSBjbG9ja1NrZXcpO1xuICAgIGlmIChpbnRlcnZhbCkgaW50ZXJ2YWwgPSBjbGVhckludGVydmFsKGludGVydmFsKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIWludGVydmFsKSBjbG9ja0xhc3QgPSBjbG9jay5ub3coKSwgaW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChwb2tlLCBwb2tlRGVsYXkpO1xuICAgIGZyYW1lID0gMSwgc2V0RnJhbWUod2FrZSk7XG4gIH1cbn1cbiIsICIvLyBodHRwczovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaW5lYXJfY29uZ3J1ZW50aWFsX2dlbmVyYXRvciNQYXJhbWV0ZXJzX2luX2NvbW1vbl91c2VcbmNvbnN0IGEgPSAxNjY0NTI1O1xuY29uc3QgYyA9IDEwMTM5MDQyMjM7XG5jb25zdCBtID0gNDI5NDk2NzI5NjsgLy8gMl4zMlxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgbGV0IHMgPSAxO1xuICByZXR1cm4gKCkgPT4gKHMgPSAoYSAqIHMgKyBjKSAlIG0pIC8gbTtcbn1cbiIsICJpbXBvcnQge2Rpc3BhdGNofSBmcm9tIFwiZDMtZGlzcGF0Y2hcIjtcbmltcG9ydCB7dGltZXJ9IGZyb20gXCJkMy10aW1lclwiO1xuaW1wb3J0IGxjZyBmcm9tIFwiLi9sY2cuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHgoZCkge1xuICByZXR1cm4gZC54O1xufVxuXG5leHBvcnQgZnVuY3Rpb24geShkKSB7XG4gIHJldHVybiBkLnk7XG59XG5cbnZhciBpbml0aWFsUmFkaXVzID0gMTAsXG4gICAgaW5pdGlhbEFuZ2xlID0gTWF0aC5QSSAqICgzIC0gTWF0aC5zcXJ0KDUpKTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZXMpIHtcbiAgdmFyIHNpbXVsYXRpb24sXG4gICAgICBhbHBoYSA9IDEsXG4gICAgICBhbHBoYU1pbiA9IDAuMDAxLFxuICAgICAgYWxwaGFEZWNheSA9IDEgLSBNYXRoLnBvdyhhbHBoYU1pbiwgMSAvIDMwMCksXG4gICAgICBhbHBoYVRhcmdldCA9IDAsXG4gICAgICB2ZWxvY2l0eURlY2F5ID0gMC42LFxuICAgICAgZm9yY2VzID0gbmV3IE1hcCgpLFxuICAgICAgc3RlcHBlciA9IHRpbWVyKHN0ZXApLFxuICAgICAgZXZlbnQgPSBkaXNwYXRjaChcInRpY2tcIiwgXCJlbmRcIiksXG4gICAgICByYW5kb20gPSBsY2coKTtcblxuICBpZiAobm9kZXMgPT0gbnVsbCkgbm9kZXMgPSBbXTtcblxuICBmdW5jdGlvbiBzdGVwKCkge1xuICAgIHRpY2soKTtcbiAgICBldmVudC5jYWxsKFwidGlja1wiLCBzaW11bGF0aW9uKTtcbiAgICBpZiAoYWxwaGEgPCBhbHBoYU1pbikge1xuICAgICAgc3RlcHBlci5zdG9wKCk7XG4gICAgICBldmVudC5jYWxsKFwiZW5kXCIsIHNpbXVsYXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRpY2soaXRlcmF0aW9ucykge1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlO1xuXG4gICAgaWYgKGl0ZXJhdGlvbnMgPT09IHVuZGVmaW5lZCkgaXRlcmF0aW9ucyA9IDE7XG5cbiAgICBmb3IgKHZhciBrID0gMDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgYWxwaGEgKz0gKGFscGhhVGFyZ2V0IC0gYWxwaGEpICogYWxwaGFEZWNheTtcblxuICAgICAgZm9yY2VzLmZvckVhY2goZnVuY3Rpb24oZm9yY2UpIHtcbiAgICAgICAgZm9yY2UoYWxwaGEpO1xuICAgICAgfSk7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBpZiAobm9kZS5meCA9PSBudWxsKSBub2RlLnggKz0gbm9kZS52eCAqPSB2ZWxvY2l0eURlY2F5O1xuICAgICAgICBlbHNlIG5vZGUueCA9IG5vZGUuZngsIG5vZGUudnggPSAwO1xuICAgICAgICBpZiAobm9kZS5meSA9PSBudWxsKSBub2RlLnkgKz0gbm9kZS52eSAqPSB2ZWxvY2l0eURlY2F5O1xuICAgICAgICBlbHNlIG5vZGUueSA9IG5vZGUuZnksIG5vZGUudnkgPSAwO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzaW11bGF0aW9uO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZU5vZGVzKCkge1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBub2RlID0gbm9kZXNbaV0sIG5vZGUuaW5kZXggPSBpO1xuICAgICAgaWYgKG5vZGUuZnggIT0gbnVsbCkgbm9kZS54ID0gbm9kZS5meDtcbiAgICAgIGlmIChub2RlLmZ5ICE9IG51bGwpIG5vZGUueSA9IG5vZGUuZnk7XG4gICAgICBpZiAoaXNOYU4obm9kZS54KSB8fCBpc05hTihub2RlLnkpKSB7XG4gICAgICAgIHZhciByYWRpdXMgPSBpbml0aWFsUmFkaXVzICogTWF0aC5zcXJ0KDAuNSArIGkpLCBhbmdsZSA9IGkgKiBpbml0aWFsQW5nbGU7XG4gICAgICAgIG5vZGUueCA9IHJhZGl1cyAqIE1hdGguY29zKGFuZ2xlKTtcbiAgICAgICAgbm9kZS55ID0gcmFkaXVzICogTWF0aC5zaW4oYW5nbGUpO1xuICAgICAgfVxuICAgICAgaWYgKGlzTmFOKG5vZGUudngpIHx8IGlzTmFOKG5vZGUudnkpKSB7XG4gICAgICAgIG5vZGUudnggPSBub2RlLnZ5ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplRm9yY2UoZm9yY2UpIHtcbiAgICBpZiAoZm9yY2UuaW5pdGlhbGl6ZSkgZm9yY2UuaW5pdGlhbGl6ZShub2RlcywgcmFuZG9tKTtcbiAgICByZXR1cm4gZm9yY2U7XG4gIH1cblxuICBpbml0aWFsaXplTm9kZXMoKTtcblxuICByZXR1cm4gc2ltdWxhdGlvbiA9IHtcbiAgICB0aWNrOiB0aWNrLFxuXG4gICAgcmVzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gc3RlcHBlci5yZXN0YXJ0KHN0ZXApLCBzaW11bGF0aW9uO1xuICAgIH0sXG5cbiAgICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBzdGVwcGVyLnN0b3AoKSwgc2ltdWxhdGlvbjtcbiAgICB9LFxuXG4gICAgbm9kZXM6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKG5vZGVzID0gXywgaW5pdGlhbGl6ZU5vZGVzKCksIGZvcmNlcy5mb3JFYWNoKGluaXRpYWxpemVGb3JjZSksIHNpbXVsYXRpb24pIDogbm9kZXM7XG4gICAgfSxcblxuICAgIGFscGhhOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChhbHBoYSA9ICtfLCBzaW11bGF0aW9uKSA6IGFscGhhO1xuICAgIH0sXG5cbiAgICBhbHBoYU1pbjogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGFNaW4gPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYU1pbjtcbiAgICB9LFxuXG4gICAgYWxwaGFEZWNheTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGFEZWNheSA9ICtfLCBzaW11bGF0aW9uKSA6ICthbHBoYURlY2F5O1xuICAgIH0sXG5cbiAgICBhbHBoYVRhcmdldDogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGFUYXJnZXQgPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYVRhcmdldDtcbiAgICB9LFxuXG4gICAgdmVsb2NpdHlEZWNheTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodmVsb2NpdHlEZWNheSA9IDEgLSBfLCBzaW11bGF0aW9uKSA6IDEgLSB2ZWxvY2l0eURlY2F5O1xuICAgIH0sXG5cbiAgICByYW5kb21Tb3VyY2U6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHJhbmRvbSA9IF8sIGZvcmNlcy5mb3JFYWNoKGluaXRpYWxpemVGb3JjZSksIHNpbXVsYXRpb24pIDogcmFuZG9tO1xuICAgIH0sXG5cbiAgICBmb3JjZTogZnVuY3Rpb24obmFtZSwgXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gKChfID09IG51bGwgPyBmb3JjZXMuZGVsZXRlKG5hbWUpIDogZm9yY2VzLnNldChuYW1lLCBpbml0aWFsaXplRm9yY2UoXykpKSwgc2ltdWxhdGlvbikgOiBmb3JjZXMuZ2V0KG5hbWUpO1xuICAgIH0sXG5cbiAgICBmaW5kOiBmdW5jdGlvbih4LCB5LCByYWRpdXMpIHtcbiAgICAgIHZhciBpID0gMCxcbiAgICAgICAgICBuID0gbm9kZXMubGVuZ3RoLFxuICAgICAgICAgIGR4LFxuICAgICAgICAgIGR5LFxuICAgICAgICAgIGQyLFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgY2xvc2VzdDtcblxuICAgICAgaWYgKHJhZGl1cyA9PSBudWxsKSByYWRpdXMgPSBJbmZpbml0eTtcbiAgICAgIGVsc2UgcmFkaXVzICo9IHJhZGl1cztcblxuICAgICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgICBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGR4ID0geCAtIG5vZGUueDtcbiAgICAgICAgZHkgPSB5IC0gbm9kZS55O1xuICAgICAgICBkMiA9IGR4ICogZHggKyBkeSAqIGR5O1xuICAgICAgICBpZiAoZDIgPCByYWRpdXMpIGNsb3Nlc3QgPSBub2RlLCByYWRpdXMgPSBkMjtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNsb3Nlc3Q7XG4gICAgfSxcblxuICAgIG9uOiBmdW5jdGlvbihuYW1lLCBfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDEgPyAoZXZlbnQub24obmFtZSwgXyksIHNpbXVsYXRpb24pIDogZXZlbnQub24obmFtZSk7XG4gICAgfVxuICB9O1xufVxuIiwgImltcG9ydCB7cXVhZHRyZWV9IGZyb20gXCJkMy1xdWFkdHJlZVwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuaW1wb3J0IHt4LCB5fSBmcm9tIFwiLi9zaW11bGF0aW9uLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgbm9kZXMsXG4gICAgICBub2RlLFxuICAgICAgcmFuZG9tLFxuICAgICAgYWxwaGEsXG4gICAgICBzdHJlbmd0aCA9IGNvbnN0YW50KC0zMCksXG4gICAgICBzdHJlbmd0aHMsXG4gICAgICBkaXN0YW5jZU1pbjIgPSAxLFxuICAgICAgZGlzdGFuY2VNYXgyID0gSW5maW5pdHksXG4gICAgICB0aGV0YTIgPSAwLjgxO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKF8pIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgdHJlZSA9IHF1YWR0cmVlKG5vZGVzLCB4LCB5KS52aXNpdEFmdGVyKGFjY3VtdWxhdGUpO1xuICAgIGZvciAoYWxwaGEgPSBfLCBpID0gMDsgaSA8IG47ICsraSkgbm9kZSA9IG5vZGVzW2ldLCB0cmVlLnZpc2l0KGFwcGx5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlO1xuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHN0cmVuZ3Roc1tub2RlLmluZGV4XSA9ICtzdHJlbmd0aChub2RlLCBpLCBub2Rlcyk7XG4gIH1cblxuICBmdW5jdGlvbiBhY2N1bXVsYXRlKHF1YWQpIHtcbiAgICB2YXIgc3RyZW5ndGggPSAwLCBxLCBjLCB3ZWlnaHQgPSAwLCB4LCB5LCBpO1xuXG4gICAgLy8gRm9yIGludGVybmFsIG5vZGVzLCBhY2N1bXVsYXRlIGZvcmNlcyBmcm9tIGNoaWxkIHF1YWRyYW50cy5cbiAgICBpZiAocXVhZC5sZW5ndGgpIHtcbiAgICAgIGZvciAoeCA9IHkgPSBpID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgICBpZiAoKHEgPSBxdWFkW2ldKSAmJiAoYyA9IE1hdGguYWJzKHEudmFsdWUpKSkge1xuICAgICAgICAgIHN0cmVuZ3RoICs9IHEudmFsdWUsIHdlaWdodCArPSBjLCB4ICs9IGMgKiBxLngsIHkgKz0gYyAqIHEueTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcXVhZC54ID0geCAvIHdlaWdodDtcbiAgICAgIHF1YWQueSA9IHkgLyB3ZWlnaHQ7XG4gICAgfVxuXG4gICAgLy8gRm9yIGxlYWYgbm9kZXMsIGFjY3VtdWxhdGUgZm9yY2VzIGZyb20gY29pbmNpZGVudCBxdWFkcmFudHMuXG4gICAgZWxzZSB7XG4gICAgICBxID0gcXVhZDtcbiAgICAgIHEueCA9IHEuZGF0YS54O1xuICAgICAgcS55ID0gcS5kYXRhLnk7XG4gICAgICBkbyBzdHJlbmd0aCArPSBzdHJlbmd0aHNbcS5kYXRhLmluZGV4XTtcbiAgICAgIHdoaWxlIChxID0gcS5uZXh0KTtcbiAgICB9XG5cbiAgICBxdWFkLnZhbHVlID0gc3RyZW5ndGg7XG4gIH1cblxuICBmdW5jdGlvbiBhcHBseShxdWFkLCB4MSwgXywgeDIpIHtcbiAgICBpZiAoIXF1YWQudmFsdWUpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIHggPSBxdWFkLnggLSBub2RlLngsXG4gICAgICAgIHkgPSBxdWFkLnkgLSBub2RlLnksXG4gICAgICAgIHcgPSB4MiAtIHgxLFxuICAgICAgICBsID0geCAqIHggKyB5ICogeTtcblxuICAgIC8vIEFwcGx5IHRoZSBCYXJuZXMtSHV0IGFwcHJveGltYXRpb24gaWYgcG9zc2libGUuXG4gICAgLy8gTGltaXQgZm9yY2VzIGZvciB2ZXJ5IGNsb3NlIG5vZGVzOyByYW5kb21pemUgZGlyZWN0aW9uIGlmIGNvaW5jaWRlbnQuXG4gICAgaWYgKHcgKiB3IC8gdGhldGEyIDwgbCkge1xuICAgICAgaWYgKGwgPCBkaXN0YW5jZU1heDIpIHtcbiAgICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgICAgaWYgKHkgPT09IDApIHkgPSBqaWdnbGUocmFuZG9tKSwgbCArPSB5ICogeTtcbiAgICAgICAgaWYgKGwgPCBkaXN0YW5jZU1pbjIpIGwgPSBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yICogbCk7XG4gICAgICAgIG5vZGUudnggKz0geCAqIHF1YWQudmFsdWUgKiBhbHBoYSAvIGw7XG4gICAgICAgIG5vZGUudnkgKz0geSAqIHF1YWQudmFsdWUgKiBhbHBoYSAvIGw7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBPdGhlcndpc2UsIHByb2Nlc3MgcG9pbnRzIGRpcmVjdGx5LlxuICAgIGVsc2UgaWYgKHF1YWQubGVuZ3RoIHx8IGwgPj0gZGlzdGFuY2VNYXgyKSByZXR1cm47XG5cbiAgICAvLyBMaW1pdCBmb3JjZXMgZm9yIHZlcnkgY2xvc2Ugbm9kZXM7IHJhbmRvbWl6ZSBkaXJlY3Rpb24gaWYgY29pbmNpZGVudC5cbiAgICBpZiAocXVhZC5kYXRhICE9PSBub2RlIHx8IHF1YWQubmV4dCkge1xuICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICBpZiAobCA8IGRpc3RhbmNlTWluMikgbCA9IE1hdGguc3FydChkaXN0YW5jZU1pbjIgKiBsKTtcbiAgICB9XG5cbiAgICBkbyBpZiAocXVhZC5kYXRhICE9PSBub2RlKSB7XG4gICAgICB3ID0gc3RyZW5ndGhzW3F1YWQuZGF0YS5pbmRleF0gKiBhbHBoYSAvIGw7XG4gICAgICBub2RlLnZ4ICs9IHggKiB3O1xuICAgICAgbm9kZS52eSArPSB5ICogdztcbiAgICB9IHdoaWxlIChxdWFkID0gcXVhZC5uZXh0KTtcbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfbm9kZXMsIF9yYW5kb20pIHtcbiAgICBub2RlcyA9IF9ub2RlcztcbiAgICByYW5kb20gPSBfcmFuZG9tO1xuICAgIGluaXRpYWxpemUoKTtcbiAgfTtcblxuICBmb3JjZS5zdHJlbmd0aCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdHJlbmd0aCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlTWluID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlTWluMiA9IF8gKiBfLCBmb3JjZSkgOiBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yKTtcbiAgfTtcblxuICBmb3JjZS5kaXN0YW5jZU1heCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkaXN0YW5jZU1heDIgPSBfICogXywgZm9yY2UpIDogTWF0aC5zcXJ0KGRpc3RhbmNlTWF4Mik7XG4gIH07XG5cbiAgZm9yY2UudGhldGEgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhldGEyID0gXyAqIF8sIGZvcmNlKSA6IE1hdGguc3FydCh0aGV0YTIpO1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICJpbXBvcnQge1xyXG4gIGZvcmNlU2ltdWxhdGlvbixcclxuICBmb3JjZU1hbnlCb2R5LFxyXG4gIGZvcmNlTGluayxcclxuICBmb3JjZUNlbnRlcixcclxuICBmb3JjZUNvbGxpZGUsXHJcbiAgdHlwZSBTaW11bGF0aW9uLFxyXG4gIHR5cGUgRm9yY2UsXHJcbn0gZnJvbSBcImQzLWZvcmNlXCI7XHJcbmltcG9ydCB0eXBlIHsgTGlua1dlaWdodHNGaWxlIH0gZnJvbSBcIkB2YXVsdC1uZXVyYWwtbGlua3MvY29yZVwiO1xyXG5cclxuLy8gYmFzZVN0cmVuZ3RoIGlzIHVuZGVjYXllZCBcdTIwMTQgZGVjYXkgaXMgYXBwbGllZCBsaXZlIGhlcmUgcmF0aGVyIHRoYW4gYXRcclxuLy8gY29tcGFjdGlvbiAoc2VlIHBhY2thZ2VzL2NvcmUvc3JjL3F1ZXJ5LnRzIGZvciB0aGUgc2FtZSBmb3JtdWxhLCB1c2VkIGJ5XHJcbi8vIE1DUC1kcml2ZW4gcXVlcmllcykuIElubGluZWQgcmF0aGVyIHRoYW4gaW1wb3J0aW5nIEB2YXVsdC1uZXVyYWwtbGlua3MvY29yZSdzXHJcbi8vIHJ1bnRpbWUgY29kZSwgc2luY2UgdGhhdCBwYWNrYWdlJ3MgaW5kZXggYnVuZGxlcyBOb2RlLW9ubHkgZnMvcGF0aC9jcnlwdG9cclxuLy8gbW9kdWxlcyB0aGF0IGNhbid0IHJlc29sdmUgaW4gdGhpcyBicm93c2VyLWJ1bmRsZWQgcGx1Z2luOyBvbmx5IGl0cyB0eXBlc1xyXG4vLyBhcmUgc2FmZSB0byBpbXBvcnQgaGVyZS4gVGhlIHBsdWdpbiBoYXMgbm8gc3luY2hyb25vdXMgYWNjZXNzIHRvIGVhY2hcclxuLy8gbm90ZSdzIGZyb250bWF0dGVyIHR5cGUsIHNvIGl0IGFwcGxpZXMgdGhlIGdsb2JhbCBkZWZhdWx0IGhhbGYtbGlmZVxyXG4vLyBpbnN0ZWFkIG9mIHBlci1ub3RlLXR5cGUgdGF1LlxyXG5jb25zdCBERUZBVUxUX0hBTEZfTElGRV9EQVlTID0gMzA7XHJcblxyXG5mdW5jdGlvbiBsaXZlV2VpZ2h0KGJhc2VTdHJlbmd0aDogbnVtYmVyLCBsYXN0VG91Y2hlZDogc3RyaW5nKTogbnVtYmVyIHtcclxuICBjb25zdCBkYXlzU2luY2UgPSAoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGxhc3RUb3VjaGVkKS5nZXRUaW1lKCkpIC8gKDEwMDAgKiA2MCAqIDYwICogMjQpO1xyXG4gIGlmIChkYXlzU2luY2UgPD0gMCkgcmV0dXJuIGJhc2VTdHJlbmd0aDtcclxuICBjb25zdCBsYW1iZGEgPSBNYXRoLkxOMiAvIERFRkFVTFRfSEFMRl9MSUZFX0RBWVM7XHJcbiAgcmV0dXJuIGJhc2VTdHJlbmd0aCAqIE1hdGguZXhwKC1sYW1iZGEgKiBkYXlzU2luY2UpO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFNpbU5vZGUge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgeD86IG51bWJlcjtcclxuICB5PzogbnVtYmVyO1xyXG4gIHZ4PzogbnVtYmVyO1xyXG4gIHZ5PzogbnVtYmVyO1xyXG4gIC8qKiBwaW5uZWQgcG9zaXRpb24gd2hpbGUgdGhlIHVzZXIgaXMgZHJhZ2dpbmcgdGhpcyBub2RlICovXHJcbiAgZng/OiBudW1iZXIgfCBudWxsO1xyXG4gIGZ5PzogbnVtYmVyIHwgbnVsbDtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBOYXRpdmVFZGdlIHtcclxuICBzb3VyY2U6IHN0cmluZztcclxuICB0YXJnZXQ6IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBTaW1FZGdlIHtcclxuICBzb3VyY2U6IHN0cmluZyB8IFNpbU5vZGU7XHJcbiAgdGFyZ2V0OiBzdHJpbmcgfCBTaW1Ob2RlO1xyXG4gIGtpbmQ6IFwibmV1cmFsXCIgfCBcIm5hdGl2ZVwiO1xyXG4gIC8qKiB1c2FnZSB3ZWlnaHQ7IDAgZm9yIG5hdGl2ZSAoc3RydWN0dXJhbCB3aWtpbGluaykgZWRnZXMgKi9cclxuICB3ZWlnaHQ6IG51bWJlcjtcclxuICAvKiogSVNPIHRpbWVzdGFtcDsgXCJcIiBmb3IgbmF0aXZlIGVkZ2VzLCB3aGljaCBoYXZlIG5vIHVzYWdlIHJlY2VuY3kgKi9cclxuICBsYXN0VG91Y2hlZDogc3RyaW5nO1xyXG59XHJcblxyXG5jb25zdCBKSVRURVJfU1RSRU5HVEggPSAwLjY7XHJcbmNvbnN0IEpJVFRFUl9BTFBIQV9UQVJHRVQgPSAwLjA1O1xyXG5cclxuZXhwb3J0IGNvbnN0IE5PREVfQkFTRV9SQURJVVMgPSA1O1xyXG5jb25zdCBOT0RFX0RFR1JFRV9TQ0FMRSA9IDM7XHJcbmNvbnN0IE5PREVfTUFYX1JBRElVUyA9IDIyO1xyXG5jb25zdCBJU09MQVRFRF9SSU5HX01BUkdJTiA9IDQwO1xyXG5cclxuLyoqIERvdCBzaXplIGdyb3dzIHdpdGggY29ubmVjdGlvbiBjb3VudCBcdTIwMTQgc2hhcmVkIGJ5IGxheW91dCBjb2xsaXNpb24gYW5kIHJlbmRlcmluZy4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIG5vZGVSYWRpdXMoZGVncmVlOiBudW1iZXIpOiBudW1iZXIge1xyXG4gIHJldHVybiBNYXRoLm1pbihOT0RFX01BWF9SQURJVVMsIE5PREVfQkFTRV9SQURJVVMgKyBNYXRoLmxvZzIoZGVncmVlICsgMSkgKiBOT0RFX0RFR1JFRV9TQ0FMRSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUppdHRlckZvcmNlKCk6IEZvcmNlPFNpbU5vZGUsIFNpbUVkZ2U+IHtcclxuICBsZXQgbm9kZXM6IFNpbU5vZGVbXSA9IFtdO1xyXG4gIGNvbnN0IGZvcmNlOiBGb3JjZTxTaW1Ob2RlLCBTaW1FZGdlPiA9ICgpID0+IHtcclxuICAgIGZvciAoY29uc3Qgbm9kZSBvZiBub2Rlcykge1xyXG4gICAgICBub2RlLnZ4ID0gKG5vZGUudnggPz8gMCkgKyAoTWF0aC5yYW5kb20oKSAtIDAuNSkgKiBKSVRURVJfU1RSRU5HVEg7XHJcbiAgICAgIG5vZGUudnkgPSAobm9kZS52eSA/PyAwKSArIChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIEpJVFRFUl9TVFJFTkdUSDtcclxuICAgIH1cclxuICB9O1xyXG4gIGZvcmNlLmluaXRpYWxpemUgPSAoaW5pdE5vZGVzKSA9PiB7XHJcbiAgICBub2RlcyA9IGluaXROb2RlcztcclxuICB9O1xyXG4gIHJldHVybiBmb3JjZTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEtlZXBzIGlzb2xhdGVkIChkZWdyZWUtMCkgbm90ZXMgYXQgb3IgYmV5b25kIHRoZSBkaXN0YW5jZSBvZiB0aGVcclxuICogZmFydGhlc3QgY29ubmVjdGVkIG5vdGUsIHJlY29tcHV0ZWQgZXZlcnkgdGljayBzaW5jZSB0aGUgY29ubmVjdGVkXHJcbiAqIGNsdXN0ZXIncyBleHRlbnQgbW92ZXMgYXMgaXQgc2V0dGxlcy4gTm9kZXMgYWxyZWFkeSBmYXJ0aGVyIG91dCB0aGFuXHJcbiAqIHRoYXQgYXJlIGxlZnQgYWxvbmUgXHUyMDE0IG9ubHkgcHVsbGVkIGlud2FyZCBnZW50bHkgdG8gYXZvaWQgZHJpZnRpbmcgb2ZmXHJcbiAqIGludG8gc3BhY2UgXHUyMDE0IHNvIFwiY2xvc2VyXCIgbmV2ZXIgbWVhbnMgY2xvc2VyIHRoYW4gdGhlIGNsdXN0ZXIncyByZWFjaC5cclxuICovXHJcbmZ1bmN0aW9uIGNyZWF0ZUlzb2xhdGVSaW5nRm9yY2UoZGVncmVlOiBNYXA8c3RyaW5nLCBudW1iZXI+KTogRm9yY2U8U2ltTm9kZSwgU2ltRWRnZT4ge1xyXG4gIGxldCBub2RlczogU2ltTm9kZVtdID0gW107XHJcbiAgY29uc3QgZm9yY2U6IEZvcmNlPFNpbU5vZGUsIFNpbUVkZ2U+ID0gKGFscGhhKSA9PiB7XHJcbiAgICBsZXQgbWF4Q29ubmVjdGVkRGlzdCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IG4gb2Ygbm9kZXMpIHtcclxuICAgICAgaWYgKChkZWdyZWUuZ2V0KG4uaWQpID8/IDApID09PSAwKSBjb250aW51ZTtcclxuICAgICAgaWYgKG4ueCA9PT0gdW5kZWZpbmVkIHx8IG4ueSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgbWF4Q29ubmVjdGVkRGlzdCA9IE1hdGgubWF4KG1heENvbm5lY3RlZERpc3QsIE1hdGguaHlwb3Qobi54LCBuLnkpKTtcclxuICAgIH1cclxuICAgIGNvbnN0IG1pblJhZGl1cyA9IG1heENvbm5lY3RlZERpc3QgKyBJU09MQVRFRF9SSU5HX01BUkdJTjtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG4gb2Ygbm9kZXMpIHtcclxuICAgICAgaWYgKChkZWdyZWUuZ2V0KG4uaWQpID8/IDApICE9PSAwKSBjb250aW51ZTtcclxuICAgICAgaWYgKG4ueCA9PT0gdW5kZWZpbmVkIHx8IG4ueSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgZGlzdCA9IE1hdGguaHlwb3Qobi54LCBuLnkpIHx8IDAuMDAwMTtcclxuICAgICAgY29uc3QgYW5nbGUgPSBNYXRoLmF0YW4yKG4ueSwgbi54KTtcclxuICAgICAgY29uc3QgZGlmZiA9IGRpc3QgPCBtaW5SYWRpdXMgPyBtaW5SYWRpdXMgLSBkaXN0IDogKG1pblJhZGl1cyAtIGRpc3QpICogMC4wNTtcclxuICAgICAgY29uc3QgayA9IDAuMDggKiBhbHBoYTtcclxuICAgICAgbi52eCA9IChuLnZ4ID8/IDApICsgTWF0aC5jb3MoYW5nbGUpICogZGlmZiAqIGs7XHJcbiAgICAgIG4udnkgPSAobi52eSA/PyAwKSArIE1hdGguc2luKGFuZ2xlKSAqIGRpZmYgKiBrO1xyXG4gICAgfVxyXG4gIH07XHJcbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IChpbml0Tm9kZXMpID0+IHtcclxuICAgIG5vZGVzID0gaW5pdE5vZGVzO1xyXG4gIH07XHJcbiAgcmV0dXJuIGZvcmNlO1xyXG59XHJcblxyXG4vKipcclxuICogVGhpbiB3cmFwcGVyIGFyb3VuZCBkMy1mb3JjZTogbm9kZXMgPSB2YXVsdCBub3RlcywgZWRnZXMgPSB3ZWlnaHRlZCBsaW5rcy5cclxuICogTGF5b3V0IGlzIGxlZnQgZnVsbHkgb3JnYW5pYyBcdTIwMTQgbm8gaGFyZGNvZGVkIGZvbGRlci1iYXNlZCBjbHVzdGVyaW5nLlxyXG4gKlxyXG4gKiBUd28gZWRnZSBraW5kcyBzaGFyZSB0aGUgc2FtZSBsYXlvdXQ6IFwibmV1cmFsXCIgZWRnZXMgY29tZSBmcm9tIHRoZVxyXG4gKiB3ZWlnaHRlZCB1c2FnZSBncmFwaCwgXCJuYXRpdmVcIiBlZGdlcyBtaXJyb3IgT2JzaWRpYW4ncyBvd24gW1t3aWtpbGlua11dXHJcbiAqIHN0cnVjdHVyZS4gTmF0aXZlIGVkZ2VzIHB1bGwgbGF5b3V0IG9ubHkgd2Vha2x5IHNvIHRoZSB1c2FnZS13ZWlnaHRlZFxyXG4gKiBncmFwaCBzdGlsbCBkb21pbmF0ZXMgdGhlIHNoYXBlLlxyXG4gKlxyXG4gKiBCeSBkZWZhdWx0IHRoZSBzaW11bGF0aW9uIHJ1bnMgaXRzIG5vcm1hbCBjb2xkLXN0YXJ0IFwiZXhwbG9kZVwiIGFuaW1hdGlvblxyXG4gKiBhbmQgdGhlbiBzZXR0bGVzLCBtYXRjaGluZyBPYnNpZGlhbidzIG93biBncmFwaCB2aWV3LiBDb250aW51b3VzIG1vZGVcclxuICogKHNlZSBzZXRDb250aW51b3VzQW5pbWF0aW9uKSBrZWVwcyBhIHNtYWxsIGppdHRlciBmb3JjZSBhY3RpdmUgZm9yZXZlciBzb1xyXG4gKiBub2RlcyBuZXZlciBmdWxseSBjb21lIHRvIHJlc3QuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgRm9yY2VTaW0ge1xyXG4gIHByaXZhdGUgc2ltdWxhdGlvbjogU2ltdWxhdGlvbjxTaW1Ob2RlLCBTaW1FZGdlPiB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgZWRnZXM6IFNpbUVkZ2VbXSA9IFtdO1xyXG4gIHByaXZhdGUgbWF4V2VpZ2h0ID0gMDtcclxuICBwcml2YXRlIGRlZ3JlZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XHJcbiAgLyoqIG1vc3QgcmVjZW50IGxhc3RUb3VjaGVkIGFtb25nIGVhY2ggbm90ZSdzIGluY2lkZW50IFwibmV1cmFsXCIgKHVzYWdlKSBlZGdlcyBcdTIwMTQgbmF0aXZlIHdpa2lsaW5rcyBkb24ndCBjYXJyeSByZWNlbmN5ICovXHJcbiAgcHJpdmF0ZSBsYXN0VG91Y2hlZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XHJcbiAgcHJpdmF0ZSB0aWNrQ2FsbGJhY2s6ICgobm9kZXM6IFNpbU5vZGVbXSkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGNvbnRpbnVvdXNBbmltYXRpb24gPSBmYWxzZTtcclxuICAvKiogY2FycmllZCBhY3Jvc3Mgc2V0RGF0YSBjYWxscyBzbyB1bmNoYW5nZWQgbm90ZXMga2VlcCB0aGVpciBwb3NpdGlvbiBpbnN0ZWFkIG9mIHJlLWV4cGxvZGluZyAqL1xyXG4gIHByaXZhdGUgbm9kZXNCeUlkID0gbmV3IE1hcDxzdHJpbmcsIFNpbU5vZGU+KCk7XHJcblxyXG4gIG9uVGljayhjYWxsYmFjazogKG5vZGVzOiBTaW1Ob2RlW10pID0+IHZvaWQpOiB2b2lkIHtcclxuICAgIHRoaXMudGlja0NhbGxiYWNrID0gY2FsbGJhY2s7XHJcbiAgICB0aGlzLnNpbXVsYXRpb24/Lm9uKFwidGlja1wiLCAoKSA9PiBjYWxsYmFjayh0aGlzLnNpbXVsYXRpb24hLm5vZGVzKCkpKTtcclxuICB9XHJcblxyXG4gIGdldEVkZ2VzKCk6IFNpbUVkZ2VbXSB7XHJcbiAgICByZXR1cm4gdGhpcy5lZGdlcztcclxuICB9XHJcblxyXG4gIGdldE1heFdlaWdodCgpOiBudW1iZXIge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4V2VpZ2h0O1xyXG4gIH1cclxuXHJcbiAgZ2V0RGVncmVlKGlkOiBzdHJpbmcpOiBudW1iZXIge1xyXG4gICAgcmV0dXJuIHRoaXMuZGVncmVlLmdldChpZCkgPz8gMDtcclxuICB9XHJcblxyXG4gIC8qKiBJU08gdGltZXN0YW1wIG9mIHRoZSBtb3N0IHJlY2VudCB1c2FnZSB0b3VjaCBvbiB0aGlzIG5vdGUsIG9yIHVuZGVmaW5lZCBpZiBpdCBoYXMgbm9uZS4gKi9cclxuICBnZXRMYXN0VG91Y2hlZChpZDogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcclxuICAgIHJldHVybiB0aGlzLmxhc3RUb3VjaGVkLmdldChpZCk7XHJcbiAgfVxyXG5cclxuICAvKiogV2FrZSB0aGUgc2ltdWxhdGlvbiBzbyBpdCByZW9yZ2FuaXplcyBhcm91bmQgYSBjaGFuZ2UgKGUuZy4gYSBub2RlIGRyYWcpLiAqL1xyXG4gIHJlaGVhdChhbHBoYSA9IDAuMyk6IHZvaWQge1xyXG4gICAgdGhpcy5zaW11bGF0aW9uPy5hbHBoYVRhcmdldCh0aGlzLmNvbnRpbnVvdXNBbmltYXRpb24gPyBKSVRURVJfQUxQSEFfVEFSR0VUIDogMCkuYWxwaGEoYWxwaGEpLnJlc3RhcnQoKTtcclxuICB9XHJcblxyXG4gIHNldENvbnRpbnVvdXNBbmltYXRpb24oZW5hYmxlZDogYm9vbGVhbik6IHZvaWQge1xyXG4gICAgdGhpcy5jb250aW51b3VzQW5pbWF0aW9uID0gZW5hYmxlZDtcclxuICAgIGlmICghdGhpcy5zaW11bGF0aW9uKSByZXR1cm47XHJcbiAgICBpZiAoZW5hYmxlZCkge1xyXG4gICAgICB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJqaXR0ZXJcIiwgY3JlYXRlSml0dGVyRm9yY2UoKSk7XHJcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5hbHBoYVRhcmdldChKSVRURVJfQUxQSEFfVEFSR0VUKS5yZXN0YXJ0KCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJqaXR0ZXJcIiwgbnVsbCk7XHJcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5hbHBoYVRhcmdldCgwKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHNldERhdGEobm90ZVBhdGhzOiBzdHJpbmdbXSwgd2VpZ2h0czogTGlua1dlaWdodHNGaWxlLCBuYXRpdmVFZGdlczogTmF0aXZlRWRnZVtdID0gW10sIG1pbldlaWdodCA9IDApOiB2b2lkIHtcclxuICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQobm90ZVBhdGhzKTtcclxuICAgIGNvbnN0IG5ldXJhbEVkZ2VzOiBTaW1FZGdlW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgW2tleSwgcmVjb3JkXSBvZiBPYmplY3QuZW50cmllcyh3ZWlnaHRzLmVkZ2VzKSkge1xyXG4gICAgICBjb25zdCB3ZWlnaHQgPSBsaXZlV2VpZ2h0KHJlY29yZC5iYXNlU3RyZW5ndGgsIHJlY29yZC5sYXN0VG91Y2hlZCk7XHJcbiAgICAgIGlmICh3ZWlnaHQgPCBtaW5XZWlnaHQpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBbc291cmNlLCB0YXJnZXRdID0ga2V5LnNwbGl0KFwifFwiKTtcclxuICAgICAgaWYgKHNvdXJjZSA9PT0gdW5kZWZpbmVkIHx8IHRhcmdldCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgLy8gZWRnZSBlbmRwb2ludHMgbWF5IG5vdCBtYXRjaCBhIGtub3duIG5vdGUgcGF0aCAoZS5nLiB0cmF2ZXJzYWwgZXZlbnRzXHJcbiAgICAgIC8vIGxvZ2dlZCB3aXRoIGEgYmFyZSB3aWtpbGluayBuYW1lKSBcdTIwMTQgaW5jbHVkZSB0aGVtIGFzIG5vZGVzIGFueXdheSBzb1xyXG4gICAgICAvLyBmb3JjZUxpbmsgbmV2ZXIgcmVmZXJlbmNlcyBhIG1pc3NpbmcgaWQuXHJcbiAgICAgIGlkcy5hZGQoc291cmNlKTtcclxuICAgICAgaWRzLmFkZCh0YXJnZXQpO1xyXG4gICAgICBuZXVyYWxFZGdlcy5wdXNoKHsgc291cmNlLCB0YXJnZXQsIGtpbmQ6IFwibmV1cmFsXCIsIHdlaWdodCwgbGFzdFRvdWNoZWQ6IHJlY29yZC5sYXN0VG91Y2hlZCB9KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBuYXRpdmVTaW1FZGdlczogU2ltRWRnZVtdID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBuYXRpdmVFZGdlcykge1xyXG4gICAgICBpZHMuYWRkKHNvdXJjZSk7XHJcbiAgICAgIGlkcy5hZGQodGFyZ2V0KTtcclxuICAgICAgbmF0aXZlU2ltRWRnZXMucHVzaCh7IHNvdXJjZSwgdGFyZ2V0LCBraW5kOiBcIm5hdGl2ZVwiLCB3ZWlnaHQ6IDAsIGxhc3RUb3VjaGVkOiBcIlwiIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIHJldXNlIGV4aXN0aW5nIG5vZGUgb2JqZWN0cyBieSBpZCBzbyBub3RlcyB1bmFmZmVjdGVkIGJ5IHRoaXMgdXBkYXRlIGtlZXBcclxuICAgIC8vIHRoZWlyIGN1cnJlbnQgeC95L3ZlbG9jaXR5IGluc3RlYWQgb2YgdGhlIHdob2xlIGdyYXBoIHJlLWV4cGxvZGluZyBmcm9tXHJcbiAgICAvLyBhIGNvbGQgbGF5b3V0IGV2ZXJ5IHRpbWUgdGhlIHdlaWdodHMgZmlsZSBjaGFuZ2VzXHJcbiAgICBjb25zdCB3YXNGaXJzdExvYWQgPSB0aGlzLnNpbXVsYXRpb24gPT09IG51bGw7XHJcbiAgICBjb25zdCBub2RlczogU2ltTm9kZVtdID0gWy4uLmlkc10ubWFwKChpZCkgPT4gdGhpcy5ub2Rlc0J5SWQuZ2V0KGlkKSA/PyB7IGlkIH0pO1xyXG4gICAgdGhpcy5ub2Rlc0J5SWQgPSBuZXcgTWFwKG5vZGVzLm1hcCgobikgPT4gW24uaWQsIG5dKSk7XHJcblxyXG4gICAgY29uc3QgZWRnZXMgPSBbLi4ubmF0aXZlU2ltRWRnZXMsIC4uLm5ldXJhbEVkZ2VzXTtcclxuICAgIHRoaXMuZWRnZXMgPSBlZGdlcztcclxuICAgIHRoaXMubWF4V2VpZ2h0ID0gbmV1cmFsRWRnZXMucmVkdWNlKChtYXgsIGUpID0+IE1hdGgubWF4KG1heCwgZS53ZWlnaHQpLCAwKTtcclxuXHJcbiAgICBjb25zdCBkZWdyZWUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xyXG4gICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XHJcbiAgICAgIGNvbnN0IHNvdXJjZSA9IGUuc291cmNlIGFzIHN0cmluZztcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgc3RyaW5nO1xyXG4gICAgICBkZWdyZWUuc2V0KHNvdXJjZSwgKGRlZ3JlZS5nZXQoc291cmNlKSA/PyAwKSArIDEpO1xyXG4gICAgICBkZWdyZWUuc2V0KHRhcmdldCwgKGRlZ3JlZS5nZXQodGFyZ2V0KSA/PyAwKSArIDEpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5kZWdyZWUgPSBkZWdyZWU7XHJcblxyXG4gICAgY29uc3QgbGFzdFRvdWNoZWQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xyXG4gICAgZm9yIChjb25zdCBlIG9mIG5ldXJhbEVkZ2VzKSB7XHJcbiAgICAgIGNvbnN0IHNvdXJjZSA9IGUuc291cmNlIGFzIHN0cmluZztcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgc3RyaW5nO1xyXG4gICAgICBpZiAoIWxhc3RUb3VjaGVkLmhhcyhzb3VyY2UpIHx8IGUubGFzdFRvdWNoZWQgPiBsYXN0VG91Y2hlZC5nZXQoc291cmNlKSEpIGxhc3RUb3VjaGVkLnNldChzb3VyY2UsIGUubGFzdFRvdWNoZWQpO1xyXG4gICAgICBpZiAoIWxhc3RUb3VjaGVkLmhhcyh0YXJnZXQpIHx8IGUubGFzdFRvdWNoZWQgPiBsYXN0VG91Y2hlZC5nZXQodGFyZ2V0KSEpIGxhc3RUb3VjaGVkLnNldCh0YXJnZXQsIGUubGFzdFRvdWNoZWQpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5sYXN0VG91Y2hlZCA9IGxhc3RUb3VjaGVkO1xyXG5cclxuICAgIHRoaXMuc2ltdWxhdGlvbj8uc3RvcCgpO1xyXG4gICAgdGhpcy5zaW11bGF0aW9uID0gZm9yY2VTaW11bGF0aW9uKG5vZGVzKVxyXG4gICAgICAuZm9yY2UoXCJjaGFyZ2VcIiwgZm9yY2VNYW55Qm9keSgpLnN0cmVuZ3RoKC05MCkpXHJcbiAgICAgIC5mb3JjZShcclxuICAgICAgICBcImxpbmtcIixcclxuICAgICAgICBmb3JjZUxpbms8U2ltTm9kZSwgU2ltRWRnZT4oZWRnZXMpXHJcbiAgICAgICAgICAuaWQoKGQpID0+IGQuaWQpXHJcbiAgICAgICAgICAuZGlzdGFuY2UoNTUpXHJcbiAgICAgICAgICAuc3RyZW5ndGgoKGQpID0+IChkLmtpbmQgPT09IFwibmF0aXZlXCIgPyAwLjA1IDogMC4zKSksXHJcbiAgICAgIClcclxuICAgICAgLmZvcmNlKFwiY2VudGVyXCIsIGZvcmNlQ2VudGVyKDAsIDApKVxyXG4gICAgICAuZm9yY2UoXCJjb2xsaWRlXCIsIGZvcmNlQ29sbGlkZSgoZCkgPT4gbm9kZVJhZGl1cyhkZWdyZWUuZ2V0KGQuaWQpID8/IDApICsgMykpXHJcbiAgICAgIC8vIG5vdGVzIHdpdGggbm8gY29ubmVjdGlvbnMgYXQgYWxsIGFyZSBrZXB0IGF0IG9yIGJleW9uZCB0aGUgcmVhY2ggb2ZcclxuICAgICAgLy8gdGhlIGNvbm5lY3RlZCBjbHVzdGVyLCBpbnN0ZWFkIG9mIGRyaWZ0aW5nIGluIGFtb25nIGl0XHJcbiAgICAgIC5mb3JjZShcImlzb2xhdGVcIiwgY3JlYXRlSXNvbGF0ZVJpbmdGb3JjZShkZWdyZWUpKTtcclxuXHJcbiAgICAvLyBpbmNyZW1lbnRhbCB1cGRhdGVzIHN0YXJ0IGZyb20gYSBtaWxkIHJlaGVhdCwgbm90IGEgZnVsbCBjb2xkLXN0YXJ0IGFscGhhPTEsXHJcbiAgICAvLyBzaW5jZSByZXVzZWQgbm9kZXMgYWxyZWFkeSBoYXZlIHNlbnNpYmxlIHBvc2l0aW9uc1xyXG4gICAgaWYgKCF3YXNGaXJzdExvYWQpIHRoaXMuc2ltdWxhdGlvbi5hbHBoYSgwLjMpO1xyXG5cclxuICAgIGlmICh0aGlzLmNvbnRpbnVvdXNBbmltYXRpb24pIHtcclxuICAgICAgdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwiaml0dGVyXCIsIGNyZWF0ZUppdHRlckZvcmNlKCkpO1xyXG4gICAgICB0aGlzLnNpbXVsYXRpb24uYWxwaGFUYXJnZXQoSklUVEVSX0FMUEhBX1RBUkdFVCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMudGlja0NhbGxiYWNrKSB7XHJcbiAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy50aWNrQ2FsbGJhY2s7XHJcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5vbihcInRpY2tcIiwgKCkgPT4gY2FsbGJhY2sodGhpcy5zaW11bGF0aW9uIS5ub2RlcygpKSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBzdG9wKCk6IHZvaWQge1xyXG4gICAgdGhpcy5zaW11bGF0aW9uPy5zdG9wKCk7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBub2RlUmFkaXVzLCB0eXBlIEZvcmNlU2ltLCB0eXBlIFNpbUVkZ2UsIHR5cGUgU2ltTm9kZSB9IGZyb20gXCIuL0ZvcmNlU2ltLmpzXCI7XHJcblxyXG5jb25zdCBQVUxTRV9EVVJBVElPTl9NUyA9IDYwMDtcclxuY29uc3QgREVGQVVMVF9FREdFX01BWF9BR0VfREFZUyA9IDMwO1xyXG5jb25zdCBNSU5fU0NBTEUgPSAwLjI7XHJcbmNvbnN0IE1BWF9TQ0FMRSA9IDU7XHJcbmNvbnN0IFpPT01fU1RFUCA9IDEuMjtcclxuXHJcbmV4cG9ydCB0eXBlIENvbG9yU2NoZW1lID0gXCJkZWZhdWx0XCIgfCBcImhpZ2gtY29udHJhc3RcIjtcclxuXHJcbmludGVyZmFjZSBQdWxzZSB7XHJcbiAga2V5OiBzdHJpbmc7XHJcbiAgc3RhcnQ6IG51bWJlcjtcclxufVxyXG5cclxuZnVuY3Rpb24gZWRnZUtleShhOiBzdHJpbmcsIGI6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIFthLCBiXS5zb3J0KCkuam9pbihcInxcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlc29sdmVkTm9kZShlbmQ6IHN0cmluZyB8IFNpbU5vZGUpOiBTaW1Ob2RlIHwgbnVsbCB7XHJcbiAgcmV0dXJuIHR5cGVvZiBlbmQgPT09IFwic3RyaW5nXCIgPyBudWxsIDogZW5kO1xyXG59XHJcblxyXG4vLyBXZWlnaHQgZ3JhZGllbnRzOiBjb2xkICh3ZWFrIGxpbmtzKSAtPiBob3QgKHN0cm9uZyBsaW5rcykuXHJcbmNvbnN0IFdFSUdIVF9HUkFESUVOVFM6IFJlY29yZDxDb2xvclNjaGVtZSwgcmVhZG9ubHkgW251bWJlciwgbnVtYmVyLCBudW1iZXJdW10+ID0ge1xyXG4gIGRlZmF1bHQ6IFtcclxuICAgIFs2NCwgMTQwLCAyNTVdLCAvLyBibHVlXHJcbiAgICBbNzAsIDIwMCwgMTQwXSwgLy8gZ3JlZW5cclxuICAgIFsyMzUsIDIyMCwgNjBdLCAvLyB5ZWxsb3dcclxuICAgIFsyMzUsIDExMCwgMTcwXSwgLy8gcGlua1xyXG4gICAgWzIzMCwgNjAsIDYwXSwgLy8gcmVkXHJcbiAgXSxcclxuICAvLyB3aWRlciBwZXJjZXB0dWFsIHNwYWNpbmcgYmV0d2VlbiBzdG9wcyBmb3IgcmVhZGVycyB3aG8gc3RydWdnbGUgdG9cclxuICAvLyBkaXN0aW5ndWlzaCB0aGUgZGVmYXVsdCBwYWxldHRlJ3MgZ3JlZW4veWVsbG93L3BpbmsgbWlkdG9uZXNcclxuICBcImhpZ2gtY29udHJhc3RcIjogW1xyXG4gICAgWzAsIDEyMCwgMjU1XSwgLy8gYmx1ZVxyXG4gICAgWzAsIDIyMCwgMjIwXSwgLy8gY3lhblxyXG4gICAgWzI1NSwgMjMwLCAwXSwgLy8geWVsbG93XHJcbiAgICBbMjU1LCAxNDAsIDBdLCAvLyBvcmFuZ2VcclxuICAgIFsyNTUsIDAsIDkwXSwgLy8gbWFnZW50YVxyXG4gIF0sXHJcbn07XHJcblxyXG5mdW5jdGlvbiB3ZWlnaHRDb2xvcih0OiBudW1iZXIsIGdyYWRpZW50OiByZWFkb25seSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl1bXSk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSB7XHJcbiAgY29uc3QgY2xhbXBlZCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHQpKTtcclxuICBjb25zdCBzZWdtZW50cyA9IGdyYWRpZW50Lmxlbmd0aCAtIDE7XHJcbiAgY29uc3Qgc2NhbGVkID0gY2xhbXBlZCAqIHNlZ21lbnRzO1xyXG4gIGNvbnN0IGlkeCA9IE1hdGgubWluKHNlZ21lbnRzIC0gMSwgTWF0aC5mbG9vcihzY2FsZWQpKTtcclxuICBjb25zdCBsb2NhbFQgPSBzY2FsZWQgLSBpZHg7XHJcbiAgY29uc3QgW3IxLCBnMSwgYjFdID0gZ3JhZGllbnRbaWR4XTtcclxuICBjb25zdCBbcjIsIGcyLCBiMl0gPSBncmFkaWVudFtpZHggKyAxXTtcclxuICByZXR1cm4gW01hdGgucm91bmQocjEgKyAocjIgLSByMSkgKiBsb2NhbFQpLCBNYXRoLnJvdW5kKGcxICsgKGcyIC0gZzEpICogbG9jYWxUKSwgTWF0aC5yb3VuZChiMSArIChiMiAtIGIxKSAqIGxvY2FsVCldO1xyXG59XHJcblxyXG4vKipcclxuICogQ2FudmFzIGRyYXcgbG9vcCBjb25zdW1pbmcgRm9yY2VTaW0gcG9zaXRpb25zLlxyXG4gKiAtIEVkZ2UgdGhpY2tuZXNzIFx1MjIxRCB3ZWlnaHQgKGxvZy1zY2FsZWQpXHJcbiAqIC0gRWRnZSBvcGFjaXR5L2NvbG9yIGZhZGVzIHRvd2FyZCBtdXRlZCBhcyBsYXN0VG91Y2hlZCBhZ2VzLCBpbmRlcGVuZGVudCBvZiB3ZWlnaHRcclxuICogLSBSZWluZm9yY2VtZW50IHB1bHNlOiBicmllZiBhbmltYXRpb24gd2hlbiBhIHJlaW5mb3JjZSBldmVudCBsYW5kc1xyXG4gKiAtIEludGVyYWN0aW9uOiBjbGljayBub2RlIFx1MjE5MiBvcGVuIG5vdGU7IGhvdmVyIGVkZ2UgXHUyMTkyIHRvb2x0aXAgKHdlaWdodCwgdHJhdmVyc2VDb3VudCwgbGFzdFRvdWNoZWQpXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgUmVuZGVyZXIge1xyXG4gIHByaXZhdGUgY3R4OiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQ7XHJcbiAgcHJpdmF0ZSBub2RlczogU2ltTm9kZVtdID0gW107XHJcbiAgcHJpdmF0ZSBwdWxzZXM6IFB1bHNlW10gPSBbXTtcclxuICBwcml2YXRlIHJhZkhhbmRsZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBob3ZlcmVkRWRnZTogU2ltRWRnZSB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgaG92ZXJlZE5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHRvb2x0aXBFbDogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG9uTm9kZUNsaWNrOiAoKGlkOiBzdHJpbmcpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBzY2FsZSA9IDE7XHJcbiAgcHJpdmF0ZSBwYW5YID0gMDtcclxuICBwcml2YXRlIHBhblkgPSAwO1xyXG4gIHByaXZhdGUgZ3JhZGllbnQgPSBXRUlHSFRfR1JBRElFTlRTLmRlZmF1bHQ7XHJcbiAgcHJpdmF0ZSBlZGdlTWF4QWdlRGF5cyA9IERFRkFVTFRfRURHRV9NQVhfQUdFX0RBWVM7XHJcbiAgcHJpdmF0ZSBwcmltZWROb3RlczogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoKTtcclxuXHJcbiAgLy8gZHJhZyBzdGF0ZTogZWl0aGVyIHBhbm5pbmcgdGhlIGNhbnZhcyBvciBkcmFnZ2luZyBhIHNpbmdsZSBub2RlXHJcbiAgcHJpdmF0ZSBkcmFnTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgaXNQYW5uaW5nID0gZmFsc2U7XHJcbiAgcHJpdmF0ZSBkcmFnTW92ZWQgPSBmYWxzZTtcclxuICBwcml2YXRlIGxhc3RDbGllbnRYID0gMDtcclxuICBwcml2YXRlIGxhc3RDbGllbnRZID0gMDtcclxuXHJcbiAgcHJpdmF0ZSByZWFkb25seSBoYW5kbGVDbGljayA9IChldnQ6IE1vdXNlRXZlbnQpID0+IHRoaXMub25DbGljayhldnQpO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgaGFuZGxlTW91c2VEb3duID0gKGV2dDogTW91c2VFdmVudCkgPT4gdGhpcy5vbk1vdXNlRG93bihldnQpO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgaGFuZGxlTW91c2VNb3ZlID0gKGV2dDogTW91c2VFdmVudCkgPT4gdGhpcy5vbk1vdXNlTW92ZShldnQpO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgaGFuZGxlTW91c2VVcCA9ICgpID0+IHRoaXMuZW5kRHJhZygpO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgaGFuZGxlTW91c2VMZWF2ZSA9ICgpID0+IHRoaXMuY2xlYXJIb3ZlcigpO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgaGFuZGxlV2hlZWwgPSAoZXZ0OiBXaGVlbEV2ZW50KSA9PiB0aGlzLm9uV2hlZWwoZXZ0KTtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNpbTogRm9yY2VTaW0sXHJcbiAgKSB7XHJcbiAgICBjb25zdCBjdHggPSBjYW52YXMuZ2V0Q29udGV4dChcIjJkXCIpO1xyXG4gICAgaWYgKCFjdHgpIHRocm93IG5ldyBFcnJvcihcIjJkIGNhbnZhcyBjb250ZXh0IHVuYXZhaWxhYmxlXCIpO1xyXG4gICAgdGhpcy5jdHggPSBjdHg7XHJcbiAgICB0aGlzLnNpbS5vblRpY2soKG5vZGVzKSA9PiB7XHJcbiAgICAgIHRoaXMubm9kZXMgPSBub2RlcztcclxuICAgIH0pO1xyXG4gICAgdGhpcy5jYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRoaXMuaGFuZGxlQ2xpY2spO1xyXG4gICAgdGhpcy5jYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCB0aGlzLmhhbmRsZU1vdXNlRG93bik7XHJcbiAgICAvLyBkcmFnZ2luZyBjb250aW51ZXMgb24gd2luZG93IHNvIGl0IHN1cnZpdmVzIHRoZSBjdXJzb3IgbGVhdmluZyB0aGUgY2FudmFzXHJcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCB0aGlzLmhhbmRsZU1vdXNlTW92ZSk7XHJcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgdGhpcy5oYW5kbGVNb3VzZVVwKTtcclxuICAgIHRoaXMuY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWxlYXZlXCIsIHRoaXMuaGFuZGxlTW91c2VMZWF2ZSk7XHJcbiAgICB0aGlzLmNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwid2hlZWxcIiwgdGhpcy5oYW5kbGVXaGVlbCwgeyBwYXNzaXZlOiBmYWxzZSB9KTtcclxuICB9XHJcblxyXG4gIG9uTm9kZUNsaWNrZWQoY2FsbGJhY2s6IChpZDogc3RyaW5nKSA9PiB2b2lkKTogdm9pZCB7XHJcbiAgICB0aGlzLm9uTm9kZUNsaWNrID0gY2FsbGJhY2s7XHJcbiAgfVxyXG5cclxuICBzZXRDb2xvclNjaGVtZShzY2hlbWU6IENvbG9yU2NoZW1lKTogdm9pZCB7XHJcbiAgICB0aGlzLmdyYWRpZW50ID0gV0VJR0hUX0dSQURJRU5UU1tzY2hlbWVdO1xyXG4gIH1cclxuXHJcbiAgc2V0RWRnZU1heEFnZURheXMoZGF5czogbnVtYmVyKTogdm9pZCB7XHJcbiAgICB0aGlzLmVkZ2VNYXhBZ2VEYXlzID0gZGF5cztcclxuICB9XHJcblxyXG4gIHNldFByaW1lZE5vdGVzKG5vdGVzOiBSZWFkb25seVNldDxzdHJpbmc+KTogdm9pZCB7XHJcbiAgICB0aGlzLnByaW1lZE5vdGVzID0gbm90ZXM7XHJcbiAgfVxyXG5cclxuICBzdGFydCgpOiB2b2lkIHtcclxuICAgIHRoaXMucmVzaXplVG9EaXNwbGF5U2l6ZSgpO1xyXG4gICAgY29uc3QgbG9vcCA9ICgpID0+IHtcclxuICAgICAgdGhpcy5yZXNpemVUb0Rpc3BsYXlTaXplKCk7XHJcbiAgICAgIHRoaXMuZHJhdygpO1xyXG4gICAgICB0aGlzLnJhZkhhbmRsZSA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShsb29wKTtcclxuICAgIH07XHJcbiAgICB0aGlzLnJhZkhhbmRsZSA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShsb29wKTtcclxuICB9XHJcblxyXG4gIHN0b3AoKTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy5yYWZIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yYWZIYW5kbGUpO1xyXG4gICAgICB0aGlzLnJhZkhhbmRsZSA9IG51bGw7XHJcbiAgICB9XHJcbiAgICB0aGlzLnNpbS5zdG9wKCk7XHJcbiAgICB0aGlzLmNhbnZhcy5yZW1vdmVFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgdGhpcy5oYW5kbGVDbGljayk7XHJcbiAgICB0aGlzLmNhbnZhcy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuaGFuZGxlTW91c2VEb3duKTtcclxuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHRoaXMuaGFuZGxlTW91c2VNb3ZlKTtcclxuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCB0aGlzLmhhbmRsZU1vdXNlVXApO1xyXG4gICAgdGhpcy5jYW52YXMucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbGVhdmVcIiwgdGhpcy5oYW5kbGVNb3VzZUxlYXZlKTtcclxuICAgIHRoaXMuY2FudmFzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJ3aGVlbFwiLCB0aGlzLmhhbmRsZVdoZWVsKTtcclxuICAgIHRoaXMudG9vbHRpcEVsPy5yZW1vdmUoKTtcclxuICAgIHRoaXMudG9vbHRpcEVsID0gbnVsbDtcclxuICB9XHJcblxyXG4gIHB1bHNlRWRnZShzb3VyY2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMucHVsc2VzLnB1c2goeyBrZXk6IGVkZ2VLZXkoc291cmNlLCB0YXJnZXQpLCBzdGFydDogcGVyZm9ybWFuY2Uubm93KCkgfSk7XHJcbiAgfVxyXG5cclxuICB6b29tSW4oKTogdm9pZCB7XHJcbiAgICB0aGlzLnpvb21BdCh0aGlzLmNhbnZhcy53aWR0aCAvIDIsIHRoaXMuY2FudmFzLmhlaWdodCAvIDIsIFpPT01fU1RFUCk7XHJcbiAgfVxyXG5cclxuICB6b29tT3V0KCk6IHZvaWQge1xyXG4gICAgdGhpcy56b29tQXQodGhpcy5jYW52YXMud2lkdGggLyAyLCB0aGlzLmNhbnZhcy5oZWlnaHQgLyAyLCAxIC8gWk9PTV9TVEVQKTtcclxuICB9XHJcblxyXG4gIHJlc2V0VmlldygpOiB2b2lkIHtcclxuICAgIHRoaXMuc2NhbGUgPSAxO1xyXG4gICAgdGhpcy5wYW5YID0gMDtcclxuICAgIHRoaXMucGFuWSA9IDA7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHpvb21BdChzY3JlZW5YOiBudW1iZXIsIHNjcmVlblk6IG51bWJlciwgZmFjdG9yOiBudW1iZXIpOiB2b2lkIHtcclxuICAgIGNvbnN0IHsgeDogY3gsIHk6IGN5IH0gPSB0aGlzLmNlbnRlcigpO1xyXG4gICAgY29uc3Qgd29ybGRYID0gKHNjcmVlblggLSBjeCAtIHRoaXMucGFuWCkgLyB0aGlzLnNjYWxlO1xyXG4gICAgY29uc3Qgd29ybGRZID0gKHNjcmVlblkgLSBjeSAtIHRoaXMucGFuWSkgLyB0aGlzLnNjYWxlO1xyXG5cclxuICAgIGNvbnN0IG5ld1NjYWxlID0gTWF0aC5taW4oTUFYX1NDQUxFLCBNYXRoLm1heChNSU5fU0NBTEUsIHRoaXMuc2NhbGUgKiBmYWN0b3IpKTtcclxuICAgIHRoaXMucGFuWCA9IHNjcmVlblggLSBjeCAtIHdvcmxkWCAqIG5ld1NjYWxlO1xyXG4gICAgdGhpcy5wYW5ZID0gc2NyZWVuWSAtIGN5IC0gd29ybGRZICogbmV3U2NhbGU7XHJcbiAgICB0aGlzLnNjYWxlID0gbmV3U2NhbGU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9uV2hlZWwoZXZ0OiBXaGVlbEV2ZW50KTogdm9pZCB7XHJcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGNvbnN0IHJlY3QgPSB0aGlzLmNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgIGNvbnN0IHJhdGlvID0gd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcclxuICAgIGNvbnN0IHN4ID0gKGV2dC5jbGllbnRYIC0gcmVjdC5sZWZ0KSAqIHJhdGlvO1xyXG4gICAgY29uc3Qgc3kgPSAoZXZ0LmNsaWVudFkgLSByZWN0LnRvcCkgKiByYXRpbztcclxuICAgIGNvbnN0IGZhY3RvciA9IGV2dC5kZWx0YVkgPCAwID8gWk9PTV9TVEVQIDogMSAvIFpPT01fU1RFUDtcclxuICAgIHRoaXMuem9vbUF0KHN4LCBzeSwgZmFjdG9yKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVzaXplVG9EaXNwbGF5U2l6ZSgpOiB2b2lkIHtcclxuICAgIGNvbnN0IHJhdGlvID0gd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcclxuICAgIGNvbnN0IHdpZHRoID0gTWF0aC5yb3VuZCh0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCAqIHJhdGlvKTtcclxuICAgIGNvbnN0IGhlaWdodCA9IE1hdGgucm91bmQodGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0ICogcmF0aW8pO1xyXG4gICAgaWYgKHRoaXMuY2FudmFzLndpZHRoICE9PSB3aWR0aCB8fCB0aGlzLmNhbnZhcy5oZWlnaHQgIT09IGhlaWdodCkge1xyXG4gICAgICB0aGlzLmNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgICB0aGlzLmNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNlbnRlcigpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xyXG4gICAgcmV0dXJuIHsgeDogdGhpcy5jYW52YXMud2lkdGggLyAyLCB5OiB0aGlzLmNhbnZhcy5oZWlnaHQgLyAyIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRyYXcoKTogdm9pZCB7XHJcbiAgICBjb25zdCB7IGN0eCwgY2FudmFzIH0gPSB0aGlzO1xyXG4gICAgY3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpO1xyXG4gICAgY29uc3QgeyB4OiBjeCwgeTogY3kgfSA9IHRoaXMuY2VudGVyKCk7XHJcbiAgICBjdHguc2F2ZSgpO1xyXG4gICAgY3R4LnRyYW5zbGF0ZShjeCArIHRoaXMucGFuWCwgY3kgKyB0aGlzLnBhblkpO1xyXG4gICAgY3R4LnNjYWxlKHRoaXMuc2NhbGUsIHRoaXMuc2NhbGUpO1xyXG5cclxuICAgIGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpO1xyXG4gICAgdGhpcy5wdWxzZXMgPSB0aGlzLnB1bHNlcy5maWx0ZXIoKHApID0+IG5vdyAtIHAuc3RhcnQgPCBQVUxTRV9EVVJBVElPTl9NUyk7XHJcblxyXG4gICAgY29uc3QgaG92ZXJlZElkID0gdGhpcy5ob3ZlcmVkTm9kZT8uaWQ7XHJcblxyXG4gICAgZm9yIChjb25zdCBlZGdlIG9mIHRoaXMuc2ltLmdldEVkZ2VzKCkpIHtcclxuICAgICAgY29uc3Qgc291cmNlID0gcmVzb2x2ZWROb2RlKGVkZ2Uuc291cmNlKTtcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZWROb2RlKGVkZ2UudGFyZ2V0KTtcclxuICAgICAgaWYgKCFzb3VyY2UgfHwgIXRhcmdldCB8fCBzb3VyY2UueCA9PT0gdW5kZWZpbmVkIHx8IHRhcmdldC54ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAodGFyZ2V0LnggPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQueSA9PT0gdW5kZWZpbmVkIHx8IHNvdXJjZS55ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgY29uc3QgaXNIb3ZlcmVkID0gdGhpcy5ob3ZlcmVkRWRnZSA9PT0gZWRnZTtcclxuICAgICAgY29uc3QgdG91Y2hlc0hvdmVyZWROb2RlID0gaG92ZXJlZElkICE9PSB1bmRlZmluZWQgJiYgKHNvdXJjZS5pZCA9PT0gaG92ZXJlZElkIHx8IHRhcmdldC5pZCA9PT0gaG92ZXJlZElkKTtcclxuICAgICAgY29uc3QgZGltbWVkID0gaG92ZXJlZElkICE9PSB1bmRlZmluZWQgJiYgIXRvdWNoZXNIb3ZlcmVkTm9kZTtcclxuXHJcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcclxuICAgICAgY3R4Lm1vdmVUbyhzb3VyY2UueCwgc291cmNlLnkpO1xyXG4gICAgICBjdHgubGluZVRvKHRhcmdldC54LCB0YXJnZXQueSk7XHJcblxyXG4gICAgICBpZiAoZWRnZS5raW5kID09PSBcIm5hdGl2ZVwiKSB7XHJcbiAgICAgICAgY29uc3QgaGlnaGxpZ2h0ZWQgPSBpc0hvdmVyZWQgfHwgdG91Y2hlc0hvdmVyZWROb2RlO1xyXG4gICAgICAgIGN0eC5saW5lV2lkdGggPSAoaGlnaGxpZ2h0ZWQgPyAxLjUgOiAwLjc1KSAvIHRoaXMuc2NhbGU7XHJcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gaGlnaGxpZ2h0ZWRcclxuICAgICAgICAgID8gXCJyZ2JhKDIxMCwgMjEwLCAyMjAsIDAuNzUpXCJcclxuICAgICAgICAgIDogZGltbWVkXHJcbiAgICAgICAgICAgID8gXCJyZ2JhKDE0MCwgMTQwLCAxNTAsIDAuMDgpXCJcclxuICAgICAgICAgICAgOiBcInJnYmEoMTQwLCAxNDAsIDE1MCwgMC4yNSlcIjtcclxuICAgICAgICBjdHguc3Ryb2tlKCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGFnZURheXMgPSAoRGF0ZS5ub3coKSAtIERhdGUucGFyc2UoZWRnZS5sYXN0VG91Y2hlZCkpIC8gODZfNDAwXzAwMDtcclxuICAgICAgY29uc3QgZnJlc2huZXNzID0gTWF0aC5tYXgoMCwgMSAtIGFnZURheXMgLyB0aGlzLmVkZ2VNYXhBZ2VEYXlzKTtcclxuICAgICAgY29uc3QgdGhpY2tuZXNzID0gTWF0aC5tYXgoMC41LCBNYXRoLmxvZzIoZWRnZS53ZWlnaHQgKyAxKSk7XHJcbiAgICAgIGNvbnN0IHB1bHNlID0gdGhpcy5wdWxzZXMuZmluZCgocCkgPT4gcC5rZXkgPT09IGVkZ2VLZXkoc291cmNlLmlkLCB0YXJnZXQuaWQpKTtcclxuICAgICAgY29uc3QgcHVsc2VCb29zdCA9IHB1bHNlID8gMSAtIChub3cgLSBwdWxzZS5zdGFydCkgLyBQVUxTRV9EVVJBVElPTl9NUyA6IDA7XHJcblxyXG4gICAgICAvLyBjb2xvciBhbHdheXMgcmVmbGVjdHMgd2VpZ2h0IFx1MjAxNCBob3ZlciBvbmx5IGV2ZXIgYWRqdXN0cyBvcGFjaXR5L3dpZHRoLCBuZXZlciB0aGUgZ3JhZGllbnQgaHVlXHJcbiAgICAgIGNvbnN0IG1heFdlaWdodCA9IHRoaXMuc2ltLmdldE1heFdlaWdodCgpO1xyXG4gICAgICBjb25zdCBbciwgZywgYl0gPSB3ZWlnaHRDb2xvcihtYXhXZWlnaHQgPiAwID8gZWRnZS53ZWlnaHQgLyBtYXhXZWlnaHQgOiAwLCB0aGlzLmdyYWRpZW50KTtcclxuXHJcbiAgICAgIGNvbnN0IGJhc2VBbHBoYSA9IE1hdGgubWluKDEsIDAuMTUgKyBmcmVzaG5lc3MgKiAwLjcgKyBwdWxzZUJvb3N0ICogMC41KTtcclxuICAgICAgY29uc3QgYWxwaGEgPSB0b3VjaGVzSG92ZXJlZE5vZGUgPyAxIDogZGltbWVkID8gYmFzZUFscGhhICogMC4xNSA6IGJhc2VBbHBoYTtcclxuXHJcbiAgICAgIGN0eC5saW5lV2lkdGggPSAodGhpY2tuZXNzICsgcHVsc2VCb29zdCAqIDMgKyAodG91Y2hlc0hvdmVyZWROb2RlID8gMC41IDogMCkpIC8gdGhpcy5zY2FsZTtcclxuICAgICAgY3R4LnN0cm9rZVN0eWxlID0gaXNIb3ZlcmVkXHJcbiAgICAgICAgPyBgcmdiYSgyNTUsIDI1NSwgMjU1LCAke01hdGgubWluKDEsIGFscGhhICsgMC4zKX0pYFxyXG4gICAgICAgIDogYHJnYmEoJHtyfSwgJHtnfSwgJHtifSwgJHthbHBoYX0pYDtcclxuICAgICAgY3R4LnN0cm9rZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAoY29uc3Qgbm9kZSBvZiB0aGlzLm5vZGVzKSB7XHJcbiAgICAgIGlmIChub2RlLnggPT09IHVuZGVmaW5lZCB8fCBub2RlLnkgPT09IHVuZGVmaW5lZCkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGlzSG92ZXJlZCA9IHRoaXMuaG92ZXJlZE5vZGUgPT09IG5vZGU7XHJcbiAgICAgIGNvbnN0IHJhZGl1cyA9IG5vZGVSYWRpdXModGhpcy5zaW0uZ2V0RGVncmVlKG5vZGUuaWQpKTtcclxuXHJcbiAgICAgIGNvbnN0IG5vZGVMYXN0VG91Y2hlZCA9IHRoaXMuc2ltLmdldExhc3RUb3VjaGVkKG5vZGUuaWQpO1xyXG4gICAgICBjb25zdCBub2RlQWdlRGF5cyA9IG5vZGVMYXN0VG91Y2hlZCA/IChEYXRlLm5vdygpIC0gRGF0ZS5wYXJzZShub2RlTGFzdFRvdWNoZWQpKSAvIDg2XzQwMF8wMDAgOiBJbmZpbml0eTtcclxuICAgICAgY29uc3Qgbm9kZUZyZXNobmVzcyA9IE1hdGgubWF4KDAsIDEgLSBub2RlQWdlRGF5cyAvIHRoaXMuZWRnZU1heEFnZURheXMpO1xyXG4gICAgICBjb25zdCBub2RlQWxwaGEgPSBNYXRoLm1pbigxLCAwLjM1ICsgbm9kZUZyZXNobmVzcyAqIDAuNjUpO1xyXG5cclxuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xyXG4gICAgICBjdHguYXJjKG5vZGUueCwgbm9kZS55LCBpc0hvdmVyZWQgPyByYWRpdXMgKiAxLjIgOiByYWRpdXMsIDAsIE1hdGguUEkgKiAyKTtcclxuICAgICAgY3R4LmZpbGxTdHlsZSA9IGlzSG92ZXJlZCA/IFwicmdiYSgyNTUsIDIwMCwgODAsIDAuOTUpXCIgOiBgcmdiYSgyMjAsIDIyMCwgMjMwLCAke25vZGVBbHBoYX0pYDtcclxuICAgICAgY3R4LmZpbGwoKTtcclxuXHJcbiAgICAgIGlmICh0aGlzLnByaW1lZE5vdGVzLmhhcyhub2RlLmlkKSkge1xyXG4gICAgICAgIGN0eC5zYXZlKCk7XHJcbiAgICAgICAgY3R4LnNldExpbmVEYXNoKFs0IC8gdGhpcy5zY2FsZSwgMyAvIHRoaXMuc2NhbGVdKTtcclxuICAgICAgICBjdHgubGluZVdpZHRoID0gMS41IC8gdGhpcy5zY2FsZTtcclxuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYmEoMjU1LCAxNzAsIDYwLCAwLjkpXCI7XHJcbiAgICAgICAgY3R4LmJlZ2luUGF0aCgpO1xyXG4gICAgICAgIGN0eC5hcmMobm9kZS54LCBub2RlLnksIHJhZGl1cyArIDQgLyB0aGlzLnNjYWxlLCAwLCBNYXRoLlBJICogMik7XHJcbiAgICAgICAgY3R4LnN0cm9rZSgpO1xyXG4gICAgICAgIGN0eC5yZXN0b3JlKCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChpc0hvdmVyZWQpIHtcclxuICAgICAgICBjb25zdCB0aXRsZSA9IG5vZGUuaWQuc3BsaXQoXCIvXCIpLnBvcCgpID8/IG5vZGUuaWQ7XHJcbiAgICAgICAgY3R4LmZvbnQgPSBgJHsxMyAvIHRoaXMuc2NhbGV9cHggdmFyKC0tZm9udC1pbnRlcmZhY2UsIHNhbnMtc2VyaWYpYDtcclxuICAgICAgICBjdHgudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICBjdHgudGV4dEJhc2VsaW5lID0gXCJ0b3BcIjtcclxuICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2JhKDIzNSwgMjM1LCAyNDUsIDAuOTUpXCI7XHJcbiAgICAgICAgY3R4LmZpbGxUZXh0KHRpdGxlLCBub2RlLngsIG5vZGUueSArIHJhZGl1cyArIDQgLyB0aGlzLnNjYWxlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGN0eC5yZXN0b3JlKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGV2ZW50VG9Xb3JsZChldnQ6IE1vdXNlRXZlbnQpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xyXG4gICAgY29uc3QgcmVjdCA9IHRoaXMuY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgY29uc3QgcmF0aW8gPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xyXG4gICAgY29uc3QgeyB4OiBjeCwgeTogY3kgfSA9IHRoaXMuY2VudGVyKCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICB4OiAoKGV2dC5jbGllbnRYIC0gcmVjdC5sZWZ0KSAqIHJhdGlvIC0gY3ggLSB0aGlzLnBhblgpIC8gdGhpcy5zY2FsZSxcclxuICAgICAgeTogKChldnQuY2xpZW50WSAtIHJlY3QudG9wKSAqIHJhdGlvIC0gY3kgLSB0aGlzLnBhblkpIC8gdGhpcy5zY2FsZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGhpdFRlc3ROb2RlKHdvcmxkWDogbnVtYmVyLCB3b3JsZFk6IG51bWJlcik6IFNpbU5vZGUgfCBudWxsIHtcclxuICAgIGZvciAoY29uc3Qgbm9kZSBvZiB0aGlzLm5vZGVzKSB7XHJcbiAgICAgIGlmIChub2RlLnggPT09IHVuZGVmaW5lZCB8fCBub2RlLnkgPT09IHVuZGVmaW5lZCkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGR4ID0gbm9kZS54IC0gd29ybGRYO1xyXG4gICAgICBjb25zdCBkeSA9IG5vZGUueSAtIHdvcmxkWTtcclxuICAgICAgY29uc3QgdGhyZXNob2xkID0gbm9kZVJhZGl1cyh0aGlzLnNpbS5nZXREZWdyZWUobm9kZS5pZCkpICsgMztcclxuICAgICAgaWYgKGR4ICogZHggKyBkeSAqIGR5IDw9IHRocmVzaG9sZCAqKiAyKSByZXR1cm4gbm9kZTtcclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBoaXRUZXN0RWRnZSh3b3JsZFg6IG51bWJlciwgd29ybGRZOiBudW1iZXIpOiBTaW1FZGdlIHwgbnVsbCB7XHJcbiAgICBjb25zdCB0aHJlc2hvbGQgPSA1O1xyXG4gICAgZm9yIChjb25zdCBlZGdlIG9mIHRoaXMuc2ltLmdldEVkZ2VzKCkpIHtcclxuICAgICAgY29uc3Qgc291cmNlID0gcmVzb2x2ZWROb2RlKGVkZ2Uuc291cmNlKTtcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZWROb2RlKGVkZ2UudGFyZ2V0KTtcclxuICAgICAgaWYgKCFzb3VyY2UgfHwgIXRhcmdldCkgY29udGludWU7XHJcbiAgICAgIGlmIChzb3VyY2UueCA9PT0gdW5kZWZpbmVkIHx8IHNvdXJjZS55ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAodGFyZ2V0LnggPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQueSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuXHJcbiAgICAgIGNvbnN0IGRpc3QgPSBkaXN0YW5jZVRvU2VnbWVudCh3b3JsZFgsIHdvcmxkWSwgc291cmNlLngsIHNvdXJjZS55LCB0YXJnZXQueCwgdGFyZ2V0LnkpO1xyXG4gICAgICBpZiAoZGlzdCA8PSB0aHJlc2hvbGQpIHJldHVybiBlZGdlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGlzT3ZlckNhbnZhcyhldnQ6IE1vdXNlRXZlbnQpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IHJlY3QgPSB0aGlzLmNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIGV2dC5jbGllbnRYID49IHJlY3QubGVmdCAmJiBldnQuY2xpZW50WCA8PSByZWN0LnJpZ2h0ICYmIGV2dC5jbGllbnRZID49IHJlY3QudG9wICYmIGV2dC5jbGllbnRZIDw9IHJlY3QuYm90dG9tXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbkNsaWNrKGV2dDogTW91c2VFdmVudCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMuZHJhZ01vdmVkKSByZXR1cm47IC8vIHN1cHByZXNzIHRoZSBjbGljayB0aGF0IGZvbGxvd3MgYSBkcmFnXHJcbiAgICBjb25zdCB7IHgsIHkgfSA9IHRoaXMuZXZlbnRUb1dvcmxkKGV2dCk7XHJcbiAgICBjb25zdCBub2RlID0gdGhpcy5oaXRUZXN0Tm9kZSh4LCB5KTtcclxuICAgIGlmIChub2RlKSB0aGlzLm9uTm9kZUNsaWNrPy4obm9kZS5pZCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9uTW91c2VEb3duKGV2dDogTW91c2VFdmVudCk6IHZvaWQge1xyXG4gICAgY29uc3QgeyB4LCB5IH0gPSB0aGlzLmV2ZW50VG9Xb3JsZChldnQpO1xyXG4gICAgY29uc3Qgbm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUoeCwgeSk7XHJcbiAgICB0aGlzLmRyYWdNb3ZlZCA9IGZhbHNlO1xyXG4gICAgdGhpcy5sYXN0Q2xpZW50WCA9IGV2dC5jbGllbnRYO1xyXG4gICAgdGhpcy5sYXN0Q2xpZW50WSA9IGV2dC5jbGllbnRZO1xyXG5cclxuICAgIGlmIChub2RlKSB7XHJcbiAgICAgIHRoaXMuZHJhZ05vZGUgPSBub2RlO1xyXG4gICAgICBub2RlLmZ4ID0gbm9kZS54O1xyXG4gICAgICBub2RlLmZ5ID0gbm9kZS55O1xyXG4gICAgICB0aGlzLnNpbS5yZWhlYXQoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMuaXNQYW5uaW5nID0gdHJ1ZTtcclxuICAgICAgdGhpcy5jYW52YXMuc3R5bGUuY3Vyc29yID0gXCJncmFiYmluZ1wiO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbk1vdXNlTW92ZShldnQ6IE1vdXNlRXZlbnQpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmRyYWdOb2RlKSB7XHJcbiAgICAgIGNvbnN0IGR4ID0gZXZ0LmNsaWVudFggLSB0aGlzLmxhc3RDbGllbnRYO1xyXG4gICAgICBjb25zdCBkeSA9IGV2dC5jbGllbnRZIC0gdGhpcy5sYXN0Q2xpZW50WTtcclxuICAgICAgaWYgKGR4ICE9PSAwIHx8IGR5ICE9PSAwKSB0aGlzLmRyYWdNb3ZlZCA9IHRydWU7XHJcbiAgICAgIGNvbnN0IHsgeCwgeSB9ID0gdGhpcy5ldmVudFRvV29ybGQoZXZ0KTtcclxuICAgICAgdGhpcy5kcmFnTm9kZS5meCA9IHg7XHJcbiAgICAgIHRoaXMuZHJhZ05vZGUuZnkgPSB5O1xyXG4gICAgICB0aGlzLmxhc3RDbGllbnRYID0gZXZ0LmNsaWVudFg7XHJcbiAgICAgIHRoaXMubGFzdENsaWVudFkgPSBldnQuY2xpZW50WTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLmlzUGFubmluZykge1xyXG4gICAgICBjb25zdCByYXRpbyA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XHJcbiAgICAgIGNvbnN0IGR4ID0gKGV2dC5jbGllbnRYIC0gdGhpcy5sYXN0Q2xpZW50WCkgKiByYXRpbztcclxuICAgICAgY29uc3QgZHkgPSAoZXZ0LmNsaWVudFkgLSB0aGlzLmxhc3RDbGllbnRZKSAqIHJhdGlvO1xyXG4gICAgICBpZiAoZHggIT09IDAgfHwgZHkgIT09IDApIHRoaXMuZHJhZ01vdmVkID0gdHJ1ZTtcclxuICAgICAgdGhpcy5wYW5YICs9IGR4O1xyXG4gICAgICB0aGlzLnBhblkgKz0gZHk7XHJcbiAgICAgIHRoaXMubGFzdENsaWVudFggPSBldnQuY2xpZW50WDtcclxuICAgICAgdGhpcy5sYXN0Q2xpZW50WSA9IGV2dC5jbGllbnRZO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCF0aGlzLmlzT3ZlckNhbnZhcyhldnQpKSB7XHJcbiAgICAgIHRoaXMuY2xlYXJIb3ZlcigpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgeyB4LCB5IH0gPSB0aGlzLmV2ZW50VG9Xb3JsZChldnQpO1xyXG4gICAgY29uc3Qgbm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUoeCwgeSk7XHJcbiAgICBjb25zdCBlZGdlID0gbm9kZSA/IG51bGwgOiB0aGlzLmhpdFRlc3RFZGdlKHgsIHkpO1xyXG4gICAgdGhpcy5ob3ZlcmVkTm9kZSA9IG5vZGU7XHJcbiAgICB0aGlzLmhvdmVyZWRFZGdlID0gZWRnZTtcclxuICAgIHRoaXMuY2FudmFzLnN0eWxlLmN1cnNvciA9IG5vZGUgPyBcImdyYWJcIiA6IFwiZGVmYXVsdFwiO1xyXG5cclxuICAgIC8vIG5vZGUgdGl0bGVzIGFyZSBkcmF3biBkaXJlY3RseSBvbiB0aGUgY2FudmFzIG5leHQgdG8gdGhlIGRvdDsgdGhlXHJcbiAgICAvLyBmbG9hdGluZyB0b29sdGlwIGlzIG9ubHkgbmVlZGVkIGZvciBlZGdlcywgd2hpY2ggY2FycnkgbW9yZSBkZXRhaWxcclxuICAgIC8vIHRoYW4gZml0cyBjb21mb3J0YWJseSBhbG9uZyBhIGxpbmUuXHJcbiAgICBpZiAoIWVkZ2UpIHtcclxuICAgICAgdGhpcy50b29sdGlwRWw/LnJlbW92ZSgpO1xyXG4gICAgICB0aGlzLnRvb2x0aXBFbCA9IG51bGw7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXRoaXMudG9vbHRpcEVsKSB7XHJcbiAgICAgIHRoaXMudG9vbHRpcEVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgdGhpcy50b29sdGlwRWwuYWRkQ2xhc3MoXCJ2YXVsdC1uZXVyYWwtbGlua3MtdG9vbHRpcFwiKTtcclxuICAgICAgdGhpcy5jYW52YXMucGFyZW50RWxlbWVudD8uYXBwZW5kQ2hpbGQodGhpcy50b29sdGlwRWwpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHNvdXJjZSA9IHJlc29sdmVkTm9kZShlZGdlLnNvdXJjZSk7XHJcbiAgICBjb25zdCB0YXJnZXQgPSByZXNvbHZlZE5vZGUoZWRnZS50YXJnZXQpO1xyXG4gICAgdGhpcy50b29sdGlwRWwuc2V0VGV4dChcclxuICAgICAgZWRnZS5raW5kID09PSBcIm5hdGl2ZVwiXHJcbiAgICAgICAgPyBgJHtzb3VyY2U/LmlkID8/IFwiP1wifSBcdTIxOTQgJHt0YXJnZXQ/LmlkID8/IFwiP1wifVxcbihuYXRpdmUgd2lraWxpbmspYFxyXG4gICAgICAgIDogYCR7c291cmNlPy5pZCA/PyBcIj9cIn0gXHUyMTk0ICR7dGFyZ2V0Py5pZCA/PyBcIj9cIn1cXG53ZWlnaHQ6ICR7ZWRnZS53ZWlnaHQudG9GaXhlZCgyKX1cXG5sYXN0IHRvdWNoZWQ6ICR7ZWRnZS5sYXN0VG91Y2hlZH1gLFxyXG4gICAgKTtcclxuICAgIHRoaXMudG9vbHRpcEVsLnN0eWxlLmxlZnQgPSBgJHtldnQuY2xpZW50WCArIDEyfXB4YDtcclxuICAgIHRoaXMudG9vbHRpcEVsLnN0eWxlLnRvcCA9IGAke2V2dC5jbGllbnRZICsgMTJ9cHhgO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBlbmREcmFnKCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMuZHJhZ05vZGUpIHtcclxuICAgICAgdGhpcy5kcmFnTm9kZS5meCA9IG51bGw7XHJcbiAgICAgIHRoaXMuZHJhZ05vZGUuZnkgPSBudWxsO1xyXG4gICAgICB0aGlzLmRyYWdOb2RlID0gbnVsbDtcclxuICAgIH1cclxuICAgIHRoaXMuaXNQYW5uaW5nID0gZmFsc2U7XHJcbiAgICB0aGlzLmNhbnZhcy5zdHlsZS5jdXJzb3IgPSB0aGlzLmhvdmVyZWROb2RlID8gXCJncmFiXCIgOiBcImRlZmF1bHRcIjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY2xlYXJIb3ZlcigpOiB2b2lkIHtcclxuICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBudWxsO1xyXG4gICAgdGhpcy5ob3ZlcmVkRWRnZSA9IG51bGw7XHJcbiAgICB0aGlzLmNhbnZhcy5zdHlsZS5jdXJzb3IgPSBcImRlZmF1bHRcIjtcclxuICAgIHRoaXMudG9vbHRpcEVsPy5yZW1vdmUoKTtcclxuICAgIHRoaXMudG9vbHRpcEVsID0gbnVsbDtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRpc3RhbmNlVG9TZWdtZW50KHB4OiBudW1iZXIsIHB5OiBudW1iZXIsIHgxOiBudW1iZXIsIHkxOiBudW1iZXIsIHgyOiBudW1iZXIsIHkyOiBudW1iZXIpOiBudW1iZXIge1xyXG4gIGNvbnN0IGR4ID0geDIgLSB4MTtcclxuICBjb25zdCBkeSA9IHkyIC0geTE7XHJcbiAgY29uc3QgbGVuZ3RoU3EgPSBkeCAqIGR4ICsgZHkgKiBkeTtcclxuICBsZXQgdCA9IGxlbmd0aFNxID09PSAwID8gMCA6ICgocHggLSB4MSkgKiBkeCArIChweSAtIHkxKSAqIGR5KSAvIGxlbmd0aFNxO1xyXG4gIHQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCB0KSk7XHJcbiAgY29uc3QgY2xvc2VzdFggPSB4MSArIHQgKiBkeDtcclxuICBjb25zdCBjbG9zZXN0WSA9IHkxICsgdCAqIGR5O1xyXG4gIHJldHVybiBNYXRoLmh5cG90KHB4IC0gY2xvc2VzdFgsIHB5IC0gY2xvc2VzdFkpO1xyXG59XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQUFzQzs7O0FDQXRDLHNCQUErQztBQUd4QyxJQUFNLDZCQUFOLGNBQXlDLGlDQUFpQjtBQUFBLEVBQy9ELFlBQ0UsS0FDaUIsUUFDakI7QUFDQSxVQUFNLEtBQUssTUFBTTtBQUZBO0FBQUEsRUFHbkI7QUFBQSxFQUVBLFVBQWdCO0FBQ2QsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixnQkFBWSxNQUFNO0FBRWxCLFFBQUksd0JBQVEsV0FBVyxFQUNwQixRQUFRLHFCQUFxQixFQUM3QjtBQUFBLE1BQ0M7QUFBQSxJQUVGLEVBQ0M7QUFBQSxNQUFVLENBQUMsV0FDVixPQUNHLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFDcEIsU0FBUyxLQUFLLE9BQU8sU0FBUyxlQUFlLEVBQzdDLGtCQUFrQixFQUNsQixTQUFTLENBQUMsVUFBVTtBQUNuQixhQUFLLE9BQU8sU0FBUyxrQkFBa0I7QUFDdkMsYUFBSyxLQUFLLE9BQU8sYUFBYTtBQUM5QixhQUFLLE9BQU8sa0JBQWtCO0FBQUEsTUFDaEMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSxjQUFjLEVBQ3RCLFFBQVEsd0VBQXdFLEVBQ2hGO0FBQUEsTUFBWSxDQUFDLGFBQ1osU0FDRyxVQUFVLFdBQVcsU0FBUyxFQUM5QixVQUFVLGlCQUFpQixlQUFlLEVBQzFDLFNBQVMsS0FBSyxPQUFPLFNBQVMsV0FBVyxFQUN6QyxTQUFTLENBQUMsVUFBVTtBQUNuQixhQUFLLE9BQU8sU0FBUyxjQUFjO0FBQ25DLGFBQUssS0FBSyxPQUFPLGFBQWE7QUFDOUIsYUFBSyxPQUFPLGtCQUFrQjtBQUFBLE1BQ2hDLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSx3QkFBUSxXQUFX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QUFDeEIsZUFBVyxRQUFRLEtBQUssSUFBSSxVQUFVLGdCQUFnQixzQkFBc0IsR0FBRztBQUM3RSxVQUFJLEtBQUssZ0JBQWdCLGdCQUFpQixNQUFLLEtBQUssY0FBYztBQUFBLElBQ3BFO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxlQUE4QjtBQUMxQyxVQUFNLEVBQUUsVUFBVSxJQUFJLEtBQUs7QUFDM0IsVUFBTSxXQUFXLFVBQVUsZ0JBQWdCLHNCQUFzQixFQUFFLENBQUM7QUFDcEUsUUFBSSxVQUFVO0FBQ1osZ0JBQVUsV0FBVyxRQUFRO0FBQzdCO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxVQUFVLFFBQVEsS0FBSztBQUNwQyxVQUFNLEtBQUssYUFBYSxFQUFFLE1BQU0sd0JBQXdCLFFBQVEsS0FBSyxDQUFDO0FBQ3RFLGNBQVUsV0FBVyxJQUFJO0FBQUEsRUFDM0I7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJQT0xMX0lOVEVSVkFMX01TIiwgImxvYWRGcyIsICJub3ciLCAieCIsICJ5IiwgIngiLCAieSIsICJ4IiwgInkiLCAieCIsICJ5IiwgIngyIiwgInkyIiwgIngzIiwgInkzIiwgIngiLCAieSIsICJ4IiwgInkiLCAieCIsICJ4IiwgInkiLCAieCIsICJ5IiwgIm0iLCAiaSIsICJjIiwgIm5vdyIsICJ4IiwgInkiLCAieCIsICJ5IiwgIm5vZGUiLCAic3RyZW5ndGgiLCAiYyIsICJ4MiIsICJhIiwgIm5vdyIsICJ4IiwgInkiLCAieDIiLCAieTIiXQp9Cg==
