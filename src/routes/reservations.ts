
import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../config/db";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, errorResponse } from "../utils/apiResponse";

const router = Router();

const reservationSchema = z.object({
  sku: z.string().trim().min(1).max(50),
  quantity: z.coerce.number().int().positive().max(10000),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = reservationSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ...errorResponse(
          "Provide a valid SKU and positive integer quantity.",
        ),
        errors: parsed.error.issues,
      });
    }

    const { sku, quantity } = parsed.data;
    let client: PoolClient | undefined;
    let transactionStarted = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionStarted = true;

      const productResult = await client.query(
        "SELECT id, sku, name FROM products WHERE sku = $1",
        [sku],
      );

      if (productResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json(
          errorResponse("Product not found."),
        );
      }

      const product = productResult.rows[0];

      const inventoryResult = await client.query(
        `SELECT
           i.warehouse_id,
           i.quantity AS available_quantity,
           w.name AS warehouse_name,
           w.city,
           w.shipping_cost,
           w.delivery_days
         FROM inventory i
         JOIN warehouses w ON w.id = i.warehouse_id
         WHERE i.product_id = $1
           AND i.quantity >= $2
         ORDER BY
           w.delivery_days ASC,
           w.shipping_cost ASC,
           i.quantity DESC,
           w.id ASC
         LIMIT 1
         FOR UPDATE OF i`,
        [product.id, quantity],
      );

      if (inventoryResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(409).json(
          errorResponse(
            "Insufficient stock across all warehouses.",
          ),
        );
      }

      const warehouse = inventoryResult.rows[0];

      const stockResult = await client.query(
        `UPDATE inventory
         SET quantity = quantity - $1,
             updated_at = NOW()
         WHERE warehouse_id = $2
           AND product_id = $3
           AND quantity >= $1
         RETURNING quantity`,
        [quantity, warehouse.warehouse_id, product.id],
      );

      if (stockResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(409).json(
          errorResponse(
            "Stock is no longer available. Please try again.",
          ),
        );
      }

      const reservationResult = await client.query(
        `INSERT INTO reservations (product_id, warehouse_id, quantity)
         VALUES ($1, $2, $3)
         RETURNING id, product_id, warehouse_id, quantity, status, created_at`,
        [product.id, warehouse.warehouse_id, quantity],
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json(
        successResponse("Reservation created successfully.", {
          reservation: reservationResult.rows[0],
          sku: product.sku,
          product_name: product.name,
          warehouse_name: warehouse.warehouse_name,
          city: warehouse.city,
          remaining_quantity: stockResult.rows[0].quantity,
          shipping_cost: Number(warehouse.shipping_cost),
          estimated_delivery_days: warehouse.delivery_days,
        }),
      );
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original error.
        }
      }

      throw error;
    } finally {
      client?.release();
    }
  }),
);

export default router;
