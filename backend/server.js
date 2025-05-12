const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const cors = require("cors");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const db = require("./database");
require("dotenv").config();

const app = express();

// Configure CORS to allow requests from your frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Configure Multer to store uploaded files
const upload = multer({ dest: "uploads/" });

// Create uploads directory if it doesn't exist
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
  console.log("Creating uploads directory");
} else {
  console.log("Uploads directory already exists");
}

// Create downloads directory if it doesn't exist
if (!fs.existsSync("downloads")) {
  fs.mkdirSync("downloads");
  console.log("Creating downloads directory");
}

// Serve generated files
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

// JWT Secret (store in .env for production)
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// Google Client ID (store in .env for production)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "201334161885-7qktheuftruuk492deg3ugl2m0u0g61.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Base URL for the server (dynamic based on environment)
const BASE_URL = process.env.NODE_ENV === "production" 
  ? process.env.BASE_URL || "https://arabic-transcription-app.onrender.com"
  : "http://localhost:8000";

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>
  if (!token) {
    return res.status(401).json({ error: "Access denied: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: "Access denied: Invalid token" });
  }
};

// Test endpoint
app.get("/test", (req, res) => {
  console.log("Received request to /test");
  res.send("Backend is working!");
});

// Signup endpoint
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(
      "INSERT INTO users (email, password) VALUES (?, ?)",
      [email, hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Email already exists" });
          }
          return res.status(500).json({ error: "Error creating user" });
        }
        res.status(201).json({ message: "User created successfully" });
      }
    );
  } catch (error) {
    res.status(500).json({ error: "Error creating user" });
  }
});

// Login endpoint
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    try {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: "Invalid email or password" });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
        expiresIn: "1h",
      });
      res.json({ token });
    } catch (error) {
      res.status(500).json({ error: "Error logging in" });
    }
  });
});

// Google Login endpoint
app.post("/google-login", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Google token is required" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const googleId = payload.sub;

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }

      if (user) {
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
          expiresIn: "1h",
        });
        return res.json({ token });
      }

      const hashedPassword = await bcrypt.hash(googleId, 10);
      db.run(
        "INSERT INTO users (email, password) VALUES (?, ?)",
        [email, hashedPassword],
        function (err) {
          if (err) {
            return res.status(500).json({ error: "Error creating user" });
          }
          const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, {
            expiresIn: "1h",
          });
          res.json({ token });
        }
      );
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// Transcribe endpoint with SSE (protected)
app.post("/transcribe", authenticateToken, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).write(`data: ${JSON.stringify({ error: "No audio file uploaded" })}\n\n`).end();
    }

    const audioPath = req.file.path;
    const outputDir = path.join(__dirname, "uploads", `chunks_${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Split audio into 20-second chunks
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .outputOptions([
          "-f segment",
          "-segment_time 20",
          "-c:a mp3",
          "-ar 16000",
          "-ac 1",
          "-vn",
        ])
        .output(path.join(outputDir, "chunk_%03d.mp3"))
        .on("end", () => {
          console.log("FFmpeg splitting completed");
          resolve();
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          reject(err);
        })
        .run();
    });

    const chunks = fs.readdirSync(outputDir).filter(file => file.endsWith(".mp3"));
    const totalChunks = chunks.length;
    console.log(`Total chunks generated: ${totalChunks}`);

    if (totalChunks === 0) {
      return res.write(`data: ${JSON.stringify({ error: "No chunks generated" })}\n\n`).end();
    }

    let fullTranscription = "";
    let progress = 0;

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(outputDir, chunks[i]);
      const stats = fs.statSync(chunkPath);

      if (stats.size < 1000) {
        console.warn(`Chunk ${i} is too small (${stats.size} bytes), skipping...`);
        continue;
      }

      await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(chunkPath, (err, metadata) => {
          if (err || !metadata.format.duration) {
            console.warn(`Chunk ${i} is invalid (ffprobe error: ${err?.message}), skipping...`);
            reject(new Error("Invalid audio chunk"));
          } else {
            console.log(`Chunk ${i}: Size = ${stats.size} bytes, Duration = ${metadata.format.duration} seconds`);
            resolve();
          }
        });
      }).catch(() => {});

      let retries = 5;
      let success = false;
      let transcribedText = "";

      while (retries > 0 && !success) {
        try {
          const audioData = fs.readFileSync(chunkPath);
          console.log(`Chunk ${i} audio data length: ${audioData.length} bytes`);

          const form = new FormData();
          form.append("audio", audioData, { filename: `chunk_${i}.mp3`, contentType: "audio/mpeg" });

          const response = await axios.post(
            process.env.NGROK_URL,
            form,
            {
              headers: { ...form.getHeaders() },
              timeout: 120000,
            }
          );

          console.log(`Chunk ${i} API response:`, response.data);

          if (response.status === 200 && response.data.text) {
            transcribedText = response.data.text.trim();
            success = true;
          } else {
            console.error(`Chunk ${i} API error: ${response.status} - ${response.data.error || response.data}`);
          }
        } catch (error) {
          console.error(`Error transcribing chunk ${i}:`, error.response ? error.response.data : error.message);
          if ((error.response && (error.response.status === 429 || error.response.status === 503)) || error.message.includes("Model too busy")) {
            console.warn(`Retryable error for chunk ${i}, retrying (${retries} attempts left)...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            retries--;
          } else {
            break;
          }
        }
      }

      if (!success || !transcribedText) {
        console.warn(`Skipping chunk ${i} due to transcription failure`);
        continue;
      }

      fullTranscription += transcribedText + " ";
      progress = Math.round(((i + 1) / totalChunks) * 100);

      res.write(`data: ${JSON.stringify({
        currentTranscription: transcribedText,
        progress: progress,
        status: i === totalChunks - 1 ? "completed" : "transcribing",
      })}\n\n`);

      if (i < totalChunks - 1) await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!fullTranscription.trim()) {
      res.write(`data: ${JSON.stringify({ error: "No transcription generated" })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({
        finalTranscription: fullTranscription.trim(),
        progress: 100,
        status: "completed",
      })}\n\n`);
    }
    res.end();

  } catch (error) {
    console.error("Transcription error:", error);
    res.write(`data: ${JSON.stringify({ error: "Transcription error: " + error.message })}\n\n`);
    res.end();
  } finally {
    // Cleanup files
    try {
      if (req.file) fs.unlinkSync(req.file.path);
      if (fs.existsSync(outputDir)) {
        fs.readdirSync(outputDir).forEach(file => fs.unlinkSync(path.join(outputDir, file)));
        fs.rmdirSync(outputDir);
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }
  }
});

// Generate file endpoint (protected)
app.post("/generate-file", authenticateToken, async (req, res) => {
  const { text, format } = req.body;
  console.log("Generate file request received:", { text, format });
  if (!text || !format) {
    return res.status(400).json({ error: "Missing text or format" });
  }

  const { exec } = require("child_process");
  const util = require("util");
  const execPromise = util.promisify(exec);

  try {
    console.log("Executing Python script with:", `python generate_file.py "${text}" ${format}`);
    const { stdout, stderr } = await execPromise(
      `python generate_file.py "${text}" ${format}`,
      { encoding: 'utf8' }
    );
    console.log("Python script stdout:", stdout);
    if (stderr) {
      console.error("Python script stderr:", stderr);
      throw new Error(stderr);
    }
    const outputFile = stdout.trim();
    console.log("Generated file path:", outputFile);
    if (!fs.existsSync(outputFile)) {
      throw new Error("Generated file not found");
    }
    const fileUrl = `${BASE_URL}/downloads/${path.basename(outputFile)}`;
    console.log("File URL:", fileUrl);
    res.json({ fileUrl });
  } catch (error) {
    console.error("File generation error:", error);
    res.status(500).json({ error: "File generation error: " + error.message });
  }
});

app.listen(8000, () => {
  console.log("Backend server running on http://localhost:8000");
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)", (err) => {
    if (err) console.error("Database error:", err);
    else console.log("Connected to SQLite database");
  });
});