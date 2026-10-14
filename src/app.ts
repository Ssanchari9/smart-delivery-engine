import { errorHandler } from "./middleware/errorHandler";
import express from "express";
import inventoryRouter from "./routes/inventory";
import deliveryPromiseRouter from "./routes/deliveryPromise";
import reservationsRouter from "./routes/reservations";


const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "smart-delivery-engine",
  });
});

app.use("/api/inventory", inventoryRouter);
app.use("/api/delivery-promise", deliveryPromiseRouter);
app.use("/api/reservations", reservationsRouter);

app.use(errorHandler);

export default app;
