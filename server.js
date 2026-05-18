require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const db = require("./database/db");

const app = express();

// ─── SECURITY MIDDLEWARE ──────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: false, // Allow images to be loaded across origins
}));

// ─── CORS CONFIGURATION ───────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = "The CORS policy for this site does not allow access from the specified Origin.";
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json());

// Serve static files (fallback for local dev, though images should be on Cloudinary now)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── DATABASE INITIALIZATION ─────────────────────────────
if (process.env.NODE_ENV !== "test") {
  db.initializeDb()
    .then(() => console.log("Database ready"))
    .catch((err) => console.error("Database initialization failed:", err));
}

// ─── API ROUTES ─────────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/projects", require("./routes/projects"));

// Health check (Essential for Render/deployment)
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ─── ERROR HANDLING ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  
  if (err.message === "Only image files are allowed") {
    return res.status(400).json({ error: err.message });
  }
  
  const status = err.status || 500;
  const message = process.env.NODE_ENV === "production" 
    ? "Internal Server Error" 
    : err.message;

  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});
