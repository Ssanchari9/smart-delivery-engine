import { Pool } from "pg";

export const pool = new Pool({
  host: "127.0.0.1",
  port: 5433,
  database: "smart_delivery",
  user: "delivery_app",
  password: "local_dev_password",
});