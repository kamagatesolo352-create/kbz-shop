/* ---------- Configuration (clé PUBLIQUE uniquement : aucun secret ici) ---------- */
const SUPABASE_URL = "https://ojelswkxcgyyayonvdnk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZNTeFqr0eG6344aaivSzLQ_iOnk8mPW";
// Secours uniquement si la table des rôles n'est pas encore installée. La vraie protection est dans Supabase (RLS).
const SELLER_USER_ID = "81525847-5eab-42ce-b621-95c8bc96241e";
const BUCKET = "product-images";
const CATEGORIES = ["Tous", "Vêtements", "Chaussures", "Accessoires", "Autres"];
const STATUSES = {
  nouvelle:       { label: "Nouvelle",        css: "s-new",   next: "confirmee",      nextLabel: "Confirmer la commande" },
  confirmee:      { label: "Confirmée",       css: "s-ok",    next: "en_preparation", nextLabel: "Passer en préparation" },
  en_preparation: { label: "En préparation",  css: "s-prep",  next: "prete",          nextLabel: "Marquer prête à livrer" },
  prete:          { label: "Prête à livrer",  css: "s-ready", next: "livree",         nextLabel: "Marquer livrée" },
  livree:         { label: "Livrée",          css: "s-done",  next: null },
  annulee:        { label: "Annulée",         css: "s-cancel", next: null }
};
let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
} catch (error) {
  console.error("Supabase indisponible :", error);
}
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="750">
      <rect width="100%" height="100%" fill="#eaeffe"/>
      <text x="50%" y="48%" font-size="54" font-weight="bold" fill="#2447e8"
        text-anchor="middle" font-family="Arial">KBZ SHOP</text>
      <text x="50%" y="56%" font-size="26" fill="#5b6579"
        text-anchor="middle" font-family="Arial">Photo à venir</text>
    </svg>
  `);
let products = [];
let settings = { whatsapp: "" };
let loggedIn = false;
let loadFailed = false;
let loadErrorDetail = "";
let loadedOnce = false;
let editingId = null;
let activeCategory = "Tous";
let cart = {};
let variants = {};
try { cart = JSON.parse(localStorage.getItem("kbz_cart") || "{}") || {}; } catch (e) { cart = {}; }
try { variants = JSON.parse(localStorage.getItem("kbz_variants") || "{}") || {}; } catch (e) { variants = {}; }
let checkoutStep = "cart";   // cart | form | done
let form = { name: "", phone: "", delivery: false, address: "", note: "", website: "" };
let requestId = null;
let sending = false;
let lastOrder = null;
let formError = "";
let orders = [];
let ordersLoadedAt = null;
let ordersError = "";
let ordersTimer = null;
let openOrderId = null;
let currentTab = "orders";
const historyCache = {};
const $ = id => document.getElementById(id);
const byId = id => products.find(p => p.id === String(id));
/* ---------- Utilitaires ---------- */
function formatPrice(price) {
  return Number(price).toLocaleString("fr-FR") + " FCFA";
}
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}
function formatDate(value) {
  try {
    return new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}
function waDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return "225" + digits;
  return digits;
}
let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
function friendlyError(error) {
  const text = String((error && (error.message || error.error_description)) || "");
  if (error && error.code === "P0001") return text;
  if (error && (error.code === "42501" || /row-level security|permission denied|not authorized/i.test(text))) {
    return "Action refusée. Reconnecte-toi avec le compte vendeur.";
  }
  if (/jwt|token|expired/i.test(text)) return "Ta session a expiré. Reconnecte-toi puis réessaie.";
  if (/failed to fetch|network|load failed/i.test(text)) return "Problème de connexion internet. Réessaie.";
  return "Erreur : " + (text || "inconnue");
}
/* ---------- Chargement des données ---------- */
async function loadData() {
  if (!supabaseClient) {
    loadErrorDetail = "La bibliothèque Supabase n'a pas pu se charger (réseau bloqué ?).";
    loadFailed = true; loadedOnce = true; return false;
  }
  try {
    const { data, error } = await supabaseClient
      .from("products").select("*").order("id", { ascending: false });
    if (error) throw error;
    products = (data || []).map(item => ({
      id: String(item.id),
      name: item.name,
      description: item.description || "",
      price: Number(item.price) || 0,
      category: item.category || "",
      stock: Number(item.stock) || 0,
      photo: item.image_url || ""
    }));
    const { data: shopSettings, error: settingsError } = await supabaseClient
      .from("shop_settings").select("whatsapp").eq("id", 1).maybeSingle();
    if (settingsError) throw settingsError;
    settings = { whatsapp: shopSettings?.whatsapp || "" };
    loadFailed = false; loadedOnce = true;
    return true;
  } catch (error) {
    const detail = [error && error.code, error && error.message, error && error.details, error && error.hint]
      .filter(Boolean).join(" | ") || String(error);
    loadErrorDetail = detail;
    console.error("Erreur de chargement : " + detail, error);
    loadFailed = true; loadedOnce = true;
    return false;
  }
}
async function reloadAll() {
  renderProducts(true);
  await loadData();
  renderAll();
}
function renderAll() {
  renderProducts();
  renderSellerProducts();
  renderCartBadge();
  if (isDrawerOpen()) renderDrawer();
  updateWaLink();
}
function updateWaLink() {
  const digits = (settings.whatsapp || "2250508674626").replace(/\D/g, "");
  $("waLink").href = "https://wa.me/" + digits;
}
/* ---------- Catalogue ---------- */
function renderChips() {
  $("chips").innerHTML = CATEGORIES.map(c =>
    `<button class="chip" aria-pressed="${c === activeCategory}" onclick="setCategory('${c}')">${c}</button>`
  ).join("");
}
function setCategory(category, scroll) {
  activeCategory = category;
  renderChips();
  renderProducts();
  if (scroll) $("catalogue").scrollIntoView({ behavior: "smooth" });
}
function renderProducts(loading) {
  const container = $("products");
  if (loading || !loadedOnce) {
    container.innerHTML = '<div class="skel"></div>'.repeat(4);
    return;
  }
  if (loadFailed) {
    container.innerHTML = `
      <div class="empty">
        <h3>Impossible de charger les articles</h3>
        <p>Vérifie ta connexion internet puis réessaie.</p>
        <p class="small">Détail technique : ${safeText(loadErrorDetail)}</p>
        <button class="btn blue" onclick="reloadAll()">Réessayer</button>
      </div>`;
    return;
  }
  const search = $("search").value.toLowerCase().trim();
  const filtered = products.filter(product => {
    const matchesSearch = (product.name + " " + product.description).toLowerCase().includes(search);
    const matchesCategory = activeCategory === "Tous" || product.category === activeCategory;
    return matchesSearch && matchesCategory;
  });
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <h3>Aucun article pour le moment</h3>
        <p>Les nouveaux articles apparaîtront ici lorsqu'ils seront ajoutés.</p>
      </div>`;
    return;
  }
  container.innerHTML = filtered.map(product => {
    const out = Number(product.stock) <= 0;
    const low = !out && Number(product.stock) <= 3;
    return `
    <article class="card">
      <div class="thumb">
        <img src="${safeText(product.photo || PLACEHOLDER_IMAGE)}" alt="${safeText(product.name)}" loading="lazy"
             onerror="this.onerror=null;this.src=PLACEHOLDER_IMAGE">
        ${out ? '<span class="badge out">Rupture de stock</span>' : (low ? `<span class="badge low">Plus que ${Number(product.stock)}</span>` : "")}
      </div>
      <div class="body">
        <span class="cat">${safeText(product.category)}</span>
        <h3>${safeText(product.name)}</h3>
        <div class="desc">${safeText(product.description || "")}</div>
        <div class="price">${formatPrice(product.price)}</div>
        <button class="add" ${out ? "disabled" : ""} onclick="addToCart('${safeText(product.id)}', this)">
          ${out ? "Indisponible" : "+ Ajouter"}
        </button>
      </div>
    </article>`;
  }).join("");
}
/* ---------- Panier ---------- */
function saveCart() {
  try {
    localStorage.setItem("kbz_cart", JSON.stringify(cart));
    localStorage.setItem("kbz_variants", JSON.stringify(variants));
  } catch (e) {}
}
function pruneCart() {
  if (!loadedOnce || loadFailed) return;
  Object.keys(cart).forEach(id => {
    const product = byId(id);
    if (!product || product.stock <= 0) { delete cart[id]; delete variants[id]; return; }
    cart[id] = Math.min(Math.floor(Number(cart[id])) || 0, product.stock);
    if (cart[id] <= 0) { delete cart[id]; delete variants[id]; }
  });
  saveCart();
}
function cartIds() {
  return Object.keys(cart).filter(id => byId(id));
}
function cartTotal() {
  return cartIds().reduce((sum, id) => sum + byId(id).price * cart[id], 0);
}
function renderCartBadge() {
  pruneCart();
  $("cartCount").textContent = cartIds().reduce((sum, id) => sum + cart[id], 0);
}
function addToCart(id, button) {
  const product = byId(id);
  if (!product || product.stock <= 0) return;
  const current = cart[id] || 0;
  if (current >= product.stock) { toast("Stock maximum atteint pour cet article"); return; }
  cart[id] = current + 1;
  saveCart();
  renderCartBadge();
  if (isDrawerOpen()) renderDrawer();
  toast(product.name + " ajouté au panier");
  if (button) { button.classList.remove("pop"); void button.offsetWidth; button.classList.add("pop"); }
}
function changeQty(id, delta) {
  const product = byId(id);
  if (!product || !cart[id]) return;
  const next = cart[id] + delta;
  if (next > product.stock) { toast("Stock maximum atteint"); return; }
  if (next <= 0) { delete cart[id]; delete variants[id]; } else cart[id] = next;
  saveCart();
  renderCartBadge();
  renderDrawer();
}
function removeFromCart(id) {
  delete cart[id];
  delete variants[id];
  saveCart();
  renderCartBadge();
  renderDrawer();
}
function setVariant(id, value) {
  variants[id] = String(value).slice(0, 60);
  saveCart();
}
/* ---------- Chargement des autres fichiers ---------- */
window.addEventListener("error", e => {
  if (window.__kbzReady) return;
  const c = document.getElementById("products");
  if (c) c.innerHTML = '<div class="empty"><h3>Chargement incomplet du site</h3><p class="small">Détail : ' + String(e.message || "erreur").replace(/[<>&]/g, "") + '</p></div>';
});
(function loadParts() {
  const files = ["app2.js?v=11", "app3.js?v=11", "app4.js?v=11"];
  function next(i) {
    if (i >= files.length) return;
    const s = document.createElement("script");
    s.src = files[i];
    s.onload = () => next(i + 1);
    s.onerror = () => {
      const c = document.getElementById("products");
      if (c) c.innerHTML = '<div class="empty"><h3>Chargement incomplet du site</h3><p class="small">Fichier manquant : ' + files[i].split("?")[0] + '</p></div>';
    };
    document.body.appendChild(s);
  }
  next(0);
})();
