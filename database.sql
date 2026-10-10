CREATE DATABASE IF NOT EXISTS ecommerce_db;
USE ecommerce_db;

-- Drop child tables first to avoid foreign key constraint errors
DROP TABLE IF EXISTS product_reviews;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

-- User Table with Hash Length Support
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'admin'
);

-- Seed Default Admin User (Username: admin | Password: admin123 hashed via bcrypt)
INSERT INTO users (username, password, role) VALUES 
('admin', '$2a$10$8K1p/a0dL1LXMIgoEDFrw.a2D3O6p.g9lV3L9.vGkX8Fk7s0w2s2a', 'admin');

-- Products Table
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  image_url VARCHAR(255) DEFAULT 'default.jpg',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders Table
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  customer_email VARCHAR(120) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order Items Table
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

INSERT INTO products (name, category, price, stock, image_url) VALUES
('Wireless Headphones', 'Electronics', 129.90, 20, 'Wireless Headphones.jpg'),
('Smart Watch', 'Electronics', 199.90, 15, 'Smart Watch.png'),
('Backpack', 'Fashion', 79.90, 25, 'Backpack.jpg'),
('USB-C Cable', 'Accessories', 29.90, 40, 'USB-C Cable.jpg'),
('Running Shoes', 'Sports', 159.90, 12, 'Running Shoes.jpg');

-- Product Reviews Table
CREATE TABLE product_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  reviewer_name VARCHAR(100) NOT NULL,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

INSERT INTO product_reviews (product_id, reviewer_name, rating, comment) VALUES
(1, 'Alex Tan', 5, 'Exceptional quality! Exceeded my expectations for the price.'),
(1, 'Sarah Jenkins', 4, 'Great item overall. Fast shipping and solid build quality.'),
(2, 'Michael Chen', 5, 'Works perfectly right out of the box. Highly recommended!'),
(2, 'Emily Wong', 3, 'Decent quality, but delivery took a day longer than expected.'),
(3, 'David Smith', 5, 'Fantastic product! Will definitely be buying from ShopFlow again.');