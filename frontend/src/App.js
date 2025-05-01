import { useState, useEffect } from "react";
import AudioUploader from "./components/AudioUploader";
import TranscriptionTextArea from "./components/TranscriptionTextArea";
import OutputFormatDropdown from "./components/OutputFormatDropdown";
import GenerateFileButton from "./components/GenerateFileButton";
import FileDownloadLink from "./components/FileDownloadLink";
import ProgressBar from "./components/ProgressBar";
import StatusMessage from "./components/StatusMessage";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import axios from "axios";

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [transcription, setTranscription] = useState("");
  const [editableTranscription, setEditableTranscription] = useState("");
  const [format, setFormat] = useState("PDF");
  const [fileUrl, setFileUrl] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);

  const BACKEND_URL = "http://localhost:8000";

  useEffect(() => {
    setEditableTranscription(transcription);
  }, [transcription]);

  const handleSignup = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setStatus("Signup successful! Please log in.");
      setIsSignup(false);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleLogin = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setToken(data.token);
      localStorage.setItem("token", data.token);
      setStatus("Login successful!");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleGoogleLogin = async (credentialResponse) => {
    try {
      const response = await axios.post(`${BACKEND_URL}/google-login`, {
        token: credentialResponse.credential,
      });
      const data = response.data;
      if (data.error) throw new Error(data.error);
      setToken(data.token);
      localStorage.setItem("token", data.token);
      setStatus("Google login successful!");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleLogout = () => {
    setToken("");
    localStorage.removeItem("token");
    setStatus("Logged out successfully!");
    setAudioFile(null);
    setTranscription("");
    setEditableTranscription("");
    setFileUrl(null);
    setProgress(0);
  };

  const handleFileChange = (file) => {
    setAudioFile(file);
    setStatus("");
    setTranscription("");
    setEditableTranscription("");
    setProgress(0);
    setFileUrl("");
  };

  const handleFormatChange = (value) => {
    setFormat(value);
  };

  const handleTranscribe = async () => {
    if (!audioFile) {
      setStatus("Please upload an audio file.");
      return;
    }
    setIsTranscribing(true);
    setStatus("Transcribing...");
    setTranscription("");
    setEditableTranscription("");
    setProgress(0);

    const formData = new FormData();
    formData.append("audio", audioFile);

    try {
      const response = await fetch(`${BACKEND_URL}/transcribe`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let hasCompleted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error && !hasCompleted) {
                setStatus(`Error: ${data.error}`);
                setIsTranscribing(false);
                setProgress(0);
                break;
              } else if (data.status === "completed") {
                hasCompleted = true;
                setTranscription(data.finalTranscription);
                setEditableTranscription(data.finalTranscription);
                setProgress(100);
                setStatus("Transcription complete!");
                setIsTranscribing(false);
              } else {
                setTranscription(data.currentTranscription);
                setEditableTranscription(data.currentTranscription);
                setProgress(Math.min(data.progress, 100));
                setStatus("Transcribing...");
              }
            } catch (error) {
              console.error("Error parsing SSE data:", error);
            }
          }
        }
      }

      if (!hasCompleted && !transcription) {
        setStatus("Error: Transcription failed");
        setIsTranscribing(false);
        setProgress(0);
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      setIsTranscribing(false);
      setProgress(0);
    }
  };

  const handleGenerateFile = async () => {
    if (!editableTranscription) {
      setStatus("No transcription to generate.");
      return;
    }
    setStatus("Generating file...");
    try {
      const response = await fetch(`${BACKEND_URL}/generate-file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: editableTranscription, format }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setFileUrl(data.fileUrl);
      setStatus("File ready!");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  if (!token) {
    return (
      <GoogleOAuthProvider clientId="201334161885-7qktheuftruukg492deg3ugl2m0u0g61.apps.googleusercontent.com">
        <div className="min-h-screen bg-gradient-to-br from-pink-100 to-pink-200 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
            <h1 className="text-3xl font-bold text-pink-400 text-center mb-6">
              Arabic Audio Magic ✨
            </h1>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              {isSignup ? "Sign Up" : "Login"}
            </h2>
            <div className="flex flex-col gap-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="p-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="p-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
              <button
                onClick={isSignup ? handleSignup : handleLogin}
                className="bg-pink-400 text-white py-2 px-4 rounded-xl hover:bg-pink-500 transition-all"
              >
                {isSignup ? "Sign Up" : "Login"}
              </button>
              <div className="flex items-center justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleLogin}
                  onError={() => setStatus("Google login failed.")}
                  text="continue_with"
                />
              </div>
              <button
                onClick={() => setIsSignup(!isSignup)}
                className="text-pink-400 hover:underline"
              >
                {isSignup ? "Already have an account? Login" : "Need an account? Sign Up"}
              </button>
            </div>
            {status && <p className="text-center mt-4 text-red-500">{status}</p>}
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 to-pink-200 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-pink-400">
            Arabic Audio Magic ✨
          </h1>
          <button
            onClick={handleLogout}
            className="text-pink-400 hover:underline"
          >
            Logout
          </button>
        </div>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="md:w-1/3 flex flex-col gap-4">
            <AudioUploader onFileSelect={handleFileChange} />
            <button
              onClick={handleTranscribe}
              disabled={isTranscribing || !audioFile}
              className="bg-pink-400 text-white py-2 px-4 rounded-xl hover:bg-pink-500 disabled:bg-gray-300 transition-all"
            >
              {isTranscribing ? "Transcribing..." : "Transcribe"}
            </button>
          </div>
          <div className="md:w-2/3 flex flex-col gap-4">
            <TranscriptionTextArea
              value={editableTranscription}
              onChange={(e) => setEditableTranscription(e.target.value)}
            />
            <div className="flex gap-3">
              <OutputFormatDropdown value={format} onChange={handleFormatChange} />
              <GenerateFileButton
                onClick={handleGenerateFile}
                disabled={isTranscribing || !editableTranscription}
              />
            </div>
            {fileUrl && <FileDownloadLink url={fileUrl} />}
          </div>
        </div>
        <div className="mt-6">
          <ProgressBar value={progress} />
          {isTranscribing && (
            <div className="flex justify-center mt-4">
              <div className="w-6 h-6 border-4 border-gray-200 border-t-pink-400 rounded-full animate-spin"></div>
            </div>
          )}
          <StatusMessage message={status} />
        </div>
      </div>
    </div>
  );
}

export default App;