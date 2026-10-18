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
    if (data && data.active) role = data.role;
  } catch (error) {
    console.error("Erreur de rôle :", error);
    if (session.user.id === SELLER_USER_ID) role = "admin"; // secours si le script SQL n'est pas encore exécuté
  }
  if (role !== "admin") { setLoggedOut(); return false; }
  loggedIn = true;
  $("loginPanel").classList.add("hidden");
  $("managementPanel").classList.remove("hidden");
  $("whatsappNumber").value = settings.whatsapp || "";
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
  if (!loggedIn || !supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from("orders").select("*, order_items(*)")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const before = orders.filter(needsAction).length;
    const hadLoaded = ordersLoadedAt !== null;
    orders = data || [];
    ordersLoadedAt = new Date();
    ordersError = "";
    if (hadLoaded && orders.filter(needsAction).length > before) toast("Nouvelle commande reçue !");
  } catch (error) {
    console.error("Erreur de chargement des commandes :", error);
    ordersError = "Impossible de charger les commandes. " + (error && error.code === "42P01" || (error && /relation|schema cache|does not exist/i.test(error.message || ""))
      ? "Le script SQL des commandes (étape 10) n'a pas encore été exécuté."
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
    const hay = (o.order_number + " " + o.customer_name + " " + o.customer_phone).toLowerCase();
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
    return `
    <div class="order ${needsAction(o) ? "needs" : ""}">
      <button class="order-head" onclick="toggleOrder(${o.id})" aria-expanded="${open}">
        <span>
          <strong>${safeText(o.order_number)}</strong>
          <span class="stat ${s.css}">${s.label}</span>
          ${needsAction(o) ? '<span class="action">Action requise</span>' : ""}
          <br><span class="small">${safeText(o.customer_name)} · ${formatDate(o.created_at)}</span>
        </span>
        <strong>${formatPrice(o.items_total + (fee || 0))}</strong>
      </button>
      ${open ? orderDetail(o) : ""}
    </div>`;
  }).join("");
}
function orderDetail(o) {
  const s = STATUSES[o.status] || {};
  const fee = o.delivery_fee;
  const items = (o.order_items || []).map(i =>
    `<div class="oi"><span>${i.quantity} × ${safeText(i.product_name)}${i.variant ? " (" + safeText(i.variant) + ")" : ""}<br><small>${formatPrice(i.unit_price)} l'unité</small></span><strong>${formatPrice(i.line_total)}</strong></div>`
  ).join("");
  const waMessage = "Bonjour " + o.customer_name + ", ici KBZ SHOP. Nous avons bien reçu votre commande " + o.order_number + " :\n" +
    (o.order_items || []).map(i => "- " + i.quantity + " x " + i.product_name + (i.variant ? " (" + i.variant + ")" : "")).join("\n") +
    "\nTotal des articles : " + formatPrice(o.items_total) +
    (fee != null ? "\nLivraison : " + formatPrice(fee) : "\nLivraison : à confirmer") +
    "\nPouvons-nous confirmer votre commande ?";
  const history = historyCache[o.id];
  const historyHtml = history
    ? (history.length ? history.map(h => `<div>${formatDate(h.created_at)} · ${safeText(h.changed_by_name || "Système")} : ${safeText(h.note || ((STATUSES[h.from_status] || {}).label ? (STATUSES[h.from_status].label + " → ") : "") + ((STATUSES[h.to_status] || {}).label || h.to_status || ""))}${h.note && h.to_status && h.from_status !== h.to_status ? " (" + safeText((STATUSES[h.to_status] || {}).label || h.to_status) + ")" : ""}</div>`).join("") : "<div>Aucun historique.</div>")
    : "<div>Chargement de l'historique...</div>";
  const final = !s.next && o.status !== "nouvelle";
  return `
  <div class="order-detail">
    <div>
      <strong>${safeText(o.customer_name)}</strong><br>
      <a href="tel:${safeText(o.customer_phone)}">${safeText(o.customer_phone)}</a>
      ${o.delivery_requested ? `<br>Livraison demandée : ${safeText(o.customer_address || "adresse non précisée")}` : "<br>Pas de livraison demandée"}
      ${o.customer_note ? `<br><em>« ${safeText(o.customer_note)} »</em>` : ""}
    </div>
    <div>${items}
      <div class="oi sum"><span>Total des articles</span><strong>${formatPrice(o.items_total)}</strong></div>
      <div class="oi"><span>Livraison</span><strong>${fee == null ? "À confirmer" : formatPrice(fee)}</strong></div>
      ${fee != null ? `<div class="oi sum"><span>Total</span><strong>${formatPrice(o.items_total + fee)}</strong></div>` : ""}
    </div>
    <div class="fee">
      <input id="fee_${o.id}" type="number" min="0" step="50" inputmode="numeric" placeholder="Frais de livraison (FCFA)" value="${fee == null ? "" : fee}">
      <button class="btn line mini" onclick="saveDeliveryFee(${o.id})">Enregistrer</button>
    </div>
    <div class="btns">
      <a class="btn wa mini" style="width:auto" target="_blank" rel="noopener" href="https://wa.me/${waDigits(o.customer_phone)}?text=${encodeURIComponent(waMessage)}">Contacter sur WhatsApp</a>
      ${s.next ? `<button class="btn blue mini" onclick="changeStatus(${o.id}, '${o.status}', '${s.next}')">${s.nextLabel}</button>` : ""}
      ${!final && o.status !== "annulee" ? `<button class="btn line mini danger" onclick="changeStatus(${o.id}, '${o.status}', 'annulee')">Annuler</button>` : ""}
    </div>
    <div class="hist"><strong>Historique</strong>${historyHtml}</div>
  </div>`;
}
async function toggleOrder(id) {
  openOrderId = openOrderId === id ? null : id;
  renderOrders();
  if (openOrderId === id) loadHistory(id);
}
async function loadHistory(id) {
  try {
    const { data, error } = await supabaseClient
      .from("order_history").select("*").eq("order_id", id).order("created_at", { ascending: true });
    if (error) throw error;
    historyCache[id] = data || [];
  } catch (error) {
    console.error("Erreur d'historique :", error);
    historyCache[id] = [];
  }
  if (openOrderId === id) renderOrders();
}
async function changeStatus(id, expected, status) {
  if (!loggedIn || !supabaseClient) return;
  let note = null;
  if (status === "annulee") {
    if (!confirm("Annuler cette commande ?")) return;
    note = prompt("Motif d'annulation (facultatif) :") || null;
  }
  try {
    const { error } = await supabaseClient.rpc("set_order_status", {
      p_order_id: id, p_expected: expected, p_status: status, p_note: note
    });
    if (error) throw error;
    toast("Statut mis à jour");
    delete historyCache[id];
    await loadOrders();
    if (openOrderId === id) loadHistory(id);
  } catch (error) {
    console.error("Erreur de statut :", error);
    alert("Impossible de modifier le statut.\n" + friendlyError(error));
    await loadOrders();
  }
}
async function saveDeliveryFee(id) {
  if (!loggedIn || !supabaseClient) return;
  const raw = $("fee_" + id).value.trim();
  let fee = null;
  if (raw !== "") {
    fee = Number(raw);
    if (!Number.isInteger(fee) || fee < 0 || fee > 1000000) { alert("Entre un montant valide (nombre entier)."); return; }
  }
  try {
    const { error } = await supabaseClient.rpc("set_delivery_fee", { p_order_id: id, p_fee: fee });
    if (error) throw error;
    toast("Frais de livraison enregistrés");
    delete historyCache[id];
    await loadOrders();
    if (openOrderId === id) loadHistory(id);
  } catch (error) {
    console.error("Erreur de frais de livraison :", error);
    alert("Impossible d'enregistrer les frais.\n" + friendlyError(error));
  }
}
