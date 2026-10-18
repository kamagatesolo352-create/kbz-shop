/* ---------- Espace gestion : session et rôle ---------- */
let userRole = null;
let userId = null;
const canOrders = () => userRole === "admin" || userRole === "order_manager";
const canProducts = () => userRole === "admin" || userRole === "product_manager";
const isAdminRole = () => userRole === "admin";
function applyRoleUI() {
  $("tabOrders").classList.toggle("hidden", !canOrders());
  $("tabProducts").classList.toggle("hidden", !canProducts());
  $("tabSettings").classList.toggle("hidden", !isAdminRole());
  const team = document.querySelector('a.tab[href="equipe.html"]');
  if (team) team.classList.toggle("hidden", !isAdminRole());
  if (currentTab === "orders" && !canOrders()) currentTab = "products";
  if (currentTab === "products" && !canProducts()) currentTab = "orders";
  if (currentTab === "settings" && !isAdminRole()) currentTab = canOrders() ? "orders" : "products";
}
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
  userRole = null; userId = null;
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
    if (data && data.active) role = data.role;
  } catch (error) {
    console.error("Erreur de rôle :", error);
    if (session.user.id === SELLER_USER_ID) role = "admin"; // secours si le script SQL n'est pas encore exécuté
  }
  if (!["admin", "order_manager", "product_manager"].includes(role)) { setLoggedOut(); return false; }
  loggedIn = true;
  userRole = role;
  userId = session.user.id;
  $("loginPanel").classList.add("hidden");
  $("managementPanel").classList.remove("hidden");
  $("whatsappNumber").value = settings.whatsapp || "";
  applyRoleUI();
  renderSellerProducts();
  showTab(currentTab);
  return true;
}
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabaseClient) { $("loginMessage").textContent = "Service indisponible. Réessaie plus tard."; return; }
  const email = $("sellerEmail").value.trim();
  const password = $("sellerPassword").value;
  const message = $("loginMessage");
  const button = $("loginBtn");
  message.classList.remove("error");
  message.textContent = "Connexion en cours...";
  button.disabled = true;
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const ok = await applySession(data.session);
    if (!ok) {
      await supabaseClient.auth.signOut();
      message.classList.add("error");
      message.textContent = "Ce compte n'a pas accès à l'espace de gestion.";
    } else {
      message.textContent = "";
      $("sellerPassword").value = "";
      await reloadAll();
    }
  } catch (error) {
    console.error("Erreur de connexion :", error);
    message.classList.add("error");
    message.textContent = "Connexion impossible. Vérifie ton e-mail et ton mot de passe.";
  }
  button.disabled = false;
});
async function logoutSeller() {
  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
    }
  } catch (error) {
    console.error("Erreur de déconnexion :", error);
  }
  cancelEdit();
  $("sellerPassword").value = "";
  setLoggedOut();
  closeSeller();
}
function showTab(name) {
  currentTab = name;
  ["orders", "products", "settings"].forEach(t => {
    const pane = $("pane" + t.charAt(0).toUpperCase() + t.slice(1));
    const tab = $("tab" + t.charAt(0).toUpperCase() + t.slice(1));
    pane.classList.toggle("hidden", t !== name);
    tab.setAttribute("aria-selected", String(t === name));
  });
  if (name === "orders") { loadOrders(); startOrdersTimer(); } else { stopOrdersTimer(); }
}
/* ---------- Commandes (tableau de bord) ---------- */
function startOrdersTimer() {
  stopOrdersTimer();
  ordersTimer = setInterval(() => {
    if (document.visibilityState === "visible" && loggedIn && currentTab === "orders" &&
        !$("sellerSection").classList.contains("hidden")) loadOrders();
  }, 30000);
}
function stopOrdersTimer() {
  if (ordersTimer) { clearInterval(ordersTimer); ordersTimer = null; }
}
const needsAction = o => o.status === "nouvelle";
async function loadOrders() {
  if (!loggedIn || !supabaseClient || !canOrders()) return;
  try {
    const { data, error } = await supabaseClient.rpc("staff_orders");
    if (error) throw error;
    const before = orders.filter(needsAction).length;
    const hadLoaded = ordersLoadedAt !== null;
    orders = Array.isArray(data) ? data : [];
    ordersLoadedAt = new Date();
    ordersError = "";
    if (hadLoaded && orders.filter(needsAction).length > before) toast("Nouvelle commande reçue !");
  } catch (error) {
    console.error("Erreur de chargement des commandes :", error);
    ordersError = "Impossible de charger les commandes. " + (error && (error.code === "PGRST202" || error.code === "42P01" || /could not find|does not exist|schema cache/i.test(error.message || ""))
      ? "Le script SQL de l'accès des collaborateurs (étape 11) n'a pas encore été exécuté."
      : friendlyError(error));
  }
  renderOrders();
}
function renderOrders() {
  const list = $("ordersList");
  const pending = orders.filter(needsAction).length;
  const badge = $("ordersBadge");
  badge.textContent = pending;
  badge.classList.toggle("hidden", pending === 0);
  $("ordersSummary").innerHTML = pending
    ? `<strong>${pending}</strong> commande${pending > 1 ? "s" : ""} à traiter`
    : "Aucune commande à traiter pour le moment.";
  $("ordersUpdated").textContent = ordersLoadedAt
    ? "Mis à jour à " + ordersLoadedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + " (actualisation automatique)"
    : "";
  if (ordersError) { list.innerHTML = `<div class="err-box">${safeText(ordersError)}</div>`; return; }
  const q = $("ordersSearch").value.trim().toLowerCase();
  const st = $("ordersStatus").value;
  const filtered = orders.filter(o => {
    const matchesStatus = !st || o.status === st;
    const hay = (o.order_number + " " + o.customer_name + " " + (o.customer_phone || "")).toLowerCase();
    return matchesStatus && (!q || hay.includes(q));
  });
  if (!filtered.length) {
    list.innerHTML = `<p class="small" style="margin-top:12px">${orders.length ? "Aucune commande ne correspond à ta recherche." : "Aucune commande pour le moment."}</p>`;
    return;
  }
  list.innerHTML = filtered.map(o => {
    const s = STATUSES[o.status] || { label: o.status, css: "s-done" };
    const open = openOrderId === o.id;
    const fee = o.delivery_fee;
    const who = o.assigned_name ? " · pris par " + safeText(o.assigned_name) : "";
    return `
    <div class="order ${needsAction(o) ? "needs" : ""}">
      <button class="order-head" onclick="toggleOrder(${o.id})" aria-expanded="${open}">
        <span>
          <strong>${safeText(o.order_number)}</strong>
          <span class="stat ${s.css}">${s.label}</span>
          ${needsAction(o) ? '<span class="action">Action requise</span>' : ""}
          <br><span class="small">${safeText(o.customer_name)} · ${formatDate(o.created_at)}${who}</span>
        </span>
        <strong>${formatPrice(o.items_total + (fee || 0))}</strong>
      </button>
      ${open ? orderDetail(o) : ""}
    </div>`;
  }).join("");
}
function histLine(h) {
  const from = (STATUSES[h.from_status] || {}).label;
  const to = (STATUSES[h.to_status] || {}).label || h.to_status || "";
  const text = h.note
    ? h.note + (h.from_status !== h.to_status && to ? " (" + to + ")" : "")
    : (from ? from + " → " : "") + to;
  return `<div>${formatDate(h.created_at)} · ${safeText(h.changed_by_name || "Système")} : ${safeText(text)}</div>`;
}
function orderDetail(o) {
  const s = STATUSES[o.status] || {};
  const fee = o.delivery_fee;
  const mine = !!o.assigned_to && o.assigned_to === userId;
  const canAct = isAdminRole() || mine;
  const visible = o.customer_phone != null;
  const finished = o.status === "livree" || o.status === "annulee";
  const items = (o.order_items || []).map(i =>
    `<div class="oi"><span>${i.quantity} × ${safeText(i.product_name)}${i.variant ? " (" + safeText(i.variant) + ")" : ""}<br><small>${formatPrice(i.unit_price)} l'unité</small></span><strong>${formatPrice(i.line_total)}</strong></div>`
  ).join("");
  const waMessage = "Bonjour " + o.customer_name + ", ici KBZ SHOP. Nous avons bien reçu votre commande " + o.order_number + " :\n" +
    (o.order_items || []).map(i => "- " + i.quantity + " x " + i.product_name + (i.variant ? " (" + i.variant + ")" : "")).join("\n") +
    "\nTotal des articles : " + formatPrice(o.items_total) +
    (fee != null ? "\nLivraison : " + formatPrice(fee) : "\nLivraison : à confirmer") +
    "\nPouvons-nous confirmer votre commande ?";
  const history = historyCache[o.id];
  const historyHtml = !canAct
    ? "<div>Réservé à la personne en charge.</div>"
    : (history ? (history.length ? history.map(histLine).join("") : "<div>Aucun historique.</div>") : "<div>Chargement de l'historique...</div>");
  const contact = visible
    ? `<a href="tel:${safeText(o.customer_phone)}">${safeText(o.customer_phone)}</a>
       ${o.delivery_requested ? `<br>Livraison demandée : ${safeText(o.customer_address || "adresse non précisée")}` : "<br>Pas de livraison demandée"}
       ${o.customer_note ? `<br><em>« ${safeText(o.customer_note)} »</em>` : ""}`
    : `<span class="small">🔒 Téléphone et adresse visibles après la prise en charge.</span>${o.delivery_requested ? "<br>Livraison demandée" : ""}`;
  const owner = o.assigned_name
    ? `<span class="small">Prise en charge par <strong>${safeText(o.assigned_name)}</strong>${mine ? " (vous)" : ""}</span>`
    : '<span class="small">Pas encore prise en charge</span>';
  let actions = "";
  if (!o.assigned_to && !finished && canOrders()) {
    actions += `<button class="btn blue mini" onclick="claimOrder(${o.id})">Prendre en charge</button>`;
  }
  if (canAct && visible) {
    actions += `<a class="btn wa mini" style="width:auto" target="_blank" rel="noopener" href="https://wa.me/${waDigits(o.customer_phone)}?text=${encodeURIComponent(waMessage)}">Contacter sur WhatsApp</a>`;
  }
  if (canAct && s.next) actions += `<button class="btn blue mini" onclick="changeStatus(${o.id}, '${o.status}', '${s.next}')">${s.nextLabel}</button>`;
  if (canAct && !finished) actions += `<button class="btn line mini danger" onclick="changeStatus(${o.id}, '${o.status}', 'annulee')">Annuler</button>`;
  if (o.assigned_to && canAct && !finished) actions += `<button class="btn line mini" onclick="releaseOrder(${o.id})">Libérer</button>`;
  const feeBox = canAct && !finished
    ? `<div class="fee">
         <input id="fee_${o.id}" type="number" min="0" step="50" inputmode="numeric" placeholder="Frais de livraison (FCFA)" value="${fee == null ? "" : fee}">
         <button class="btn line mini" onclick="saveDeliveryFee(${o.id})">Enregistrer</button>
       </div>`
    : "";
  return `
  <div class="order-detail">
    <div><strong>${safeText(o.customer_name)}</strong><br>${contact}<br>${owner}</div>
    <div>${items}
      <div class="oi sum"><span>Total des articles</span><strong>${formatPrice(o.items_total)}</strong></div>
      <div class="oi"><span>Livraison</span><strong>${fee == null ? "À confirmer" : formatPrice(fee)}</strong></div>
      ${fee != null ? `<div class="oi sum"><span>Total</span><strong>${formatPrice(o.items_total + fee)}</strong></div>` : ""}
    </div>
    ${feeBox}
    <div class="btns">${actions}</div>
    <div class="hist"><strong>Historique</strong>${historyHtml}</div>
  </div>`;
}
