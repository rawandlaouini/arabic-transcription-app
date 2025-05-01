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

// JWT Secret (store in .env for production)
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// Google Client ID (store in .env for production)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "201334161885-7qktheuftruukg492deg3ugl2m0u0g61.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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

    // Check if user exists in the database
    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }

      if (user) {
        // User exists, generate JWT token
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
          expiresIn: "1h",
        });
        return res.json({ token });
      }

      // User doesn't exist, create a new user
      const hashedPassword = await bcrypt.hash(googleId, 10); // Use Google ID as password
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
  if (!req.file) {
    return res.status(400).json({ error: "No audio file uploaded" });
  }

  const audioPath = req.file.path;
  const outputDir = path.join(__dirname, "uploads", `chunks_${Date.now()}`);
  fs.mkdirSync(outputDir);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Split audio into 20-second chunks
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .outputOptions([
          "-f segment",
          "-segment_time 20",
          "-c:a mp3", // Explicitly encode as MP3
          "-ar 16000", // Ensure 16kHz sampling rate
          "-ac 1", // Mono channel
          "-vn", // No video
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
  } catch (error) {
    console.error("FFmpeg splitting failed:", error);
    res.write(`data: ${JSON.stringify({ error: "Splitting error: " + error.message })}\n\n`);
    return res.end();
  }

  // Get list of chunks and validate
  const chunks = fs.readdirSync(outputDir).filter(file => file.endsWith(".mp3"));
  const totalChunks = chunks.length;
  let transcriptions = [];

  if (totalChunks === 0) {
    res.write(`data: ${JSON.stringify({ error: "No chunks generated" })}\n\n`);
    return res.end();
  }

  console.log(`Total chunks generated: ${totalChunks}`);

  // Transcribe each chunk with Hugging Face API
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(outputDir, chunks[i]);

    // Validate chunk file
    try {
      const stats = fs.statSync(chunkPath);
      if (stats.size < 1000) { // Minimum size check (1KB)
        console.warn(`Chunk ${i} is too small (${stats.size} bytes), skipping...`);
        continue;
      }

      // Additional validation: Check if the file is a valid audio file using ffprobe
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
      });
    } catch (error) {
      console.warn(`Skipping chunk ${i} due to validation error: ${error.message}`);
      continue;
    }

    let retries = 5;
    let success = false;
    let transcribedText = "";

    while (retries > 0 && !success) {
      try {
        const audioData = fs.readFileSync(chunkPath);
        const response = await axios.post(
          "https://api-inference.huggingface.co/models/RawandLaouini/whisper-medium-ar-finetuned-v6-colab",
          audioData,
          {
            headers: {
              Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
              "Content-Type": "audio/mpeg",
            },
            timeout: 70000,
          }
        );
        transcribedText = response.data.text.trim();
        success = true;
      } catch (error) {
        if (
          (error.response &&
            (error.response.status === 429 || error.response.status === 503)) ||
          error.message.includes("Model too busy")
        ) {
          console.warn(
            `Retryable error for chunk ${i}: ${
              error.response ? error.response.status : error.message
            }, retrying (${retries} attempts left)...`
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
          retries--;
        } else {
          console.error(
            `Error transcribing chunk ${i}:`,
            error.response ? error.response.data : error.message
          );
          break; // Skip this chunk instead of sending error to frontend
        }
      }
    }

    if (!success) {
      console.warn(`Skipping chunk ${i} after exhausting retries`);
      continue;
    }

    if (transcribedText) {
      transcriptions.push(transcribedText);
    } else {
      console.warn(`Chunk ${i} transcribed but returned empty text`);
    }

    const fullTranscription = transcriptions.join(" ").replace(/\s+/g, " ").trim();
    const progress = totalChunks > 0 ? ((i + 1) / totalChunks) * 100 : 0;

    res.write(
      `data: ${JSON.stringify({
        currentTranscription: fullTranscription,
        progress: Math.min(progress, 100),
        status: "transcribing",
      })}\n\n`
    );

    if (i < totalChunks - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Reduced delay
    }
  }

  // Send final transcription
  const finalTranscription = transcriptions.join(" ").replace(/\s+/g, " ").trim();
  if (!finalTranscription) {
    res.write(`data: ${JSON.stringify({ error: "No transcription generated" })}\n\n`);
  } else {
    res.write(
      `data: ${JSON.stringify({
        finalTranscription,
        progress: 100,
        status: "completed",
      })}\n\n`
    );
  }
  res.end();

  // Clean up
  try {
    fs.unlinkSync(audioPath);
    fs.readdirSync(outputDir).forEach(file => fs.unlinkSync(path.join(outputDir, file)));
    fs.rmdirSync(outputDir);
  } catch (error) {
    console.error("Cleanup error:", error);
  }
});

// Generate file endpoint (protected)
app.post("/generate-file", authenticateToken, async (req, res) => {
  const { text, format } = req.body;
  if (!text || !format) {
    return res.status(400).json({ error: "Missing text or format" });
  }

  const { exec } = require("child_process");
  const util = require("util");
  const execPromise = util.promisify(exec);

  try {
    const { stdout, stderr } = await execPromise(
      `python generate_file.py "${text}" ${format}`,
      { encoding: 'utf8' }
    );
    if (stderr) throw new Error(stderr);
    const outputFile = stdout.trim();
    res.json({ fileUrl: `http://localhost:8000/downloads/${path.basename(outputFile)}` });
  } catch (error) {
    console.error("File generation error:", error);
    res.status(500).json({ error: "File generation error: " + error.message });
  }
});

// Serve generated files
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

app.listen(8000, () => {
  console.log("Backend server running on http://localhost:8000");
});