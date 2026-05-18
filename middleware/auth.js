const jwt = require("jsonwebtoken");
const db = require("../database/db");

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid or expired token" });
  }
};

const authorizeOwnerOrAdmin = async (req, res, next) => {
  const projectId = req.params.id;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Admins can edit anything
  if (userRole === "admin") return next();

  try {
    // Check ownership
    const projectRes = await db.query("SELECT owner_id FROM projects WHERE id = $1", [projectId]);
    const project = projectRes.rows[0];

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.owner_id !== userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to edit this project" });
    }

    next();
  } catch (err) {
    console.error("Authorize owner error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// New: Middleware to check admin role only (for create/delete)
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

module.exports = { authenticate, authorizeOwnerOrAdmin, requireAdmin };
