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
/* ---------- Tiroir : panier, formulaire, confirmation ---------- */
function isDrawerOpen() {
  return $("drawer").classList.contains("open");
}
function openCart() {
  if (checkoutStep === "done" && !lastOrder) checkoutStep = "cart";
  $("drawer").classList.add("open");
  $("overlay").classList.add("open");
  $("drawer").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderDrawer();
}
function closeCart() {
  $("drawer").classList.remove("open");
  $("overlay").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  if (checkoutStep === "done") { checkoutStep = "cart"; lastOrder = null; }
}
function recapHtml(ids) {
  const lines = ids.map(id => {
    const p = byId(id);
    const v = (variants[id] || "").trim();
    return `<div><span>${cart[id]} × ${safeText(p.name)}${v ? " (" + safeText(v) + ")" : ""}<br><small>${formatPrice(p.price)} l'unité</small></span><strong>${formatPrice(p.price * cart[id])}</strong></div>`;
  }).join("");
  return `<div class="recap">${lines}
    <div class="sum"><span>Total des articles</span><strong>${formatPrice(cartTotal())}</strong></div>
    <div><span>Livraison</span><span>À confirmer avec le vendeur</span></div>
  </div>`;
}
function renderDrawer() {
  const body = $("drawerBody");
  const foot = $("drawerFoot");
  const ids = cartIds();
  if (checkoutStep === "done" && lastOrder) { renderDone(body, foot); return; }
  if (checkoutStep === "form" && ids.length) {
    $("drawerTitle").textContent = "Ma commande";
    body.innerHTML = `
      <button class="back" onclick="backToCart()">← Retour au panier</button>
      <h3 class="dh">Tes informations</h3>
      <label class="field">Nom *<input id="f_name" value="${safeText(form.name)}" maxlength="80" autocomplete="name" placeholder="Ton nom"></label>
      <label class="field">Numéro de téléphone *<input id="f_phone" value="${safeText(form.phone)}" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="Ex. : 0701020304"></label>
      <label class="check"><input type="checkbox" id="f_delivery" ${form.delivery ? "checked" : ""}> Je souhaite une livraison</label>
      <label class="field ${form.delivery ? "" : "hidden"}" id="addrWrap">Adresse de livraison *<textarea id="f_address" rows="2" maxlength="300" placeholder="Quartier, repère, ville...">${safeText(form.address)}</textarea></label>
      <label class="field">Instructions (facultatif)<textarea id="f_note" rows="2" maxlength="500" placeholder="Une précision pour ta commande...">${safeText(form.note)}</textarea></label>
      <input id="f_website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <h3 class="dh">Récapitulatif</h3>
      ${recapHtml(ids)}
      <div class="err-box ${formError ? "" : "hidden"}" id="formError" role="alert">${safeText(formError)}</div>
      <div id="fallbackWrap" class="${formError ? "" : "hidden"}"></div>`;
    foot.innerHTML = `
      <button class="btn wa" id="submitBtn" onclick="submitOrder()" ${sending ? "disabled" : ""}>${sending ? "Envoi en cours..." : "Envoyer ma commande"}</button>
      <p class="small">Ta commande sera enregistrée, puis tu pourras écrire au vendeur sur WhatsApp. Le montant de la livraison et le paiement sont confirmés avec lui.</p>`;
    renderFallback();
    return;
  }
  checkoutStep = "cart";
  $("drawerTitle").textContent = "Mon panier";
  if (!ids.length) {
    body.innerHTML = `
      <div class="cart-empty">
        <div class="big">🛍️</div>
        <p><strong>Ton panier est vide</strong><br>Ajoute des articles pour commencer.</p>
        <button class="btn blue" onclick="closeCart(); location.hash='catalogue'">Voir les articles</button>
      </div>`;
    foot.innerHTML = "";
    return;
  }
  body.innerHTML = ids.map(id => {
    const product = byId(id);
    return `
    <div class="line">
      <img src="${safeText(product.photo || PLACEHOLDER_IMAGE)}" alt="" onerror="this.onerror=null;this.src=PLACEHOLDER_IMAGE">
      <div>
        <b>${safeText(product.name)}</b>
        <small>${formatPrice(product.price)}</small>
        <div class="qty">
          <button onclick="changeQty('${safeText(id)}', -1)" aria-label="Retirer un ${safeText(product.name)}">−</button>
          <span>${cart[id]}</span>
          <button onclick="changeQty('${safeText(id)}', 1)" aria-label="Ajouter un ${safeText(product.name)}">+</button>
        </div>
        <input class="variant" maxlength="60" placeholder="Taille / couleur (facultatif)" value="${safeText(variants[id] || "")}" oninput="setVariant('${safeText(id)}', this.value)">
      </div>
      <div style="text-align:right">
        <b>${formatPrice(product.price * cart[id])}</b>
        <button class="rm" onclick="removeFromCart('${safeText(id)}')">Retirer</button>
      </div>
    </div>`;
  }).join("");
  foot.innerHTML = `
    <div class="total"><span>Total des articles</span><strong>${formatPrice(cartTotal())}</strong></div>
    <button class="btn wa" onclick="goToForm()">Passer la commande</button>
    <p class="small">Les frais de livraison sont confirmés avec le vendeur.</p>`;
}
function goToForm() {
  if (!cartIds().length) return;
  checkoutStep = "form";
  formError = "";
  if (!requestId) requestId = newRequestId();
  renderDrawer();
  $("drawerBody").scrollTop = 0;
}
function backToCart() {
  readForm();
  checkoutStep = "cart";
  renderDrawer();
}
function newRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function readForm() {
  if (!$("f_name")) return;
  form.name = $("f_name").value;
  form.phone = $("f_phone").value;
  form.delivery = $("f_delivery").checked;
  form.address = $("f_address") ? $("f_address").value : form.address;
  form.note = $("f_note").value;
  form.website = $("f_website").value;
}
$("drawerBody").addEventListener("input", event => {
  if (event.target.id && event.target.id.startsWith("f_")) readForm();
});
$("drawerBody").addEventListener("change", event => {
  if (event.target.id === "f_delivery") {
    readForm();
    $("addrWrap").classList.toggle("hidden", !form.delivery);
  }
});
function showFormError(message) {
  formError = message;
  const box = $("formError");
  if (box) { box.textContent = message; box.classList.toggle("hidden", !message); }
  renderFallback();
}
function buildOrderMessage(order) {
  const lines = order.lines.map(l => "- " + l.qty + " x " + l.name + (l.variant ? " (" + l.variant + ")" : "") + " : " + formatPrice(l.total));
  let message = "Bonjour KBZ SHOP ! Ma commande n° " + order.number + " :\n" + lines.join("\n") +
    "\nTotal des articles : " + formatPrice(order.total) + "\nLivraison : à confirmer" +
    "\nNom : " + order.name;
  if (order.delivery && order.address) message += "\nAdresse : " + order.address;
  return message;
}
function renderFallback() {
  const wrap = $("fallbackWrap");
  if (!wrap) return;
  if (!formError || !settings.whatsapp) { wrap.classList.add("hidden"); wrap.innerHTML = ""; return; }
  readForm();
  const ids = cartIds();
  const lines = ids.map(id => "- " + cart[id] + " x " + byId(id).name + ((variants[id] || "").trim() ? " (" + variants[id].trim() + ")" : ""));
  const message = "Bonjour KBZ SHOP ! Je voulais commander (mon envoi sur le site a échoué) :\n" + lines.join("\n") +
    "\nTotal des articles : " + formatPrice(cartTotal()) + (form.name.trim() ? "\nNom : " + form.name.trim() : "");
  wrap.classList.remove("hidden");
  wrap.innerHTML = `<p class="small" style="margin:10px 0 6px">Tu peux aussi nous écrire directement. <strong>Cette commande ne sera alors pas enregistrée sur le site.</strong></p>
    <a class="btn line" style="width:100%" target="_blank" rel="noopener" href="https://wa.me/${safeText(settings.whatsapp)}?text=${encodeURIComponent(message)}">Écrire sur WhatsApp (commande non enregistrée)</a>`;
}
function orderErrorMessage(error) {
  const text = String((error && error.message) || "");
  if (/failed to fetch|network|load failed/i.test(text)) return "Pas de connexion internet. Vérifie ton réseau puis réessaie.";
  if (error && (error.code === "PGRST202" || /could not find the function/i.test(text))) return "Le système de commande n'est pas encore activé. Écris-nous sur WhatsApp.";
  if (error && error.code === "P0001") return text;
  return "Ta commande n'a pas pu être enregistrée. Réessaie dans un instant.";
}
async function submitOrder() {
  if (sending) return;
  readForm();
  if (form.website) return; // champ piège : les vrais clients ne le voient pas
  const name = form.name.trim();
  const phone = form.phone.replace(/\D/g, "");
  const address = form.address.trim();
  const ids = cartIds();
  if (!ids.length) { showFormError("Ton panier est vide."); return; }
  if (name.length < 2) { showFormError("Entre ton nom."); return; }
  if (!/^[0-9]{8,15}$/.test(phone)) { showFormError("Entre un numéro de téléphone valide."); return; }
  if (form.delivery && !address) { showFormError("Entre ton adresse de livraison."); return; }
  if (!supabaseClient) { showFormError("Service indisponible. Réessaie plus tard."); return; }
  sending = true;
  showFormError("");
  $("submitBtn").disabled = true;
  $("submitBtn").textContent = "Envoi en cours...";
  const snapshot = ids.map(id => {
    const p = byId(id);
    return { qty: cart[id], name: p.name, variant: (variants[id] || "").trim(), total: p.price * cart[id] };
  });
  try {
    const { data, error } = await supabaseClient.rpc("create_order", {
      p_request_id: requestId,
      p_name: name,
      p_phone: phone,
      p_delivery: form.delivery,
      p_address: form.delivery ? address : null,
      p_note: form.note.trim() || null,
      p_items: ids.map(id => ({ product_id: Number(id), quantity: cart[id], variant: (variants[id] || "").trim() }))
    });
    if (error) throw error;
    if (!data || !data.order_number) throw new Error("Réponse inattendue du serveur.");
    lastOrder = {
      number: data.order_number,
      total: Number(data.items_total) || 0,
      lines: snapshot,
      name,
      phone,
      delivery: form.delivery,
      address
    };
    cart = {}; variants = {};
    saveCart();
    form = { name: "", phone: "", delivery: false, address: "", note: "", website: "" };
    requestId = null;
    formError = "";
    checkoutStep = "done";
    renderCartBadge();
    sending = false;
    renderDrawer();
    $("drawerBody").scrollTop = 0;
    loadData().then(() => { renderProducts(); });
    return;
  } catch (error) {
    console.error("Erreur d'envoi de la commande :", error);
    sending = false;
    renderDrawer();
    showFormError(orderErrorMessage(error));
  }
}
function renderDone(body, foot) {
  $("drawerTitle").textContent = "Commande reçue";
  const wa = settings.whatsapp
    ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${safeText(settings.whatsapp)}?text=${encodeURIComponent(buildOrderMessage(lastOrder))}">Écrire au vendeur sur WhatsApp</a>`
    : "";
  body.innerHTML = `
    <div class="success">
      <div class="ok">✅</div>
      <h3 style="margin:8px 0 0">Ta commande est enregistrée</h3>
      <div class="order-no">${safeText(lastOrder.number)}</div>
      <p class="small">Garde ce numéro. Notre équipe te contactera au <strong>${safeText(lastOrder.phone)}</strong> pour confirmer la disponibilité, la livraison et le paiement.</p>
      <p class="small">Tu peux aussi écrire directement au vendeur avec ton numéro de commande. Ce n'est pas obligatoire : ta commande est déjà bien reçue.</p>
    </div>
    <div class="recap">${lastOrder.lines.map(l => `<div><span>${l.qty} × ${safeText(l.name)}${l.variant ? " (" + safeText(l.variant) + ")" : ""}</span><strong>${formatPrice(l.total)}</strong></div>`).join("")}
      <div class="sum"><span>Total des articles</span><strong>${formatPrice(lastOrder.total)}</strong></div>
      <div><span>Livraison</span><span>À confirmer</span></div>
    </div>`;
  foot.innerHTML = `${wa}<button class="btn line" style="width:100%" onclick="closeCart(); location.hash='catalogue'">Continuer mes achats</button>`;
}
/* ---------- Espace gestion : session et rôle ---------- */
function openSeller() {
  $("sellerSection").classList.remove("hidden");
  $("sellerSection").scrollIntoView({ behavior: "smooth" });
  if (loggedIn && currentTab === "orders") { loadOrders(); startOrdersTimer(); }
}
function closeSeller() {
  $("sellerSection").classList.add("hidden");
  stopOrdersTimer();
}
function setLoggedOut() {
  loggedIn = false;
  stopOrdersTimer();
  orders = []; ordersLoadedAt = null; openOrderId = null;
  $("loginPanel").classList.remove("hidden");
  $("managementPanel").classList.add("hidden");
}
async function applySession(session) {
  if (!session || !session.user) { setLoggedOut(); return false; }
  let role = null;
  try {
    const { data, error } = await supabaseClient
      .from("staff").select("role, full_name, active").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    if (data && data.active) r
