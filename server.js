// Module Dependencies
require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const path = require("path");
const bcrypt = require("bcryptjs");
const { body, param, query, validationResult } = require("express-validator");

// Server Configuration
const app = express();
const PORT = process.env.PORT || 3000;

// MySQL Database Connection Pool Setup
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ecommerce_db"
});
const db = pool.promise();

// Express Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Centralized Error Response Helper
const handleError = (res, err, msg = "Server error", status = 500) => 
  res.status(status).json({ error: err?.message || msg });

// Validation Middleware Handler
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
};

// ==========================================
// TASK 1: EXTERNAL THIRD-PARTY WEB APIS
// ==========================================

// API 1: Currency Exchange Rates Gateway API
app.get("/api/currency/convert", 
  [
    query("currency").optional().isString().isLength({ min: 3, max: 3 }).trim().escape(),
    query("amount").optional().isFloat({ min: 0 }).toFloat(),
    validateRequest
  ],
  async (req, res) => {
    const targetCurrency = (req.query.currency || "USD").toUpperCase();
    const basePrice = req.query.amount || 0;

    try {
      const response = await fetch(`https://open.er-api.com/v6/latest/MYR`);
      if (!response.ok) throw new Error("Unable to retrieve currency conversion data.");
      
      const data = await response.json();
      const rate = data.rates[targetCurrency];

      if (!rate) {
        return handleError(res, null, `Currency code '${targetCurrency}' is not supported.`, 400);
      }

      const convertedAmount = (basePrice * rate).toFixed(2);
      
      res.json({
        baseCurrency: "MYR",
        targetCurrency,
        exchangeRate: rate,
        originalAmount: basePrice,
        convertedAmount: Number(convertedAmount),
        lastUpdated: data.time_last_update_utc
      });
    } catch (err) {
      handleError(res, err, "Currency service unavailable.");
    }
  }
);

// API 3: Shipping Address & Postal Code Lookup API
app.get("/api/location/postal/:country/:zip", 
  [
    param("country").isString().isLength({ min: 2, max: 2 }).trim().escape(),
    param("zip").isString().trim().escape(),
    validateRequest
  ],
  async (req, res) => {
    const { country, zip } = req.params;

    try {
      const response = await fetch(`https://api.zippopotam.us/${country}/${zip}`);
      if (response.status === 404) {
        return handleError(res, null, "Invalid or unrecognized postal code.", 404);
      }
      if (!response.ok) throw new Error("Address validation service error.");

      const data = await response.json();
      const place = data.places[0];

      res.json({
        postcode: data["post code"],
        country: data.country,
        countryAbbreviation: data["country abbreviation"],
        city: place["place name"],
        state: place.state,
        stateAbbreviation: place["state abbreviation"]
      });
    } catch (err) {
      handleError(res, err, "Postal code validation failed.");
    }
  }
);

// API 5: Map Geocoding & Reverse Lookup API (OpenStreetMap Nominatim Gateway)
app.get("/api/location/geocode", 
  [
    query("q").optional().isString().trim(),
    query("lat").optional().isFloat(),
    query("lon").optional().isFloat(),
    validateRequest
  ],
  async (req, res) => {
    const { q, lat, lon } = req.query;
    try {
      let url = "";
      if (lat && lon) {
        url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
      } else if (q) {
        url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;
      } else {
        return handleError(res, null, "Provide either search query 'q' or coordinates 'lat' and 'lon'.", 400);
      }

      const response = await fetch(url, { headers: { "User-Agent": "ShopFlow-ECommerce-App" } });
      if (!response.ok) throw new Error("Map geocoding service error.");
      
      const data = await response.json();
      res.json(data);
    } catch (err) {
      handleError(res, err, "Map geocoding service unavailable.");
    }
  }
);

// ==========================================
// TASK 2: FEATURE EXTENSION - REVIEWS CRUD
// ==========================================

// CREATE: Add new product review (Validated & Parameterized)
app.post("/api/products/:id/reviews", 
  [
    param("id").isInt({ min: 1 }).toInt(),
    body("reviewerName").isString().trim().notEmpty().withMessage("Reviewer name is required.").escape(),
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5."),
    body("comment").isString().trim().notEmpty().withMessage("Comment cannot be empty.").escape(),
    validateRequest
  ],
  async (req, res) => {
    const productId = req.params.id;
    const { reviewerName, rating, comment } = req.body;

    const conn = await pool.promise().getConnection();
    try {
      await conn.beginTransaction();

      const [products] = await conn.query("SELECT id FROM products WHERE id = ?", [productId]);
      if (!products.length) {
        await conn.rollback();
        conn.release();
        return handleError(res, null, "Product not found.", 404);
      }

      const [result] = await conn.query(
        "INSERT INTO product_reviews (product_id, reviewer_name, rating, comment) VALUES (?, ?, ?, ?)",
        [productId, reviewerName, rating, comment]
      );

      await conn.commit();
      res.status(201).json({ message: "Review posted successfully.", reviewId: result.insertId });
    } catch (err) {
      await conn.rollback();
      handleError(res, err);
    } finally {
      conn.release();
    }
  }
);

// READ: Get all reviews for a specific product
app.get("/api/products/:id/reviews", 
  [
    param("id").isInt({ min: 1 }).toInt(),
    validateRequest
  ],
  async (req, res) => {
    try {
      const [reviews] = await db.query(
        "SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC",
        [req.params.id]
      );
      res.json(reviews);
    } catch (err) {
      handleError(res, err);
    }
  }
);

// UPDATE: Update existing review
app.put("/api/reviews/:reviewId", 
  [
    param("reviewId").isInt({ min: 1 }).toInt(),
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5."),
    body("comment").isString().trim().notEmpty().withMessage("Comment is required.").escape(),
    validateRequest
  ],
  async (req, res) => {
    const { rating, comment } = req.body;

    try {
      const [resDb] = await db.query(
        "UPDATE product_reviews SET rating = ?, comment = ? WHERE id = ?",
        [rating, comment, req.params.reviewId]
      );
      if (!resDb.affectedRows) return handleError(res, null, "Review not found.", 404);
      res.json({ message: "Review updated successfully." });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// DELETE: Delete review by ID
app.delete("/api/reviews/:reviewId", 
  [
    param("reviewId").isInt({ min: 1 }).toInt(),
    validateRequest
  ],
  async (req, res) => {
    try {
      const [resDb] = await db.query("DELETE FROM product_reviews WHERE id = ?", [req.params.reviewId]);
      if (!resDb.affectedRows) return handleError(res, null, "Review not found.", 404);
      res.json({ message: "Review deleted successfully." });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// ==========================================
// TASK 3: SECURE AUTHENTICATION & CORE ENDPOINTS
// ==========================================

// User Registration: Register User with Bcrypt Password Hashing
app.post("/api/register",
  [
    body("username").isString().trim().isLength({ min: 3, max: 30 }).withMessage("Username must be 3-30 characters.").escape(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
    validateRequest
  ],
  async (req, res) => {
    const { username, password, role = "user" } = req.body;

    try {
      const [existing] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
      if (existing.length) return handleError(res, null, "Username is already taken.", 400);

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const [resDb] = await db.query(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [username, hashedPassword, role]
      );

      res.status(201).json({ message: "User registered successfully.", userId: resDb.insertId });
    } catch (err) { handleError(res, err); }
  }
);

// User Authentication: Login Handler with Dual Password Verification
app.post("/api/login", 
  [
    body("username").isString().trim().notEmpty().withMessage("Username is required.").escape(),
    body("password").isString().notEmpty().withMessage("Password is required."),
    validateRequest
  ],
  async (req, res) => {
    const { username, password } = req.body;

    try {
      const [users] = await db.query("SELECT id, username, password, role FROM users WHERE username = ?", [username]);
      if (!users.length) return handleError(res, null, "Invalid username or password.", 401);

      const user = users[0];

      let isMatch = false;
      if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        isMatch = (password === user.password);
      }

      if (!isMatch) return handleError(res, null, "Invalid username or password.", 401);

      res.json({ 
        message: "Login successful", 
        user: { id: user.id, username: user.username, role: user.role } 
      });
    } catch (err) { handleError(res, err); }
  }
);

// Product API: Fetch All Products
app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products ORDER BY id DESC");
    res.json(rows);
  } catch (err) { handleError(res, err); }
});

// Product API: Fetch Single Product by ID
app.get("/api/products/:id", 
  [
    param("id").isInt({ min: 1 }).toInt(),
    validateRequest
  ],
  async (req, res) => {
    try {
      const [rows] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
      if (!rows.length) return handleError(res, null, "Product not found.", 404);
      res.json(rows[0]);
    } catch (err) { handleError(res, err); }
  }
);

// Product API: Create New Product
app.post("/api/products", 
  [
    body("name").isString().trim().notEmpty().withMessage("Product name is required.").escape(),
    body("category").isString().trim().notEmpty().withMessage("Category is required.").escape(),
    body("price").isFloat({ min: 0.01 }).withMessage("Price must be a positive number.").toFloat(),
    body("stock").isInt({ min: 0 }).withMessage("Stock must be a non-negative integer.").toInt(),
    body("image_url").optional().isString().trim().escape(),
    validateRequest
  ],
  async (req, res) => {
    const { name, category, price, stock, image_url } = req.body;
    const image = image_url?.trim() || "default.jpg";

    try {
      const [resDb] = await db.query(
        "INSERT INTO products (name, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?)",
        [name, category, price, stock, image]
      );
      res.status(201).json({ message: "Product created", id: resDb.insertId });
    } catch (err) { handleError(res, err); }
  }
);

// Product API: Update Existing Product
app.put("/api/products/:id", 
  [
    param("id").isInt({ min: 1 }).toInt(),
    body("name").isString().trim().notEmpty().escape(),
    body("category").isString().trim().notEmpty().escape(),
    body("price").isFloat({ min: 0.01 }).toFloat(),
    body("stock").isInt({ min: 0 }).toInt(),
    body("image_url").optional().isString().trim().escape(),
    validateRequest
  ],
  async (req, res) => {
    const { name, category, price, stock, image_url } = req.body;
    const image = image_url?.trim() || "default.jpg";

    try {
      const [resDb] = await db.query(
        "UPDATE products SET name=?, category=?, price=?, stock=?, image_url=? WHERE id=?",
        [name, category, price, stock, image, req.params.id]
      );
      if (!resDb.affectedRows) return handleError(res, null, "Product not found.", 404);
      res.json({ message: "Product updated" });
    } catch (err) { handleError(res, err); }
  }
);

// Product API: Delete Product
app.delete("/api/products/:id", 
  [
    param("id").isInt({ min: 1 }).toInt(),
    validateRequest
  ],
  async (req, res) => {
    try {
      const [resDb] = await db.query("DELETE FROM products WHERE id=?", [req.params.id]);
      if (!resDb.affectedRows) return handleError(res, null, "Product not found.", 404);
      res.json({ message: "Product deleted" });
    } catch (err) { handleError(res, err); }
  }
);

// Order Processing: Place Order with Validation
app.post("/api/orders", 
  [
    body("customerName").isString().trim().notEmpty().withMessage("Customer name is required.").escape(),
    body("customerEmail").isEmail().normalizeEmail().withMessage("Valid email address required."),
    body("items").isArray({ min: 1 }).withMessage("Cart items must be a non-empty array."),
    body("items.*.id").isInt({ min: 1 }).toInt(),
    body("items.*.quantity").isInt({ min: 1 }).toInt(),
    validateRequest
  ],
  async (req, res) => {
    const { customerName, customerEmail, items } = req.body;

    const conn = await pool.promise().getConnection();
    try {
      const productIds = items.map(i => i.id);
      const [products] = await conn.query(`SELECT * FROM products WHERE id IN (?)`, [productIds]);

      let total = 0;
      for (const item of items) {
        const p = products.find(prod => prod.id === Number(item.id));
        if (!p || item.quantity < 1 || p.stock < item.quantity) {
          conn.release();
          return handleError(res, null, "Invalid product or stock limit reached.", 400);
        }
        total += Number(p.price) * item.quantity;
      }

      await conn.beginTransaction();
      const [ord] = await conn.query(
        "INSERT INTO orders (customer_name, customer_email, total, status) VALUES (?, ?, ?, 'Pending')",
        [customerName, customerEmail, total]
      );

      const orderId = ord.insertId;
      for (const item of items) {
        const p = products.find(prod => prod.id === Number(item.id));
        await conn.query("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)", [orderId, p.id, item.quantity, p.price]);
        await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [item.quantity, p.id]);
      }

      await conn.commit();
      res.status(201).json({ message: "Order placed successfully", orderId, total });
    } catch (err) {
      await conn.rollback();
      handleError(res, err);
    } finally {
      conn.release();
    }
  }
);

// Order Management: Fetch All Orders
app.get("/api/orders", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(rows);
  } catch (err) { handleError(res, err); }
});

// Order Management: Delete Order Record
app.delete("/api/orders/:id", 
  [
    param("id").isInt({ min: 1 }).toInt(),
    validateRequest
  ],
  async (req, res) => {
    try {
      const [resDb] = await db.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
      if (!resDb.affectedRows) return handleError(res, null, "Order not found.", 404);
      res.json({ message: "Order deleted successfully." });
    } catch (err) { handleError(res, err); }
  }
);

// Start Express HTTP Server
app.listen(PORT, () => {
  console.log(`E-commerce system running at http://localhost:${PORT}`);
});