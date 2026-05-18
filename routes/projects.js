const express = require("express");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const db = require("../database/db");
const {
  authenticate,
  authorizeOwnerOrAdmin,
  requireAdmin,
} = require("../middleware/auth");

// ─── CLOUDINARY CONFIGURATION ────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "u-solar-projects",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "gif"],
    transformation: [{ width: 1200, height: 800, crop: "limit" }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// ─── HELPERS ───────────────────────────────────────────────
const parseProject = (project) => {
  if (!project) return null;
  return {
    ...project,
    gallery_urls: project.gallery_urls || [],
  };
};

const getProjectById = async (id) => {
  const res = await db.query(
    `
    SELECT p.*, u.email as owner_email 
    FROM projects p 
    JOIN users u ON p.owner_id = u.id 
    WHERE p.id = $1
  `,
    [id]
  );
  return res.rows[0];
};

// ─── GET /api/projects - List all (public, with category and country filter) ─
router.get("/", async (req, res) => {
  try {
    const { category, country } = req.query;
    let query = `
      SELECT p.*, u.email as owner_email 
      FROM projects p 
      JOIN users u ON p.owner_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND p.category = $${params.length}`;
    }

    if (country) {
      params.push(country);
      query += ` AND p.country = $${params.length}`;
    }

    query += ` ORDER BY p.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows.map(parseProject));
  } catch (err) {
    console.error("Fetch projects error:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ─── GET /api/projects/:id - Single project (public) ─────
router.get("/:id", async (req, res) => {
  try {
    const project = await getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(parseProject(project));
  } catch (err) {
    console.error("Fetch project error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST /api/projects - Create new project (admin only) ──
router.post(
  "/",
  authenticate,
  requireAdmin,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "gallery", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const {
        title,
        location,
        capacity,
        type,
        year,
        client,
        panels,
        inverter,
        savings,
        status,
        category,
        country,
        description,
        detailed_description,
      } = req.body;

      // Validation
      if (!title || title.trim().length < 3) {
        return res.status(400).json({ error: "Title must be at least 3 characters" });
      }
      if (!location || location.trim().length < 3) {
        return res.status(400).json({ error: "Location is required" });
      }
      if (!capacity) {
        return res.status(400).json({ error: "Capacity is required" });
      }
      if (!category || !["commercial", "industrial", "utility"].includes(category)) {
        return res.status(400).json({ error: "Valid category required" });
      }
      if (!country || !["Nepal", "India"].includes(country)) {
        return res.status(400).json({ error: "Valid country required (Nepal, India)" });
      }

      // Handle main image from Cloudinary
      let imageUrl = "/images/default-project.jpg";
      if (req.files && req.files.image && req.files.image[0]) {
        imageUrl = req.files.image[0].path; // Cloudinary URL
      }

      // Handle gallery images from Cloudinary
      const galleryUrls = [];
      if (req.files && req.files.gallery) {
        req.files.gallery.forEach((file) => {
          galleryUrls.push(file.path); // Cloudinary URL
        });
      }

      const result = await db.query(
        `
        INSERT INTO projects (
          title, location, capacity, type, image_url, gallery_urls,
          year, client, panels, inverter, savings, status, category, country,
          description, detailed_description, owner_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id
      `,
        [
          title.trim(),
          location.trim(),
          capacity,
          type || "Rooftop Installation",
          imageUrl,
          JSON.stringify(galleryUrls),
          year || new Date().getFullYear(),
          client || null,
          panels || null,
          inverter || null,
          savings || null,
          status || "Completed",
          category,
          country || "Nepal",
          description || null,
          detailed_description || null,
          req.user.id,
        ]
      );

      const newProjectId = result.rows[0].id;
      res.status(201).json(parseProject(await getProjectById(newProjectId)));
    } catch (err) {
      console.error("Create project error:", err);
      res.status(500).json({ error: "Failed to create project" });
    }
  }
);

// ─── PUT /api/projects/:id - Update (protected, dynamic fields) ─
router.put("/:id", authenticate, authorizeOwnerOrAdmin, async (req, res) => {
  const updates = req.body;
  const allowedFields = [
    "title",
    "location",
    "capacity",
    "type",
    "description",
    "detailed_description",
    "year",
    "client",
    "panels",
    "inverter",
    "savings",
    "status",
    "category",
    "country",
    "image_url",
  ];

  const fieldsToUpdate = Object.keys(updates).filter((k) => allowedFields.includes(k));

  if (fieldsToUpdate.length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  if (fieldsToUpdate.includes("title") && (!updates.title || updates.title.trim().length < 3)) {
    return res.status(400).json({ error: "Title must be at least 3 characters" });
  }

  try {
    const setClause = fieldsToUpdate.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const values = fieldsToUpdate.map((f) => updates[f]);
    values.push(req.params.id);

    const query = `
      UPDATE projects 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${values.length}
    `;

    const result = await db.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(parseProject(await getProjectById(req.params.id)));
  } catch (err) {
    console.error("Update project error:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// ─── DELETE /api/projects/:id - Delete (admin only) ────────
router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const projectRes = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const project = projectRes.rows[0];

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // NOTE: In a production app, you might want to delete images from Cloudinary here
    // using cloudinary.uploader.destroy(public_id). This requires storing the public_id.
    // For now, we just delete the database record.

    await db.query("DELETE FROM projects WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: "Project deleted" });
  } catch (err) {
    console.error("Delete project error:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

module.exports = router;
