
import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, errorResponse } from "../utils/apiResponse";

const router = Router();

const skuSchema = z
  .string()
  .trim()
  .min(1, "SKU is required")
  .max(50, "SKU is too long");

router.get(
  "/:sku",
  asyncHandler(async (req, res) => {
    const result = skuSchema.safeParse(req.params.sku);

    if (!result.success) {
      return res.status(400).json(errorResponse("Invalid SKU"));
    }

    const query = `
      SELECT
        p.sku,
        p.name AS product_name,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        w.city,
        i.quantity,
        w.shipping_cost,
        w.delivery_days
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      JOIN warehouses w ON w.id = i.warehouse_id
      WHERE p.sku = $1
      ORDER BY w.name;
    `;

    const { rows } = await pool.query(query, [result.data]);

    if (rows.length === 0) {
      return res
        .status(404)
        .json(errorResponse("Product not found"));
    }

    return res.status(200).json(
      successResponse("Inventory retrieved successfully.", rows),
    );
  }),
);

export default router;
