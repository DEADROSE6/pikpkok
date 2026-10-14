const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const BUCKET = "videos";

const $ = (id) => document.getElementById(id);
const feed = $("feed");
const liked = new Set(JSON.parse(localStorage.getItem("liked") || "[]"));

/* ---------- FEED ---------- */
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    const v = e.target.querySelector("video");
    if (!v) return;
    if (e.isIntersecting && e.intersectionRatio > 0.7) v.play().catch(() => {});
    else { v.pause(); v.currentTime = 0; }
  });
}, { threshold: [0, 0.7, 1] });

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function renderCard(v) {
  const card = document.createElement("section");
  card.className = "card";
  const media = v.media_type === "image"
    ? `<img src="${esc(v.url)}" alt="${esc(v.caption)}" loading="lazy">`
    : `<video src="${esc(v.url)}" loop muted playsinline preload="metadata"></video>`;
  card.innerHTML = `
    ${media}
    <div class="info"><b>@${esc(v.username || "anónimo")}</b>${esc(v.caption)}</div>
    <div class="side">
      <div><button class="like ${liked.has(v.id) ? "liked" : ""}">♥</button><span>${v.likes ?? 0}</span></div>
    </div>`;
  const video = card.querySelector("video");
  if (video) video.addEventListener("click", () => {
    if (video.muted) { video.muted = false; }
    else video.paused ? video.play() : video.pause();
  });
  const likeBtn = card.querySelector(".like");
  likeBtn.addEventListener("click", async () => {
    if (liked.has(v.id)) return;
    liked.add(v.id);
    localStorage.setItem("liked", JSON.stringify([...liked]));
    likeBtn.classList.add("liked");
    const span = likeBtn.parentElement.querySelector("span");
    span.textContent = Number(span.textContent) + 1;
    await sb.rpc("like_video", { video_id: v.id });
  });
  observer.observe(card);
  return card;
}

/* Bucle infinito: al acercarse al final se vuelve a agregar la lista */
let items = [];
function appendBatch() {
  items.forEach((v) => feed.appendChild(renderCard(v)));
}
feed.addEventListener("scroll", () => {
  if (!items.length) return;
  if (feed.scrollTop + feed.clientHeight * 2 >= feed.scrollHeight) appendBatch();
}, { passive: true });

async function loadFeed() {
  const { data, error } = await sb.from("videos").select("*").order("created_at", { ascending: false }).limit(50);
  feed.innerHTML = "";
  if (error) { feed.innerHTML = `<p class="empty">Error cargando videos: ${esc(error.message)}<br>Revisa config.js y supabase.sql</p>`; return; }
  if (!data.length) { feed.innerHTML = `<p class="empty">Aún no hay videos.<br>¡Toca 📷 y sube el primero!</p>`; return; }
  items = data;
  appendBatch();
  appendBatch();
}
$("btn-refresh").addEventListener("click", () => { feed.scrollTo({ top: 0 }); loadFeed(); });

/* ---------- CÁMARA ---------- */
const modal = $("modal"), preview = $("preview"), statusEl = $("status");
let stream = null, recorder = null, chunks = [], blob = null, facing = "user", mime = "", mode = "video";

function pickMime() {
  const opts = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}
function setStatus(t) { statusEl.textContent = t; }

async function startCamera() {
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
      audio: true,
    });
    preview.srcObject = stream;
    preview.muted = true;
    preview.controls = false;
    setStatus("");
  } catch (err) {
    setStatus("No se pudo acceder a la cámara: " + err.message);
  }
}
function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}
function resetUI() {
  blob = null; chunks = [];
  $("btn-record").hidden = false;
  $("btn-record").classList.remove("recording");
  $("btn-publish").hidden = true;
  $("btn-retake").hidden = true;
  $("caption").hidden = true;
  $("caption").value = "";
  $("btn-flip").hidden = false;
  preview.removeAttribute("src");
  preview.loop = false;
  preview.hidden = false;
  $("photo-preview").hidden = true;
  $("photo-preview").removeAttribute("src");
}
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { alert("Tu navegador no permite acceder a la cámara (se necesita HTTPS)."); return; }
  modal.hidden = false;
  resetUI();
  await startCamera();
}
function closeCamera() {
  if (recorder && recorder.state === "recording") recorder.stop();
  stopStream();
  preview.srcObject = null;
  modal.hidden = true;
  resetUI();
  setStatus("");
}

$("btn-camera").addEventListener("click", openCamera);
$("btn-close").addEventListener("click", closeCamera);
$("btn-flip").addEventListener("click", () => { facing = facing === "user" ? "environment" : "user"; startCamera(); });

$("btn-record").addEventListener("click", () => {
  const btn = $("btn-record");
  if (mode === "photo") { takePhoto(); return; }
  if (recorder && recorder.state === "recording") { recorder.stop(); return; }
  if (!stream) return;
  mime = pickMime();
  chunks = [];
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    blob = new Blob(chunks, { type: recorder.mimeType || mime || "video/webm" });
    stopStream();
    preview.srcObject = null;
    preview.src = URL.createObjectURL(blob);
    preview.muted = false; preview.controls = true; preview.loop = true;
    preview.play().catch(() => {});
    btn.hidden = true; btn.classList.remove("recording");
    $("btn-flip").hidden = true;
    $("btn-publish").hidden = false;
    $("btn-retake").hidden = false;
    $("caption").hidden = false;
    setStatus("");
  };
  recorder.start();
  btn.classList.add("recording");
  setStatus("Grabando… toca de nuevo para detener (máx. 60 s)");
  setTimeout(() => recorder && recorder.state === "recording" && recorder.stop(), 60000);
});

$("btn-retake").addEventListener("click", async () => { resetUI(); await startCamera(); });

function takePhoto() {
  if (!stream || !preview.videoWidth) return;
  const c = document.createElement("canvas");
  c.width = preview.videoWidth; c.height = preview.videoHeight;
  c.getContext("2d").drawImage(preview, 0, 0);
  c.toBlob((b) => {
    if (!b) { setStatus("No se pudo capturar la foto."); return; }
    blob = b;
    stopStream();
    preview.srcObject = null;
    preview.hidden = true;
    const img = $("photo-preview");
    img.src = URL.createObjectURL(b);
    img.hidden = false;
    $("btn-record").hidden = true;
    $("btn-flip").hidden = true;
    $("btn-publish").hidden = false;
    $("btn-retake").hidden = false;
    $("caption").hidden = false;
    setStatus("");
  }, "image/jpeg", 0.9);
}

function setMode(m) {
  if (blob || (recorder && recorder.state === "recording")) return;
  mode = m;
  $("mode-photo").classList.toggle("active", m === "photo");
  $("mode-video").classList.toggle("active", m === "video");
  $("btn-record").classList.toggle("photo", m === "photo");
  setStatus("");
}
$("mode-photo").addEventListener("click", () => setMode("photo"));
$("mode-video").addEventListener("click", () => setMode("video"));

/* ---------- SUBIR A SUPABASE ---------- */
async function uploadBlob(file, caption) {
  const type = file.type || "video/webm";
  const isImage = type.startsWith("image/");
  const ext = isImage
    ? (type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg")
    : (type.includes("mp4") ? "mp4" : type.includes("quicktime") ? "mov" : "webm");
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { contentType: type });
  if (upErr) throw upErr;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const { error: dbErr } = await sb.from("videos").insert({
    url: data.publicUrl, caption, media_type: isImage ? "image" : "video",
    username: localStorage.getItem("username") || null,
  });
  if (dbErr) throw dbErr;
}

$("btn-publish").addEventListener("click", async () => {
  if (!blob) return;
  $("btn-publish").disabled = true;
  setStatus("Subiendo…");
  try {
    await uploadBlob(blob, $("caption").value.trim());
    closeCamera();
    await loadFeed();
  } catch (e) {
    setStatus("Error al subir: " + e.message);
  } finally { $("btn-publish").disabled = false; }
});

$("file-input").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const caption = prompt("Descripción del video (opcional):") ?? "";
  try { await uploadBlob(f, caption.trim()); await loadFeed(); }
  catch (err) { alert("Error al subir: " + err.message); }
  e.target.value = "";
});

if (!localStorage.getItem("username")) {
  const n = prompt("Elige un nombre de usuario (opcional):");
  if (n) localStorage.setItem("username", n.trim().slice(0, 20));
}
loadFeed();
