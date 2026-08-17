const openBtn = document.getElementById("openBtn");
const folderPathEl = document.getElementById("folderPath");
const summaryEl = document.getElementById("summary");
const notesEl = document.getElementById("notes");
const errorEl = document.getElementById("error");

function stat(n, label) {
  const div = document.createElement("div");
  div.className = "stat";
  div.innerHTML = `<div class="n">${n}</div><div class="label">${label}</div>`;
  return div;
}

openBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  const folderPath = await window.vnl.pickFolder();
  if (!folderPath) return;

  folderPathEl.textContent = folderPath;
  summaryEl.innerHTML = "";
  notesEl.innerHTML = "<li>Loading…</li>";

  try {
    const result = await window.vnl.loadFolder(folderPath);
    summaryEl.innerHTML = "";
    summaryEl.appendChild(stat(result.noteCount, "notes"));
    summaryEl.appendChild(stat(result.edgeCount, "edges"));

    notesEl.innerHTML = "";
    for (const note of result.notes) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${note.id}</span><span class="count">${note.neighborCount} link${note.neighborCount === 1 ? "" : "s"}</span>`;
      notesEl.appendChild(li);
    }
    if (result.notes.length === 0) {
      notesEl.innerHTML = "<li>No .md files found in this folder.</li>";
    }
  } catch (err) {
    errorEl.textContent = String(err && err.message ? err.message : err);
    notesEl.innerHTML = "";
  }
});
