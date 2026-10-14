
import type { ErrorRequestHandler } from "express";
import { errorResponse } from "../utils/apiResponse";

export const errorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  _next,
) => {
  console.error("Request error:", err);

  return res
    .status(500)
    .json(errorResponse("Internal server error."));
};
