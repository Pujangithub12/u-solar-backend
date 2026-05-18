const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// Production-ready PostgreSQL connection using Connection String
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const initializeDb = async () => {
  // In production, you might want to use migrations (e.g., Knex or Sequelize).
  // This logic is kept for convenience but is wrapped in a try/catch.
  const client = await pool.connect();
  try {
    console.log("Initializing database schema...");
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        capacity TEXT NOT NULL,
        type TEXT DEFAULT 'Rooftop Installation',
        image_url TEXT DEFAULT '/images/default-project.jpg',
        gallery_urls JSONB DEFAULT '[]',
        year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
        client TEXT,
        panels TEXT,
        inverter TEXT,
        savings TEXT,
        status TEXT DEFAULT 'Completed',
        category TEXT NOT NULL CHECK(category IN ('commercial', 'industrial', 'utility')),
        country TEXT DEFAULT 'Nepal' CHECK(country IN ('Nepal', 'India')),
        description TEXT,
        detailed_description TEXT,
        owner_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed Admin if not exists
    const adminEmail = "admin@demo.com";
    const userRes = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [adminEmail],
    );

    if (userRes.rows.length === 0) {
      const hash = bcrypt.hashSync("admin123", 10);
      await client.query(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)",
        [adminEmail, hash, "admin"],
      );
      console.log("Default admin created.");
    }

    await client.query("COMMIT");
    console.log("Database initialized successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Database initialization failed:", err);
  } finally {
    client.release();
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  initializeDb,
  pool,
};
