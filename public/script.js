// Application State & Storage Initialization
let products = [];
let cart = JSON.parse(localStorage.getItem("shopflow_cart")) || [];
let currentUser = JSON.parse(localStorage.getItem("shopflow_user")) || null;
let currentCurrency = "MYR";
let currencyRates = { MYR: 1 };
let deliveryMap = null;
let deliveryMarker = null;

// Route Guard: Restrict admin-only pages from standard users
if ((location.pathname.endsWith("stock.html") || location.pathname.endsWith("orders.html")) && currentUser?.role !== "admin") {
  location.href = "index.html";
}

// Dynamic Navigation UI Updates based on User Role & Session
function syncHeaderNavigation() {
  const nav = document.querySelector("header nav");
  if (!nav) return;
  
  const getLink = href => nav.querySelector(`a[href="${href}"]`);
  const isNotAdmin = currentUser?.role !== "admin";

  if (getLink("stock.html")) getLink("stock.html").style.display = isNotAdmin ? "none" : "";
  if (getLink("orders.html")) getLink("orders.html").style.display = isNotAdmin ? "none" : "";

  const loginLink = getLink("login.html");
  if (loginLink) {
    loginLink.textContent = currentUser ? `Logout (${currentUser.username})` : "Login";
    loginLink.href = currentUser ? "#" : "login.html";
    
    loginLink.onclick = currentUser ? (e) => {
      e.preventDefault();
      const confirmLogout = confirm(`Are you sure you want to log out, ${currentUser.username}?`);
      if (confirmLogout) {
        localStorage.removeItem("shopflow_user");
        location.href = "index.html";
      }
    } : null;
  }
}

// Utility Helpers
const saveCart = () => localStorage.setItem("shopflow_cart", JSON.stringify(cart));
const val = id => document.getElementById(id)?.value.trim();

// Generic Fetch Wrapper for API Requests
async function fetchApi(url, method = "GET", body = null) {
  const options = { method, headers: body ? { "Content-Type": "application/json" } : {} };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Initialize Leaflet Map for Location Selection
function initDeliveryMap() {
  const mapContainer = document.getElementById("deliveryMap");
  if (!mapContainer) return;

  // Default center: Kuala Lumpur (3.139, 101.686)
  deliveryMap = L.map('deliveryMap').setView([3.1390, 101.6869], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(deliveryMap);

  deliveryMarker = L.marker([3.1390, 101.6869], { draggable: true }).addTo(deliveryMap);

  // Update address on marker drag or map click
  deliveryMap.on('click', async (e) => {
    deliveryMarker.setLatLng(e.latlng);
    await reverseGeocode(e.latlng.lat, e.latlng.lng);
  });

  deliveryMarker.on('dragend', async (e) => {
    const pos = deliveryMarker.getLatLng();
    await reverseGeocode(pos.lat, pos.lng);
  });

  // Search Button Event
  document.getElementById("mapSearchBtn")?.addEventListener("click", async () => {
    const query = val("mapSearchInput");
    if (!query) return showMessage("Please enter a location to search.", true);

    try {
      const data = await fetchApi(`/api/location/geocode?q=${encodeURIComponent(query)}`);
      if (!data.length) return showMessage("Location not found on map.", true);

      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);

      deliveryMap.setView([lat, lon], 15);
      deliveryMarker.setLatLng([lat, lon]);
      fillAddressFields(data[0]);
      showMessage(`Location updated: ${data[0].display_name}`);
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  // Postal Code Lookup Event Listener (Zippopotam API Integration)
  document.getElementById("postalCode")?.addEventListener("blur", async () => {
    const zip = val("postalCode");
    const country = document.getElementById("countrySelect")?.value || "MY";
    if (!zip) return;

    try {
      const data = await fetchApi(`/api/location/postal/${country}/${zip}`);
      document.getElementById("shippingCity").value = data.city || "";
      document.getElementById("shippingState").value = data.state || "";
      showMessage(`Postal code lookup successful for ${zip}.`);
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

// Reverse Geocode coordinates to Address fields
async function reverseGeocode(lat, lon) {
  try {
    const data = await fetchApi(`/api/location/geocode?lat=${lat}&lon=${lon}`);
    if (data && data.address) {
      fillAddressFields(data);
      showMessage("Delivery location updated from map.");
    }
  } catch (err) {
    console.log("Reverse geocode error:", err.message);
  }
}

// Fill address inputs
function fillAddressFields(result) {
  const address = result.address || {};
  const displayName = result.display_name || "";

  document.getElementById("shippingAddress").value = displayName;
  document.getElementById("shippingCity").value = address.city || address.town || address.village || address.county || "";
  document.getElementById("shippingState").value = address.state || "";
  if (address.postcode) {
    document.getElementById("postalCode").value = address.postcode;
  }
}

// API 1: Fetch Currency Exchange Rates
async function handleCurrencyChange(e) {
  currentCurrency = e.target.value;
  if (currentCurrency === "MYR") {
    currencyRates.MYR = 1;
    renderProducts();
    return;
  }

  try {
    const data = await fetchApi(`/api/currency/convert?currency=${currentCurrency}&amount=1`);
    currencyRates[currentCurrency] = data.exchangeRate;
    renderProducts();
    showMessage(`Prices converted to ${currentCurrency} (1 MYR = ${data.exchangeRate} ${currentCurrency})`);
  } catch (err) {
    showMessage(err.message, true);
  }
}

// Fetch Initial Product List & Render Dependents
async function loadProducts() {
  try {
    products = await fetchApi("/api/products");
    renderProducts();
    renderStock();
    renderCart();
  } catch (err) { showMessage(err.message, true); }
}

// Filter and Render Public Product Grid with Reviews Section
function renderProducts() {
  const list = document.getElementById("productList");
  if (!list) return;

  const query = val("search") ? val("search").toLowerCase() : "";
  const cat = val("categoryFilter");

  const filtered = products.filter(p => p.name.toLowerCase().includes(query) && (!cat || p.category.toLowerCase() === cat.toLowerCase()));
  if (!filtered.length) return list.innerHTML = "<p>No products found matching your criteria.</p>";

  const rate = currencyRates[currentCurrency] || 1;
  const currencySymbolMap = { MYR: "RM", USD: "$", EUR: "€", GBP: "£", SGD: "S$" };
  const symbol = currencySymbolMap[currentCurrency] || currentCurrency;

  list.innerHTML = filtered.map(p => {
    const isOut = p.stock === 0;
    const isLow = p.stock > 0 && p.stock < 5;
    const badge = isOut ? '<span class="badge badge-out">Out of Stock</span>' : (isLow ? '<span class="badge badge-low">Low Stock</span>' : '');
    const convertedPrice = (Number(p.price) * rate).toFixed(2);

    return `
      <article class="card product-card ${isOut ? 'out-of-stock' : ''}">
        <img src="${escapeHtml(p.image_url || 'default.jpg')}" alt="${escapeHtml(p.name)}" width="150">
        ${badge}
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.category)}</p>
        <p class="price">${symbol} ${convertedPrice}</p>
        <p>${p.stock} in stock</p>
        <button onclick="addToCart(${p.id})" ${isOut ? "disabled" : ""}>${isOut ? "Out of Stock" : "Add to Cart"}</button>
        <button type="button" style="margin-top:5px;" onclick="toggleReviews(${p.id})">Reviews</button>
        <div id="reviews-container-${p.id}" class="reviews-box" style="display:none; width:100%; margin-top:10px;"></div>
      </article>`;
  }).join("");
}

// Fetch & Display Product Reviews
async function toggleReviews(productId) {
  const container = document.getElementById(`reviews-container-${productId}`);
  if (!container) return;

  if (container.style.display === "block") {
    container.style.display = "none";
    return;
  }

  try {
    const reviews = await fetchApi(`/api/products/${productId}/reviews`);
    container.style.display = "block";
    
    let html = `<h4>Product Reviews (${reviews.length})</h4>`;
    if (!reviews.length) {
      html += `<p>No reviews yet. Be the first to review!</p>`;
    } else {
      html += reviews.map(r => `
        <div style="border-top:1px solid #ddd; padding:5px 0;">
          <strong>${escapeHtml(r.reviewer_name)}</strong> — ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}
          <p style="margin:2px 0;">${escapeHtml(r.comment)}</p>
        </div>
      `).join("");
    }

    html += `
      <form onsubmit="submitReview(event, ${productId})" style="margin-top:10px;">
        <input type="text" id="reviewer-${productId}" placeholder="Your Name" required style="width:100%; margin-bottom:4px;">
        <select id="rating-${productId}" required style="width:100%; margin-bottom:4px;">
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </select>
        <input type="text" id="comment-${productId}" placeholder="Your Comment" required style="width:100%; margin-bottom:4px;">
        <button type="submit">Submit Review</button>
      </form>`;

    container.innerHTML = html;
  } catch (err) {
    showMessage(err.message, true);
  }
}

// Submit Review
async function submitReview(e, productId) {
  e.preventDefault();
  const reviewerName = val(`reviewer-${productId}`);
  const rating = Number(val(`rating-${productId}`));
  const comment = val(`comment-${productId}`);

  try {
    const res = await fetchApi(`/api/products/${productId}/reviews`, "POST", { reviewerName, rating, comment });
    showMessage(res.message);
    toggleReviews(productId);
  } catch (err) {
    showMessage(err.message, true);
  }
}

// Event Listeners for Filters & Currency
document.getElementById("search")?.addEventListener("input", renderProducts);
document.getElementById("categoryFilter")?.addEventListener("change", renderProducts);
document.getElementById("currencySelect")?.addEventListener("change", handleCurrencyChange);

// Add Product to Cart with Stock Checks
function addToCart(id) {
  const p = products.find(x => x.id === id);
  if (!p || p.stock <= 0) return showMessage(p ? `Sorry, ${p.name} is out of stock.` : "Product not found.", true);

  const item = cart.find(i => i.id === id);
  if ((item?.quantity || 0) + 1 > p.stock) return showMessage(`Cannot add more ${p.name}. Stock limit reached.`, true);

  item ? item.quantity++ : cart.push({ id, quantity: 1 });
  saveCart();
  renderCart();
  showMessage(`${p.name} added to cart!`);
}

// Render Cart Items & Calculate Total Cost
function renderCart() {
  const box = document.getElementById("cartItems");
  const totalEl = document.getElementById("cartTotal");
  if (!box || !totalEl) return;

  if (!cart.length) {
    box.innerHTML = "<p>Your cart is empty.</p>";
    return totalEl.innerHTML = "<strong>Total: RM 0.00</strong>";
  }

  let total = 0;
  box.innerHTML = cart.map(i => {
    const p = products.find(x => x.id === i.id);
    if (!p) return "";
    total += Number(p.price) * i.quantity;
    return `<div class="card">
      <strong>${escapeHtml(p.name)}</strong> × ${i.quantity}
      <button type="button" onclick="changeQty(${p.id}, 1)">+</button>
      <button type="button" onclick="changeQty(${p.id}, -1)">−</button>
    </div>`;
  }).join("");

  totalEl.innerHTML = `<strong>Total: RM ${total.toFixed(2)}</strong>`;
  updateCartCount();
}

// Update Cart Count Badge in Header Navigation
function updateCartCount() {
  const el = document.getElementById("cartCount");
  if (!el) return;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  el.textContent = totalQty;
  el.style.display = totalQty > 0 ? "inline-flex" : "none";
}

// Modify Item Quantity in Cart
function changeQty(id, amount) {
  const p = products.find(x => x.id === id);
  const item = cart.find(i => i.id === id);
  if (!item) return;

  if (amount > 0 && p && item.quantity + amount > p.stock) return showMessage(`Cannot exceed available stock of ${p.stock}.`, true);

  item.quantity += amount;
  if (item.quantity <= 0) cart = cart.filter(i => i.id !== id);

  saveCart();
  renderCart();
}

// User Authentication: Login Form Submission Handler
document.getElementById("loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await fetchApi("/api/login", "POST", { username: val("username"), password: val("password") });
    currentUser = data.user;
    localStorage.setItem("shopflow_user", JSON.stringify(currentUser));
    showMessage(`Login successful! Welcome ${currentUser.username}.`);
    setTimeout(() => location.href = currentUser.role === "admin" ? "stock.html" : "index.html", 1000);
  } catch (err) { showMessage(err.message, true); }
});

// Shopping Cart: Checkout Submission Handler
document.getElementById("checkoutForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!cart.length) return showMessage("Your cart is empty.", true);

  try {
    const data = await fetchApi("/api/orders", "POST", { customerName: val("customerName"), customerEmail: val("customerEmail"), items: cart });
    showMessage(`Order #${data.orderId} placed successfully! Total: RM ${Number(data.total).toFixed(2)}`);
    cart = [];
    saveCart();
    e.target.reset();
    renderCart();
    await loadProducts();
    if (currentUser?.role === "admin") loadOrders();
  } catch (err) { showMessage(err.message, true); }
});

// Product Form Utilities
const getFormData = () => ({
  name: val("productName"),
  category: val("category"),
  price: Number(val("price")),
  stock: Number(val("stock")),
  image_url: val("imageUrl")
});

const fillForm = (p = {}) => {
  document.getElementById("productId").value = p.id || "";
  document.getElementById("productName").value = p.name || "";
  document.getElementById("category").value = p.category || "";
  document.getElementById("price").value = p.price || "";
  document.getElementById("stock").value = p.stock || "";
  document.getElementById("imageUrl").value = p.image_url || "";
};

// Admin CRUD Operations: Create Product
document.getElementById("productForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await fetchApi("/api/products", "POST", getFormData());
    showMessage(data.message);
    fillForm();
    await loadProducts();
  } catch (err) { showMessage(err.message, true); }
});

// Admin CRUD Operations: Read/Find Product
document.getElementById("readBtn")?.addEventListener("click", async () => {
  const id = val("productId");
  const name = val("productName").toLowerCase();
  try {
    let p = id ? await fetchApi(`/api/products/${id}`) : products.find(x => x.name.toLowerCase().includes(name));
    if (!p) throw new Error("Product not found.");
    fillForm(p);
    showMessage(`Product #${p.id} loaded into form.`);
  } catch (err) { showMessage(err.message, true); }
});

// Admin CRUD Operations: Update Product
document.getElementById("updateBtn")?.addEventListener("click", async () => {
  const id = val("productId");
  if (!id) return showMessage("Select a Product ID to update.", true);
  try {
    const data = await fetchApi(`/api/products/${id}`, "PUT", getFormData());
    showMessage(data.message);
    fillForm();
    await loadProducts();
  } catch (err) { showMessage(err.message, true); }
});

// Form Actions
document.getElementById("deleteBtn")?.addEventListener("click", () => deleteProduct(val("productId")));
document.getElementById("cancelEdit")?.addEventListener("click", () => { fillForm(); showMessage("Form cleared."); });

// Admin CRUD Operations: Delete Product
async function deleteProduct(id) {
  if (!id) return showMessage("Please specify a Product ID.", true);
  if (!confirm(`Delete product #${id}?`)) return;
  try {
    const data = await fetchApi(`/api/products/${id}`, "DELETE");
    showMessage(data.message);
    fillForm();
    await loadProducts();
  } catch (err) { showMessage(err.message, true); }
}

// Render Admin Inventory/Stock Table
function renderStock() {
  const table = document.getElementById("stockTable");
  if (!table || currentUser?.role !== "admin") return;
  if (!products.length) return table.innerHTML = "<p>No products available.</p>";

  table.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Image</th><th>Actions</th></tr></thead>
      <tbody>
      ${products.map(p => `
        <tr>
          <td>#${p.id}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td>
          <td>RM ${Number(p.price).toFixed(2)}</td>
          <td>${p.stock}${p.stock === 0 ? '<span class="badge badge-out">Out</span>' : (p.stock < 5 ? '<span class="badge badge-low">Low</span>' : '')}</td>
          <td>${escapeHtml(p.image_url || 'default.jpg')}</td>
          <td>
            <button type="button" onclick="editProduct(${p.id})">Edit</button>
            <button type="button" onclick="deleteProduct(${p.id})">Delete</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (p) { fillForm(p); showMessage(`Loaded product #${p.id}.`); }
}

// Render Admin Orders Management Table
async function loadOrders() {
  const table = document.getElementById("ordersTable");
  if (!table || currentUser?.role !== "admin") return;
  try {
    const orders = await fetchApi("/api/orders");
    if (!orders.length) return table.innerHTML = "<p>No orders recorded yet.</p>";

    table.innerHTML = `
      <table>
        <thead><tr><th>Order ID</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${orders.map(o => `<tr>
          <td>#${o.id}</td><td>${escapeHtml(o.customer_name)}</td>
          <td>RM ${Number(o.total).toFixed(2)}</td><td>${escapeHtml(o.status)}</td>
          <td>${new Date(o.created_at).toLocaleString()}</td>
          <td><button type="button" onclick="deleteOrder(${o.id})">Delete</button></td>
        </tr>`).join("")}</tbody>
      </table>`;
  } catch (err) { showMessage(err.message, true); }
}

async function deleteOrder(id) {
  if (!confirm(`Delete order #${id}?`)) return;
  try {
    const data = await fetchApi(`/api/orders/${id}`, "DELETE");
    showMessage(data.message);
    loadOrders();
  } catch (err) { showMessage(err.message, true); }
}

function showMessage(text, error = false) {
  const el = document.getElementById("message");
  if (!el) return;
  el.textContent = text;
  el.className = error ? "alert" : "success-message";
}

function escapeHtml(val) {
  return String(val).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

// Application Initialization Entry Point
document.addEventListener("DOMContentLoaded", () => {
  syncHeaderNavigation();
  updateCartCount();
  initDeliveryMap(); // Initialize Leaflet map on cart page
  loadProducts();
  if (currentUser?.role === "admin") loadOrders();
});