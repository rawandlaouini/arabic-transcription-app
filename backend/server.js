const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const cors = require("cors");
const axios = require("axios");
const https = require("https"); // Add for SSL bypass if needed
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const db = require("./database");
require("dotenv").config();

const app = express();

// Configure CORS to allow requests from the frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Configure Multer to store uploaded files
const upload = multer({ dest: "uploads/" });

// Create directories if they don't exist
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
};
ensureDir("uploads");
ensureDir("downloads");

// Serve generated files
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

// JWT Secret (from .env)
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// Google Client ID (from .env)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "201334161885-7qktheuftruukg492deg3ugl2m0u0g61.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Base URL (dynamic based on environment, adjusted for local access)
const BASE_URL = process.env.NODE_ENV === "development" 
  ? "http://localhost:8000" 
  : (process.env.BASE_URL || "http://backend:8000");

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied: No token provided" });

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
  res.send("Backend is working!");
});

// Signup endpoint
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users (email, password) VALUES (?, ?)", [email, hashedPassword], function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) return res.status(400).json({ error: "Email already exists" });
        return res.status(500).json({ error: "Error creating user" });
      }
      res.status(201).json({ message: "User created successfully" });
    });
  } catch (error) {
    res.status(500).json({ error: "Error creating user" });
  }
});

// Login endpoint
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: "Invalid email or password" });

    try {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ error: "Invalid email or password" });

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
      res.json({ token });
    } catch (error) {
      res.status(500).json({ error: "Error logging in" });
    }
  });
});

// Google Login endpoint
app.post("/google-login", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Google token is required" });

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email;
    const googleId = payload.sub;

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
      if (err) return res.status(500).json({ error: "Database error" });

      if (user) {
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
        return res.json({ token });
      }

      const hashedPassword = await bcrypt.hash(googleId, 10);
      db.run("INSERT INTO users (email, password) VALUES (?, ?)", [email, hashedPassword], function (err) {
        if (err) return res.status(500).json({ error: "Error creating user" });
        const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: "1h" });
        res.json({ token });
      });
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// Transcribe endpoint with SSE (protected)
app.post("/transcribe", authenticateToken, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

  const audioPath = req.file.path;
  const outputDir = path.join(__dirname, "uploads", `chunks_${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .outputOptions(["-f segment", "-segment_time 20", "-c:a mp3", "-ar 16000", "-ac 1", "-vn"])
        .output(path.join(outputDir, "chunk_%03d.mp3"))
        .on("end", () => {
          console.log("FFmpeg splitting completed");
          resolve();
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err.message);
          reject(err);
        })
        .run();
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: "Splitting error: " + error.message })}\n\n`);
    return res.end();
  }

  const chunks = fs.readdirSync(outputDir).filter(file => file.endsWith(".mp3"));
  const totalChunks = chunks.length;
  let transcriptions = [];

  console.log(`Total chunks generated: ${totalChunks}`);

  if (totalChunks === 0) {
    res.write(`data: ${JSON.stringify({ error: "No chunks generated" })}\n\n`);
    return res.end();
  }

  // Create an HTTPS agent to bypass SSL verification (optional, for Docker networking issues)
  const agent = new https.Agent({
    rejectUnauthorized: false // Only use if needed for HTTP within Docker
  });

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(outputDir, chunks[i]);
    let transcribedText = "";

    try {
      const stats = fs.statSync(chunkPath);
      console.log(`Chunk ${i}: Size = ${stats.size} bytes`);

      if (stats.size < 1000) {
        console.log(`Skipping chunk ${i}: File too small`);
        continue;
      }

      await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(chunkPath, (err, metadata) => {
          if (err || !metadata.format.duration) {
            console.error(`Invalid chunk ${i}:`, err ? err.message : "No duration");
            reject(new Error("Invalid audio chunk"));
          } else {
            console.log(`Chunk ${i}: Duration = ${metadata.format.duration} seconds`);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`Skipping chunk ${i} due to validation error:`, error.message);
      continue;
    }

    let retries = 5;
    let success = false;
    while (retries > 0 && !success) {
      try {
        const audioData = fs.readFileSync(chunkPath);
        console.log(`Chunk ${i} audio data length: ${audioData.length} bytes`);
        const form = new (require("form-data"))();
        form.append("audio", audioData, { filename: `chunk_${i}.mp3`, contentType: "audio/mpeg" });

        const response = await axios.post(process.env.NGROK_URL, form, {
          headers: form.getHeaders(),
          httpsAgent: agent, // Use agent if needed
          timeout: 180000, // Increase timeout to 180 seconds
        });

        if (response.status === 200 && response.data.text) {
          transcribedText = response.data.text.trim();
          console.log(`Chunk ${i} transcribed: ${transcribedText}`);
          success = true;
        } else {
          throw new Error(`Unexpected response: ${JSON.stringify(response.data)}`);
        }
      } catch (error) {
        console.error(`Error transcribing chunk ${i}:`, error.response ? error.response.data : error.message);
        if (error.response) {
          // Handle specific HTTP errors
          if (error.response.status === 429 || error.response.status === 503) {
            console.log(`Retrying chunk ${i} due to rate limiting or service unavailable... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            retries--;
          } else if (error.response.status === 400 || error.response.status === 500) {
            // Propagate transcription service errors to the client
            res.write(`data: ${JSON.stringify({ error: `Transcription error for chunk ${i}: ${error.response.data.error || "Unknown error"}` })}\n\n`);
            break;
          } else {
            console.log(`Unexpected HTTP error for chunk ${i}, stopping retries`);
            break;
          }
        } else if (error.message.includes("timeout")) {
          console.log(`Retrying chunk ${i} due to timeout... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          retries--;
        } else {
          console.log(`Unexpected error for chunk ${i}, stopping retries: ${error.message}`);
          break;
        }
      }
    }

    if (!success) {
      console.log(`Skipping chunk ${i} after exhausting retries`);
      continue;
    }

    if (transcribedText) transcriptions.push(transcribedText);
    const fullTranscription = transcriptions.join(" ").replace(/\s+/g, " ").trim();
    const progress = totalChunks > 0 ? ((i + 1) / totalChunks) * 100 : 0;
    res.write(`data: ${JSON.stringify({ currentTranscription: fullTranscription, progress: Math.min(progress, 100), status: "transcribing" })}\n\n`);
    if (i < totalChunks - 1) await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const finalTranscription = transcriptions.join(" ").replace(/\s+/g, " ").trim();
  if (!finalTranscription) res.write(`data: ${JSON.stringify({ error: "No transcription generated" })}\n\n`);
  else res.write(`data: ${JSON.stringify({ finalTranscription, progress: 100, status: "completed" })}\n\n`);
  res.end();

  // Cleanup
  fs.unlinkSync(audioPath);
  fs.readdirSync(outputDir).forEach(file => fs.unlinkSync(path.join(outputDir, file)));
  fs.rmdirSync(outputDir);
});

// Generate file endpoint (protected)
app.post("/generate-file", authenticateToken, async (req, res) => {
  const { text, format } = req.body;
  if (!text || !format) return res.status(400).json({ error: "Missing text or format" });

  const { exec } = require("child_process");
  const util = require("util");
  const execPromise = util.promisify(exec);

  try {
    const { stdout, stderr } = await execPromise(`python generate_file.py "${text}" ${format}`, { encoding: "utf8" });
    if (stderr) throw new Error(stderr);
    const outputFile = stdout.trim();
    if (!fs.existsSync(outputFile)) throw new Error("Generated file not found");
    const fileUrl = `${BASE_URL}/downloads/${path.basename(outputFile)}`;
    res.json({ fileUrl });
  } catch (error) {
    res.status(500).json({ error: "File generation error: " + error.message });
  }
});

app.listen(8000, () => {
  console.log(`Backend server running on ${BASE_URL}`);
});