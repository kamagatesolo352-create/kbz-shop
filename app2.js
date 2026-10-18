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
