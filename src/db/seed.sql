INSERT INTO warehouses (name, city, shipping_cost, delivery_days)
VALUES
  ('Hyderabad Warehouse', 'Hyderabad', 50.00, 1),
  ('Bangalore Warehouse', 'Bangalore', 70.00, 2),
  ('Chennai Warehouse', 'Chennai', 60.00, 2);

INSERT INTO products (sku, name, price)
VALUES
  ('MOUSE-001', 'Wireless Mouse', 799.00),
  ('KEYBOARD-001', 'Mechanical Keyboard', 2499.00),
  ('HEADPHONE-001', 'Wireless Headphones', 1999.00);

INSERT INTO inventory (warehouse_id, product_id, quantity)
SELECT w.id, p.id, v.quantity
FROM (
  VALUES
    ('Hyderabad Warehouse', 'MOUSE-001', 20),
    ('Hyderabad Warehouse', 'KEYBOARD-001', 8),
    ('Hyderabad Warehouse', 'HEADPHONE-001', 0),
    ('Bangalore Warehouse', 'MOUSE-001', 5),
    ('Bangalore Warehouse', 'KEYBOARD-001', 15),
    ('Bangalore Warehouse', 'HEADPHONE-001', 12),
    ('Chennai Warehouse', 'MOUSE-001', 10),
    ('Chennai Warehouse', 'KEYBOARD-001', 0),
    ('Chennai Warehouse', 'HEADPHONE-001', 7)
) AS v(warehouse_name, sku, quantity)
JOIN warehouses w ON w.name = v.warehouse_name
JOIN products p ON p.sku = v.sku
ON CONFLICT (warehouse_id, product_id)
DO UPDATE SET quantity = EXCLUDED.quantity,
              updated_at = CURRENT_TIMESTAMP;