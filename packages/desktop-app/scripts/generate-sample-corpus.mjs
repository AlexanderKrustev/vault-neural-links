#!/usr/bin/env node
/**
 * Synthetic OKF corpus generator (AIBRAIN-108/109 groundwork) — since no
 * real large-scale OKF corpus exists to test against yet, and porting the
 * user's real vault (personal + client-confidential notes) into this repo
 * isn't safe to do, this generates a plausible-looking corpus instead:
 * preferential-attachment (Barabasi-Albert style) link topology so a few
 * hub notes end up heavily linked and most notes sparsely linked, same
 * shape real note graphs (and Wikipedia) tend to have — a uniform-random
 * link generator would under-stress structural signals (PageRank,
 * clustering, spreading activation) compared to this.
 *
 * Deterministic: a fixed PRNG seed means the same --count always produces
 * the same corpus, so a run today and a run next week are comparable.
 *
 * Usage: node scripts/generate-sample-corpus.mjs [count] [outDir]
 *   count  — number of notes to generate (default 250)
 *   outDir — output directory (default ../sample-okf-large, gitignored)
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COUNT = Number(process.argv[2] ?? 250);
const OUT_DIR = process.argv[3] ?? join(__dirname, "..", "sample-okf-large");
const SEED_SIZE = 3;
const ATTACH_COUNT = 2; // new-node attachment count, Barabasi-Albert style

const CLUSTERS = [
  { name: "engineering", tag: "engineering" },
  { name: "product", tag: "product" },
  { name: "research", tag: "research" },
  { name: "meetings", tag: "meetings" },
  { name: "personal", tag: "personal" },
  { name: "reading-notes", tag: "reading" },
];

const TYPES = ["concept", "task", "reference", "note"];

const WORDS = [
  "retrieval", "graph", "signal", "pipeline", "context", "memory", "weight",
  "cluster", "review", "draft", "architecture", "decision", "backlog",
  "sprint", "roadmap", "insight", "summary", "protocol", "interface",
  "schema", "baseline", "activation", "consolidation", "priming", "topology",
];

/** Deterministic PRNG (mulberry32) — same seed always produces the same corpus. */
function mulberry32(seed) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function titleCase(words) {
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Both paths are "cluster/file.md" (one level deep) — relative link between them. */
function relativeLink(fromRelPath, toRelPath) {
  const fromDir = fromRelPath.split("/").slice(0, -1).join("/");
  const toParts = toRelPath.split("/");
  const toFile = toParts.pop();
  const toDir = toParts.join("/");
  return fromDir === toDir ? toFile : `../${toDir}/${toFile}`;
}

function buildNodes(count, rng) {
  const nodes = [];

  for (let i = 0; i < SEED_SIZE; i++) {
    nodes.push({ index: i, cluster: pick(CLUSTERS, rng), title: titleCase([pick(WORDS, rng), pick(WORDS, rng)]), degree: 0, links: new Set() });
  }
  for (let i = 0; i < SEED_SIZE; i++) {
    for (let j = i + 1; j < SEED_SIZE; j++) {
      nodes[i].links.add(j);
      nodes[j].links.add(i);
      nodes[i].degree++;
      nodes[j].degree++;
    }
  }

  for (let i = SEED_SIZE; i < count; i++) {
    const node = { index: i, cluster: pick(CLUSTERS, rng), title: titleCase([pick(WORDS, rng), pick(WORDS, rng), pick(WORDS, rng)]), degree: 0, links: new Set() };
    nodes.push(node);

    // Preferential attachment: weight existing nodes by (degree + 1) so
    // hubs accumulate more links over time, but every node (even degree-0)
    // has a nonzero chance of being picked.
    const totalWeight = nodes.slice(0, i).reduce((sum, n) => sum + n.degree + 1, 0);
    const targets = new Set();
    let attempts = 0;
    while (targets.size < Math.min(ATTACH_COUNT, i) && attempts < 50) {
      attempts++;
      let r = rng() * totalWeight;
      for (let k = 0; k < i; k++) {
        r -= nodes[k].degree + 1;
        if (r <= 0) {
          targets.add(k);
          break;
        }
      }
    }
    for (const t of targets) {
      node.links.add(t);
      nodes[t].links.add(i);
      node.degree++;
      nodes[t].degree++;
    }
  }

  for (const n of nodes) {
    const base = slugify(n.title) || `note-${n.index}`;
    n.relPath = `${n.cluster.name}/${base}-${n.index}.md`;
  }

  return nodes;
}

async function writeCorpus(nodes, outDir, rng) {
  const now = Date.now();
  for (const n of nodes) {
    const type = pick(TYPES, rng);
    const description = `Synthetic ${type} about ${n.title.toLowerCase()}, generated for scale testing.`;
    const timestamp = new Date(now - Math.floor(rng() * 1000 * 60 * 60 * 24 * 180)).toISOString();
    const linkLines = [...n.links].map((t) => `- [${nodes[t].title}](${relativeLink(n.relPath, nodes[t].relPath)})`);

    const frontmatter = ["---", `type: ${type}`, `title: "${n.title}"`, `description: "${description}"`, `tags: [${n.cluster.tag}]`, `timestamp: ${timestamp}`, "---", ""].join("\n");
    const body = [`# ${n.title}`, "", description, "", ...(linkLines.length > 0 ? ["## Related", ...linkLines] : []), ""].join("\n");

    const filePath = join(outDir, n.relPath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, frontmatter + body, "utf8");
  }
}

async function main() {
  const rng = mulberry32(42);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const nodes = buildNodes(COUNT, rng);
  await writeCorpus(nodes, OUT_DIR, rng);

  const edgeCount = nodes.reduce((sum, n) => sum + n.links.size, 0) / 2;
  const degrees = nodes.map((n) => n.degree).sort((a, b) => b - a);
  console.log(`Generated ${nodes.length} notes, ${edgeCount} edges, in ${OUT_DIR}`);
  console.log(`Max degree: ${degrees[0]}, median degree: ${degrees[Math.floor(degrees.length / 2)]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
