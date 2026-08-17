const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginErrorEl = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const openBtn = document.getElementById("openBtn");
const folderPathEl = document.getElementById("folderPath");
const summaryEl = document.getElementById("summary");
const notesEl = document.getElementById("notes");
const errorEl = document.getElementById("error");

function showApp() {
  loginScreen.style.display = "none";
  appScreen.style.display = "block";
}

function showLogin() {
  loginScreen.style.display = "block";
  appScreen.style.display = "none";
}

async function attemptLogin() {
  loginErrorEl.textContent = "";
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  if (!email || !password) {
    loginErrorEl.textContent = "Enter both email and password.";
    return;
  }
  loginBtn.disabled = true;
  try {
    const result = await window.vnl.login(email, password);
    if (result.ok) {
      showApp();
    } else {
      loginErrorEl.textContent = result.reason || "Login failed.";
    }
  } finally {
    loginBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", attemptLogin);
passwordEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") attemptLogin();
});

logoutBtn.addEventListener("click", async () => {
  await window.vnl.logout();
  emailEl.value = "";
  passwordEl.value = "";
  showLogin();
});

(async function initSession() {
  const session = await window.vnl.getSession();
  if (session) {
    showApp();
  } else {
    showLogin();
  }
})();

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
