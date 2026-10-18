/* ---------- Liste des articles (vendeur) ---------- */
function renderSellerProducts() {
  const container = $("sellerProducts");
  if (!products.length) {
    container.innerHTML = '<p class="small">Tu n’as pas encore ajouté d’article.</p>';
    return;
  }
  container.innerHTML = products.map(product => `
    <div class="item-row">
      <img src="${safeText(product.photo || PLACEHOLDER_IMAGE)}" alt="" onerror="this.onerror=null;this.src=PLACEHOLDER_IMAGE">
      <div>
        <strong>${safeText(product.name)}</strong><br>
        <span class="small">${formatPrice(product.price)} · Stock : ${Number(product.stock)}</span>
      </div>
      <div class="item-actions">
        <button class="btn line" onclick="editProduct('${safeText(product.id)}')">Modifier</button>
        <button class="btn line danger" onclick="deleteProduct('${safeText(product.id)}')">Supprimer</button>
      </div>
    </div>
  `).join("");
}
/* ---------- Photos (Supabase Storage) ---------- */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith("image/")) return reject(new Error("Choisis une image."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire cette image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Cette image ne peut pas être ouverte."));
      image.onload = () => {
        const maxSide = 800;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error("Impossible de préparer l'image.")),
          "image/jpeg", 0.78
        );
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadImage(blob) {
  const path = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
  const { error } = await supabaseClient.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
  return supabaseClient.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
function storagePathFromUrl(url) {
  const match = String(url || "").match(/\/storage\/v1\/object\/public\/product-images\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
async function removeImage(url) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  try {
    const { error } = await supabaseClient.storage.from(BUCKET).remove([path]);
    if (error) throw error;
  } catch (error) {
    console.warn("Photo non supprimée :", error);
  }
}
/* ---------- Ajout / modification d'articles ---------- */
function resetProductForm() {
  $("productForm").reset();
  $("itemStock").value = "1";
}
function cancelEdit() {
  editingId = null;
  resetProductForm();
  $("formTitle").textContent = "Ajouter un article";
  $("saveBtn").textContent = "Enregistrer l'article";
  $("cancelEditBtn").classList.add("hidden");
  $("photoHint").textContent = "Choisis une photo depuis ton téléphone. Les grandes images seront réduites automatiquement.";
}
$("productForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!loggedIn || !supabaseClient) return;
  const name = $("itemName").value.trim();
  const price = Number($("itemPrice").value);
  const category = $("itemCategory").value;
  const stock = Number($("itemStock").value);
  const description = $("itemDescription").value.trim();
  const file = $("itemPhoto").files[0];
  if (!name || !Number.isFinite(price) || price <= 0) { alert("Entre un nom et un prix valide."); return; }
  if (!Number.isInteger(stock) || stock < 0) { alert("Entre un stock valide (nombre entier, 0 ou plus)."); return; }
  const button = $("saveBtn");
  button.disabled = true;
  const wasEditing = editingId;
  let newImageUrl = "";
  try {
    const blob = await resizeImage(file);
    if (blob) newImageUrl = await uploadImage(blob);
    const payload = { name, description, price, category, stock };
    if (newImageUrl) payload.image_url = newImageUrl;
    if (wasEditing) {
      const previous = products.find(item => item.id === wasEditing);
      const { data, error } = await supabaseClient
        .from("products").update(payload).eq("id", Number(wasEditing)).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Modification refusée ou article introuvable (row-level security).");
      if (newImageUrl && previous && previous.photo) await removeImage(previous.photo);
    } else {
      const { data, error } = await supabaseClient
        .from("products").insert([{ ...payload, image_url: newImageUrl || null }]).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Article non enregistré.");
    }
    cancelEdit();
    await reloadAll();
    alert(wasEditing ? "Article modifié !" : "Article ajouté à la boutique !");
  } catch (error) {
    console.error("Erreur d'enregistrement :", error);
    if (newImageUrl) await removeImage(newImageUrl);
    alert("Impossible d'enregistrer l'article.\n" + friendlyError(error));
  }
  button.disabled = false;
});
function editProduct(id) {
  if (!loggedIn) return;
  const product = products.find(item => item.id === id);
  if (!product) return;
  editingId = id;
  $("itemName").value = product.name;
  $("itemPrice").value = product.price;
  $("itemCategory").value = product.category;
  $("itemStock").value = product.stock;
  $("itemDescription").value = product.description || "";
  $("itemPhoto").value = "";
  $("formTitle").textContent = "Modifier l'article";
  $("saveBtn").textContent = "Enregistrer les modifications";
  $("cancelEditBtn").classList.remove("hidden");
  $("photoHint").textContent = "Laisse vide pour garder la photo actuelle, ou choisis-en une nouvelle.";
  $("productForm").scrollIntoView({ behavior: "smooth" });
}
async function deleteProduct(id) {
  if (!loggedIn || !supabaseClient) return;
  if (!confirm("Veux-tu vraiment supprimer cet article ?")) return;
  const product = products.find(item => item.id === id);
  try {
    const { data, error } = await supabaseClient
      .from("products").delete().eq("id", Number(id)).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Suppression refusée ou article introuvable (row-level security).");
    if (product && product.photo) await removeImage(product.photo);
    if (editingId === id) cancelEdit();
    await reloadAll();
    alert("Article supprimé de la boutique !");
  } catch (error) {
    console.error("Erreur de suppression :", error);
    alert("Impossible de supprimer cet article.\n" + friendlyError(error));
  }
}
/* ---------- Réglages WhatsApp ---------- */
async function saveSettings() {
  if (!loggedIn || !supabaseClient) return;
  let whatsapp = $("whatsappNumber").value.trim();
  whatsapp = whatsapp.replace(/[\s()+.-]/g, "");
  if (whatsapp && !/^\d{8,15}$/.test(whatsapp)) {
    alert("Vérifie le numéro WhatsApp. Utilise uniquement les chiffres avec l'indicatif du pays.");
    return;
  }
  const button = $("settingsBtn");
  button.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from("shop_settings").update({ whatsapp }).eq("id", 1).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      const { error: insertError } = await supabaseClient
        .from("shop_settings").insert([{ id: 1, whatsapp }]);
      if (insertError) throw insertError;
    }
    const { data: saved, error: readError } = await supabaseClient
      .from("shop_settings").select("whatsapp").eq("id", 1).maybeSingle();
    if (readError) throw readError;
    settings = { whatsapp: saved?.whatsapp || "" };
    $("whatsappNumber").value = settings.whatsapp;
    updateWaLink();
    if (settings.whatsapp !== whatsapp) throw new Error("Le numéro n'a pas été enregistré.");
    alert("Réglages enregistrés dans la boutique !");
  } catch (error) {
    console.error("Erreur d'enregistrement des réglages :", error);
    alert("Impossible d'enregistrer les réglages.\n" + friendlyError(error));
  }
  button.disabled = false;
}
/* ---------- Démarrage ---------- */
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeCart();
});
$("year").textContent = new Date().getFullYear();
renderChips();
renderProducts(true);
renderCartBadge();
updateWaLink();
if (location.hash === "#vendeur") openSeller();
(async () => {
  await loadData();
  renderAll();
  if (supabaseClient) {
    try {
      const { data } = await supabaseClient.auth.getSession();
      await applySession(data.session);
    } catch (error) {
      console.error("Erreur de session :", error);
    }
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setLoggedOut();
    });
  }
})();
window.__kbzReady = true;
