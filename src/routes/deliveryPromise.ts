
import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { asyncHandler } from "../utils/asyncHandler";
import {
  successResponse,
  errorResponse,
} from "../utils/apiResponse";

const router = Router();

const promiseSchema = z.object({
  sku: z.string().trim().min(1).max(50),
  quantity: z.coerce.number().int().positive().max(10000),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = promiseSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ...errorResponse(
          "Provide a valid SKU and positive integer quantity.",
        ),
        errors: parsed.error.issues,
      });
    }

    const { sku, quantity } = parsed.data;

    const productResult = await pool.query(
      "SELECT id, sku, name FROM products WHERE sku = $1",
      [sku],
    );

    if (productResult.rows.length === 0) {
      return res
        .status(404)
        .json(errorResponse("Product not found."));
    }

    const result = await pool.query(
      `SELECT
         w.id AS warehouse_id,
         w.name AS warehouse_name,
         w.city,
         i.quantity AS available_quantity,
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
       LIMIT 1`,
      [productResult.rows[0].id, quantity],
    );

    if (result.rows.length === 0) {
      return res
        .status(409)
        .json(
          errorResponse("Insufficient stock across all warehouses."),
        );
    }

    const warehouse = result.rows[0];

    return res.status(200).json(
      successResponse("Delivery promise calculated successfully.", {
        sku,
        product_name: productResult.rows[0].name,
        requested_quantity: quantity,
        warehouse_id: warehouse.warehouse_id,
        warehouse_name: warehouse.warehouse_name,
        city: warehouse.city,
        available_quantity: warehouse.available_quantity,
        shipping_cost: Number(warehouse.shipping_cost),
        estimated_delivery_days: warehouse.delivery_days,
      }),
    );
  }),
);

export default router;
