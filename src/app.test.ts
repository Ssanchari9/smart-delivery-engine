
import request from "supertest";
import app from "./app";
import { pool } from "./config/db";

afterAll(async () => {
  await pool.end();
});

describe("Smart Delivery Engine API", () => {
  test("GET /health returns service status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "smart-delivery-engine",
    });
  });

  test("GET /api/inventory/MOUSE-001 returns inventory", async () => {
    const response = await request(app).get(
      "/api/inventory/MOUSE-001",
    );
    expect(response.body.message).toBe(
  "Inventory retrieved successfully.",
);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(3);
  });

  test("POST /api/delivery-promise selects a warehouse", async () => {
    const response = await request(app)
      .post("/api/delivery-promise")
      .send({ sku: "MOUSE-001", quantity: 1 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.warehouse_name).toBe(
      "Hyderabad Warehouse",
    );
    expect(response.body.message).toBe(
  "Delivery promise calculated successfully.",
);
  });

  test("POST /api/delivery-promise rejects an unknown SKU", async () => {
    const response = await request(app)
      .post("/api/delivery-promise")
      .send({ sku: "UNKNOWN-999", quantity: 1 });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Product not found.");
  });

  test("POST /api/delivery-promise rejects zero quantity", async () => {
    const response = await request(app)
      .post("/api/delivery-promise")
      .send({ sku: "MOUSE-001", quantity: 0 });

    expect(response.status).toBe(400);
  });


  test("POST /api/reservations reserves stock", async () => {
    const sku = "RESERVATION-TEST-001";
    let productId: number | undefined;

    try {
      const productResult = await pool.query(
        `INSERT INTO products (sku, name, price)
         VALUES ($1, 'Reservation Test Product', 100)
         RETURNING id`,
        [sku],
      );

      productId = Number(productResult.rows[0].id);

      const warehouseResult = await pool.query(
        `SELECT id FROM warehouses
         WHERE name = 'Bangalore Warehouse'
         LIMIT 1`,
      );

      const warehouseId = Number(warehouseResult.rows[0].id);

      await pool.query(
        `INSERT INTO inventory (warehouse_id, product_id, quantity)
         VALUES ($1, $2, 5)`,
        [warehouseId, productId],
      );

      const response = await request(app)
        .post("/api/reservations")
        .send({ sku, quantity: 1 });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe(
        "Reservation created successfully.",
      );
      expect(response.body.data.reservation.quantity).toBe(1);
      expect(response.body.data.reservation.status).toBe("CONFIRMED");
      expect(Number(response.body.data.remaining_quantity)).toBe(4);
    } finally {
      if (productId !== undefined) {
        await pool.query(
          "DELETE FROM reservations WHERE product_id = $1",
          [productId],
        );
        await pool.query(
          "DELETE FROM inventory WHERE product_id = $1",
          [productId],
        );
        await pool.query(
          "DELETE FROM products WHERE id = $1",
          [productId],
        );
      }
    }
  });


  test("POST /api/reservations rejects an unknown SKU", async () => {
    const response = await request(app)
      .post("/api/reservations")
      .send({ sku: "UNKNOWN-999", quantity: 1 });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Product not found.");
  });

  test("POST /api/reservations rejects insufficient stock", async () => {
    const response = await request(app)
      .post("/api/reservations")
      .send({ sku: "MOUSE-001", quantity: 1000 });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      "Insufficient stock across all warehouses.",
    );
  });

  test("concurrent reservations do not oversell stock", async () => {
    const client = await pool.connect();
    let productId: number | undefined;
    let warehouseId: number | undefined;

    try {
      await client.query("BEGIN");

      const productResult = await client.query(
        `INSERT INTO products (sku, name, price)
         VALUES ('CONCURRENCY-TEST-001', 'Concurrency Test Product', 100)
         RETURNING id`,
      );
      productId = Number(productResult.rows[0].id);

      const warehouseResult = await client.query(
        `SELECT id FROM warehouses
         WHERE name = 'Bangalore Warehouse'
         LIMIT 1`,
      );
      warehouseId = Number(warehouseResult.rows[0].id);

      await client.query(
        `INSERT INTO inventory (warehouse_id, product_id, quantity)
         VALUES ($1, $2, 5)`,
        [warehouseId, productId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      const responses = await Promise.all([
        request(app)
          .post("/api/reservations")
          .send({ sku: "CONCURRENCY-TEST-001", quantity: 4 }),
        request(app)
          .post("/api/reservations")
          .send({ sku: "CONCURRENCY-TEST-001", quantity: 4 }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);

      const result = await pool.query(
        `SELECT i.quantity,
                COALESCE(SUM(r.quantity) FILTER (
                  WHERE r.status = 'CONFIRMED'
                ), 0) AS reserved_quantity
         FROM inventory i
         LEFT JOIN reservations r
           ON r.product_id = i.product_id
          AND r.warehouse_id = i.warehouse_id
         WHERE i.product_id = $1
           AND i.warehouse_id = $2
         GROUP BY i.quantity`,
        [productId, warehouseId],
      );

      expect(Number(result.rows[0].quantity)).toBe(1);
      expect(Number(result.rows[0].reserved_quantity)).toBe(4);
    } finally {
      await pool.query(
        "DELETE FROM reservations WHERE product_id = $1",
        [productId],
      );
      await pool.query(
        "DELETE FROM inventory WHERE product_id = $1",
        [productId],
      );
      await pool.query(
        "DELETE FROM products WHERE id = $1",
        [productId],
      );
    }
  });


  test("failed reservation insert rolls back stock deduction", async () => {
    const client = await pool.connect();
    let productId: number | undefined;
    let warehouseId: number | undefined;
    const sku = "ROLLBACK-TEST-001";
    const triggerName = "fail_rollback_test_reservation";
    let triggerCreated = false;

    try {
      const productResult = await client.query(
        `INSERT INTO products (sku, name, price)
         VALUES ($1, 'Rollback Test Product', 100)
         RETURNING id`,
        [sku],
      );
      productId = Number(productResult.rows[0].id);

      const warehouseResult = await client.query(
        `SELECT id FROM warehouses
         WHERE name = 'Bangalore Warehouse'
         LIMIT 1`,
      );
      warehouseId = Number(warehouseResult.rows[0].id);

      await client.query(
        `INSERT INTO inventory (warehouse_id, product_id, quantity)
         VALUES ($1, $2, 5)`,
        [warehouseId, productId],
      );

      await client.query(`
        CREATE OR REPLACE FUNCTION reject_rollback_test_reservation()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.product_id = ${productId} THEN
            RAISE EXCEPTION 'Intentional test failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON reservations
        FOR EACH ROW
        EXECUTE FUNCTION reject_rollback_test_reservation();
      `);
      triggerCreated = true;

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      try {
        const response = await request(app)
          .post("/api/reservations")
          .send({ sku, quantity: 4 });

        expect(response.status).toBe(500);
      } finally {
        consoleErrorSpy.mockRestore();
      }

      const result = await pool.query(
        `SELECT i.quantity,
                COUNT(r.id)::int AS reservation_count
         FROM inventory i
         LEFT JOIN reservations r
           ON r.product_id = i.product_id
          AND r.warehouse_id = i.warehouse_id
         WHERE i.product_id = $1
           AND i.warehouse_id = $2
         GROUP BY i.quantity`,
        [productId, warehouseId],
      );

      expect(Number(result.rows[0].quantity)).toBe(5);
      expect(Number(result.rows[0].reservation_count)).toBe(0);
    } finally {
      try {
        if (triggerCreated) {
          await client.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON reservations`,
          );
        }

        await client.query(
          "DROP FUNCTION IF EXISTS reject_rollback_test_reservation()",
        );
      } finally {
        try {
          if (productId !== undefined) {
            await pool.query(
              "DELETE FROM reservations WHERE product_id = $1",
              [productId],
            );
            await pool.query(
              "DELETE FROM inventory WHERE product_id = $1",
              [productId],
            );
            await pool.query(
              "DELETE FROM products WHERE id = $1",
              [productId],
            );
          }
        } finally {
          client.release();
        }
      }
    }
  });
  });
